import {
  type Client,
  type Message as DiscordMessage,
  type TextChannel,
  type ThreadChannel,
  EmbedBuilder,
  AttachmentBuilder,
  MessageFlags,
  ChannelType,
} from "discord.js";
import { existsSync } from "fs";
import { basename } from "path";
import { processMessage } from "../agent/agent.js";
import type { AgentResponse, AgentImage } from "../agent/agent.js";
import { resolveSession, getSessionHistory } from "../agent/sessions.js";
import { getChannelConfig, addMessage } from "../db/index.js";
import type { TokenUsage } from "../db/index.js";
import { broadcastLog } from "../gateway/server.js";
import { isRestarting } from "../restart.js";
import {
  transcribeAudio,
  isTranscriptionAvailable,
} from "../audio/transcribe.js";
import { recordSignal } from "../reflection/signals.js";

// ---------------------------------------------------------------------------
// Bot client reference (needed for mention checks)
// ---------------------------------------------------------------------------

let botClient: Client | null = null;

export function setMessageClient(client: Client): void {
  botClient = client;
}

// ---------------------------------------------------------------------------
// Track threads created by the bot so we can respond without mentions
// ---------------------------------------------------------------------------

/**
 * Set of thread IDs that the bot created. Messages in these threads
 * don't require an @mention — the bot responds to everything.
 * Persisted in-memory; threads that get archived/deleted naturally
 * expire from Discord's side.
 */
const botCreatedThreads = new Set<string>();

// ---------------------------------------------------------------------------
// Message splitting helper
// ---------------------------------------------------------------------------

const DISCORD_MAX_LENGTH = 2000;

function splitMessage(text: string): string[] {
  if (text.length <= DISCORD_MAX_LENGTH) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= DISCORD_MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline boundary within the limit
    let splitIndex = remaining.lastIndexOf("\n", DISCORD_MAX_LENGTH);
    if (splitIndex <= 0) {
      // Fall back to splitting at a space
      splitIndex = remaining.lastIndexOf(" ", DISCORD_MAX_LENGTH);
    }
    if (splitIndex <= 0) {
      // Hard split at the limit
      splitIndex = DISCORD_MAX_LENGTH;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Image handling helpers
// ---------------------------------------------------------------------------

/** Discord supports up to 10 embeds per message. */
const MAX_EMBEDS_PER_MESSAGE = 10;

/**
 * Build Discord embeds for URL-based images.
 * Each image gets its own embed so Discord renders them all.
 */
function buildImageEmbeds(images: AgentImage[]): EmbedBuilder[] {
  const urlImages = images.filter((img) => img.type === "url");
  return urlImages.slice(0, MAX_EMBEDS_PER_MESSAGE).map((img) => {
    const embed = new EmbedBuilder().setImage(img.source);
    if (img.alt) {
      embed.setDescription(img.alt);
    }
    return embed;
  });
}

/**
 * Build Discord attachment builders for local file images.
 */
function buildImageAttachments(images: AgentImage[]): AttachmentBuilder[] {
  const fileImages = images.filter(
    (img) => img.type === "file" && existsSync(img.source),
  );
  return fileImages.map((img) => {
    const name = basename(img.source);
    return new AttachmentBuilder(img.source, { name, description: img.alt });
  });
}

// ---------------------------------------------------------------------------
// Token usage formatting
// ---------------------------------------------------------------------------

/** Per-million-token pricing */
const PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheCreate: number }> = {
  default: { input: 3.0, output: 15.0, cacheRead: 0.30, cacheCreate: 3.75 },
};

function getModelPricing(model: string) {
  // Could add model-specific pricing here in the future
  void model;
  return PRICING.default;
}

/** Shorten model name: strip "bedrock-" prefix and date suffixes like "-20250514" or "-6-1m" */
function shortModelName(model: string): string {
  return model
    .replace(/^bedrock-/, "")
    .replace(/-\d{8}$/, "")
    .replace(/-\d+-\d+[a-z]?$/, "");
}

/** Format token count: 1234 → "1.2k", 123456 → "123.5k" */
function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Format duration in seconds: 45200 → "45.2s", 125000 → "2m 5s" */
function fmtDuration(ms: number): string {
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = Math.round(secs % 60);
  return `${mins}m ${remainSecs}s`;
}

/** Build a single-line usage string for appending to the message */
function formatUsageLine(usage: TokenUsage, durationMs?: number): string {
  const pricing = getModelPricing(usage.model);
  const cost =
    (usage.inputTokens * pricing.input +
      usage.outputTokens * pricing.output +
      usage.cacheReadTokens * pricing.cacheRead +
      usage.cacheCreationTokens * pricing.cacheCreate) /
    1e6;

  const model = shortModelName(usage.model);
  const durationPart = durationMs != null ? ` · ${fmtDuration(durationMs)}` : "";
  return `-# 📊 ${model} · ${fmtTokens(usage.inputTokens)} in / ${fmtTokens(usage.outputTokens)} out · $${cost.toFixed(4)}${durationPart}`;
}

// ---------------------------------------------------------------------------
// Voice message detection & transcription
// ---------------------------------------------------------------------------

/** Audio file extensions that we can transcribe. */
const AUDIO_EXTENSIONS = /\.(ogg|mp3|wav|m4a|webm|mp4|mpeg|mpga|oga|flac)$/i;

/**
 * Check if a Discord message is a voice message.
 * Discord voice messages have the IsVoiceMessage flag (8192) and
 * include an audio attachment (typically .ogg).
 */
function isVoiceMessage(message: DiscordMessage): boolean {
  return message.flags.has(MessageFlags.IsVoiceMessage);
}

/**
 * Check if a message has audio attachments (even without the voice flag).
 */
function hasAudioAttachments(message: DiscordMessage): boolean {
  return message.attachments.some((att) =>
    AUDIO_EXTENSIONS.test(att.name || ""),
  );
}

/**
 * Attempt to transcribe audio attachments from a message.
 * Returns transcribed text or null if transcription isn't possible.
 */
async function transcribeVoiceMessage(
  message: DiscordMessage,
): Promise<string | null> {
  if (!isTranscriptionAvailable()) {
    return null;
  }

  // Get audio attachments
  const audioAttachments = message.attachments.filter((att) =>
    AUDIO_EXTENSIONS.test(att.name || ""),
  );

  if (audioAttachments.size === 0) return null;

  const transcriptions: string[] = [];

  for (const [, attachment] of audioAttachments) {
    try {
      const text = await transcribeAudio(attachment.url, attachment.name);
      if (text) {
        transcriptions.push(text);
      }
    } catch (err) {
      console.error(
        `[bot] Failed to transcribe attachment ${attachment.name}:`,
        err,
      );
    }
  }

  return transcriptions.length > 0 ? transcriptions.join("\n") : null;
}

// ---------------------------------------------------------------------------
// Thread creation helper
// ---------------------------------------------------------------------------

/** Maximum length for a Discord thread name */
const MAX_THREAD_NAME_LENGTH = 100;

/**
 * Generate a short thread name from the user's message.
 * Uses the first line/sentence, truncated to Discord's limit.
 */
function generateThreadName(userMessage: string, userName: string): string {
  // Take first line or first 80 chars
  let name = userMessage.split("\n")[0].trim();

  // If the message is very short or empty after stripping, use a generic name
  if (!name || name.length < 3) {
    name = `Chat with ${userName}`;
  }

  // Truncate to Discord's limit (leave room for ellipsis)
  if (name.length > MAX_THREAD_NAME_LENGTH - 1) {
    name = name.slice(0, MAX_THREAD_NAME_LENGTH - 1) + "…";
  }

  return name;
}

/**
 * Create a thread on the user's message and return it.
 * Returns null if thread creation fails.
 */
async function createThreadForReply(
  message: DiscordMessage,
  cleanContent: string,
): Promise<ThreadChannel | null> {
  try {
    const threadName = generateThreadName(
      cleanContent,
      message.author.displayName ?? message.author.username,
    );

    const thread = await message.startThread({
      name: threadName,
      autoArchiveDuration: 1440, // 24 hours
    });

    // Track this as a bot-created thread
    botCreatedThreads.add(thread.id);

    console.log(
      `[bot] Created thread "${threadName}" (${thread.id}) for message ${message.id}`,
    );

    return thread;
  } catch (err) {
    console.error("[bot] Failed to create thread:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Channel type helpers
// ---------------------------------------------------------------------------

/**
 * Check if a message is in a guild text channel (not a thread, not a DM).
 * These are the messages that should spawn a new thread.
 */
function isGuildTextChannel(message: DiscordMessage): boolean {
  const channelType = message.channel.type;
  return (
    channelType === ChannelType.GuildText ||
    channelType === ChannelType.GuildAnnouncement
  );
}

/**
 * Check if a message is inside a thread.
 */
function isThreadChannel(message: DiscordMessage): boolean {
  const channelType = message.channel.type;
  return (
    channelType === ChannelType.PublicThread ||
    channelType === ChannelType.PrivateThread ||
    channelType === ChannelType.AnnouncementThread
  );
}

/**
 * Check if a thread was created by the bot (and thus doesn't need @mentions).
 */
function isBotCreatedThread(message: DiscordMessage): boolean {
  if (!isThreadChannel(message)) return false;

  // Check our in-memory set first
  if (botCreatedThreads.has(message.channel.id)) return true;

  // Fallback: check if the thread owner is the bot
  const thread = message.channel as ThreadChannel;
  if (thread.ownerId && botClient?.user?.id && thread.ownerId === botClient.user.id) {
    // Cache it for future lookups
    botCreatedThreads.add(thread.id);
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Main message handler
// ---------------------------------------------------------------------------

export async function handleMessage(message: DiscordMessage): Promise<void> {
  // 0. Filter: ignore messages during restart (prevents double replies)
  if (isRestarting()) return;

  // 1. Filter: skip bot messages
  if (message.author.bot) return;

  const isDM = message.channel.isDMBased();
  const isVoice = isVoiceMessage(message);
  const hasAudio = hasAudioAttachments(message);
  const inBotThread = isBotCreatedThread(message);

  console.log(
    `[bot] Message from ${message.author.tag} isDM=${isDM} isVoice=${isVoice} hasAudio=${hasAudio} inBotThread=${inBotThread} content="${message.content.slice(0, 80)}"`,
  );

  // 2. Filter: in guild channels, respond when mentioned OR when in a bot-created thread
  if (!isDM) {
    const botUser = botClient?.user;
    if (!botUser) {
      console.log("[bot] Skipping — botClient.user is null");
      return;
    }
    // In bot-created threads, respond to all messages (no mention needed)
    // In other channels/threads, require a mention
    if (!inBotThread && !message.mentions.has(botUser)) {
      console.log("[bot] Skipping — bot not mentioned and not in bot thread");
      return;
    }
  }

  // 3. Filter: check channel config
  // For threads, check the parent channel's config
  const configChannelId = isThreadChannel(message)
    ? (message.channel as ThreadChannel).parentId ?? message.channelId
    : message.channelId;
  const channelConfig = getChannelConfig(configChannelId);
  if (channelConfig?.enabled === false) return;

  // 4. Determine if we need to create a thread
  // Create thread for guild text channel messages (not DMs, not already in threads)
  const shouldCreateThread = !isDM && isGuildTextChannel(message);

  // 5. Session resolve — use thread ID for isolation
  const isThread = isThreadChannel(message);

  // For new thread creation, we'll update the session after creating the thread
  // For existing threads, use the thread ID
  // For DMs, use existing behavior
  let sessionThreadId: string | undefined;
  if (isThread) {
    sessionThreadId = message.channel.id;
  }
  // If shouldCreateThread, we'll set this after thread creation

  // 6. Build context
  // Strip bot mention from content before sending to the agent
  let cleanContent = message.content.replace(/<@!?\d+>/g, "").trim();

  // 6b. Handle voice messages — transcribe audio and use as message content
  if (isVoice || hasAudio) {
    // Show typing while we transcribe
    if ("sendTyping" in message.channel) {
      message.channel.sendTyping().catch(() => {});
    }

    const transcript = await transcribeVoiceMessage(message);

    if (transcript) {
      console.log(
        `[bot] Voice transcription: "${transcript.slice(0, 100)}${transcript.length > 100 ? "..." : ""}"`,
      );

      // Combine any text content with the transcription
      if (cleanContent) {
        cleanContent = `${cleanContent}\n\n[Voice message transcription]: ${transcript}`;
      } else {
        cleanContent = transcript;
      }
    } else if (!cleanContent) {
      // No transcription available and no text content
      if (!isTranscriptionAvailable()) {
        await message.reply(
          "🎤 I can see you sent a voice message, but voice transcription isn't configured yet. Ask an admin to set the `OPENAI_API_KEY` environment variable to enable it!",
        );
      } else {
        await message.reply(
          "🎤 I couldn't transcribe your voice message. Please try again or type your message instead.",
        );
      }
      return;
    }
  }

  if (!cleanContent) return; // Nothing left after stripping mentions

  // 7. Create thread if needed (before resolving session so session uses thread ID)
  let replyTarget: DiscordMessage["channel"] | ThreadChannel = message.channel;

  if (shouldCreateThread) {
    const thread = await createThreadForReply(message, cleanContent);
    if (thread) {
      replyTarget = thread;
      sessionThreadId = thread.id;
    }
    // If thread creation fails, fall back to replying in channel directly
  }

  // 8. Now resolve session with the correct thread ID
  const session = resolveSession({
    threadId: sessionThreadId,
    channelId: message.channelId,
    userId: message.author.id,
    guildId: message.guildId || undefined,
    isDM,
  });

  const history = getSessionHistory(session.id);

  // Resolve context details
  const guildName = message.guild?.name;
  const channelName =
    "name" in message.channel && message.channel.name
      ? message.channel.name
      : "DM";

  // 9. Show typing indicator in the reply target — refresh every 8s
  let typingInterval: ReturnType<typeof setInterval> | null = null;
  const startTyping = () => {
    if (!("sendTyping" in replyTarget)) return;
    (replyTarget as { sendTyping: () => Promise<void> }).sendTyping().catch(() => {});
    typingInterval = setInterval(() => {
      (replyTarget as { sendTyping: () => Promise<void> }).sendTyping().catch(() => {});
    }, 8_000);
  };
  const stopTyping = () => {
    if (typingInterval) {
      clearInterval(typingInterval);
      typingInterval = null;
    }
  };

  startTyping();

  try {
    // 10. Agent dispatch — track latency
    const startTime = Date.now();
    const response: AgentResponse = await processMessage({
      message: cleanContent,
      sessionId: session.id,
      context: {
        guildName,
        channelName,
        userName: message.author.displayName ?? message.author.username,
        userId: message.author.id,
      },
      history,
      channelConfig,
    });
    const durationMs = Date.now() - startTime;

    stopTyping();

    // 11. Log both messages to DB (store the full text with images for history)
    const fullResponseText =
      response.text +
      (response.images.length > 0
        ? "\n" +
          response.images
            .map((img) => `![${img.alt || ""}](${img.source})`)
            .join("\n")
        : "");

    addMessage({
      sessionId: session.id,
      role: "user",
      content: cleanContent,
      discordMessageId: message.id,
    });

    addMessage({
      sessionId: session.id,
      role: "assistant",
      content: fullResponseText,
      usage: response.usage,
    });

    // 11b. Broadcast to WebSocket log viewers
    broadcastLog({
      type: "message",
      sessionId: session.id,
      role: "user",
      content: cleanContent,
      channel: channelName,
      user: message.author.username,
      timestamp: Date.now(),
    });
    broadcastLog({
      type: "message",
      sessionId: session.id,
      role: "assistant",
      content: fullResponseText,
      channel: channelName,
      timestamp: Date.now(),
    });

    // 12. Build image embeds and attachments
    const embeds = buildImageEmbeds(response.images);
    const files = buildImageAttachments(response.images);
    const hasMedia = embeds.length > 0 || files.length > 0;

    // 12b. Append usage line to the display text (with latency)
    let displayText = response.text;
    if (response.usage) {
      const usageLine = formatUsageLine(response.usage, durationMs);
      displayText = displayText ? `${displayText}\n${usageLine}` : usageLine;
    }

    // 13. Send reply — in thread if we created one, otherwise reply to original message
    const chunks = splitMessage(displayText);
    const sendInTarget = "send" in replyTarget;

    for (let i = 0; i < chunks.length; i++) {
      if (i === 0) {
        const replyPayload: {
          content: string;
          embeds?: EmbedBuilder[];
          files?: AttachmentBuilder[];
        } = { content: chunks[i] };

        if (hasMedia) {
          if (embeds.length > 0) replyPayload.embeds = embeds;
          if (files.length > 0) replyPayload.files = files;
        }

        if (shouldCreateThread && sendInTarget) {
          // Send in thread (not as a reply — we're already in the thread context)
          await (replyTarget as TextChannel | ThreadChannel).send(replyPayload);
        } else if (isThread && sendInTarget) {
          // In an existing thread, send directly (not as a reply to avoid clutter)
          await (replyTarget as TextChannel | ThreadChannel).send(replyPayload);
        } else {
          // DMs or fallback: use message.reply
          await message.reply(replyPayload);
        }
      } else {
        if (sendInTarget) {
          await (replyTarget as TextChannel | ThreadChannel).send(chunks[i]);
        }
      }
    }

    // Edge case: if there's no text but there are images, send images alone
    if (!displayText && hasMedia) {
      const replyPayload: {
        embeds?: EmbedBuilder[];
        files?: AttachmentBuilder[];
      } = {};
      if (embeds.length > 0) replyPayload.embeds = embeds;
      if (files.length > 0) replyPayload.files = files;

      if ((shouldCreateThread || isThread) && sendInTarget) {
        await (replyTarget as TextChannel | ThreadChannel).send(replyPayload);
      } else {
        await message.reply(replyPayload);
      }
    }

    const imageCount = response.images.length;
    // Log usage info (with latency)
    if (response.usage) {
      const u = response.usage;
      console.log(
        `[bot] Usage: model=${u.model} in=${u.inputTokens} out=${u.outputTokens} cache_create=${u.cacheCreationTokens} cache_read=${u.cacheReadTokens} latency=${fmtDuration(durationMs)}`,
      );
    }
    console.log(
      `[bot] Replied to ${message.author.tag} in ${channelName}${sessionThreadId ? ` (thread ${sessionThreadId})` : ""} (session ${session.id})${imageCount > 0 ? ` with ${imageCount} image(s)` : ""}${isVoice ? " [voice]" : ""}`,
    );
  } catch (err) {
    stopTyping();
    console.error("[bot] Error processing message:", err);

    // Record error signal for reflection
    recordSignal({
      type: "error",
      source: "messages",
      detail: `Message processing error: ${err instanceof Error ? err.message : String(err)}`,
      metadata: {
        error: err instanceof Error ? err.stack : String(err),
        channelName,
        userMessage: cleanContent.slice(0, 200),
      },
      sessionId: session.id,
      userId: message.author.id,
    });

    try {
      // Send error in the thread if we created one, otherwise reply to the original message
      if ((shouldCreateThread || isThread) && "send" in replyTarget) {
        await (replyTarget as TextChannel | ThreadChannel).send(
          "Sorry, I ran into an error processing your message. Please try again.",
        );
      } else {
        await message.reply(
          "Sorry, I ran into an error processing your message. Please try again.",
        );
      }
    } catch {
      // If even the error reply fails, just log it
      console.error("[bot] Failed to send error reply");
    }
  }
}
