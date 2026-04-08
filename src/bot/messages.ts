import {
  type Client,
  type Message as DiscordMessage,
  EmbedBuilder,
  AttachmentBuilder,
  MessageFlags,
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
// Token cost formatting
// ---------------------------------------------------------------------------

/** Per-million-token pricing by model prefix. Extend as needed. */
interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

const DEFAULT_PRICING: ModelPricing = {
  input: 3.0,
  output: 15.0,
  cacheRead: 0.30,
  cacheCreation: 3.75,
};

/**
 * Format token usage as a single-line cost string.
 * Example: `📊 opus-4 · 28.9k in / 450 out · $0.0938`
 */
function formatUsageLine(usage: TokenUsage): string {
  const pricing = DEFAULT_PRICING;

  const cost =
    (usage.inputTokens * pricing.input +
      usage.outputTokens * pricing.output +
      usage.cacheReadTokens * pricing.cacheRead +
      usage.cacheCreationTokens * pricing.cacheCreation) /
    1_000_000;

  const fmtTokens = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
  };

  // Shorten model name for display
  const shortModel = usage.model
    .replace(/^bedrock-/, "")
    .replace(/-\d{8}$/, "")
    .replace(/-\d+[km]$/, "");

  return `-# 📊 ${shortModel} · ${fmtTokens(usage.inputTokens)} in / ${fmtTokens(usage.outputTokens)} out · $${cost.toFixed(4)}`;
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

  console.log(
    `[bot] Message from ${message.author.tag} isDM=${isDM} isVoice=${isVoice} hasAudio=${hasAudio} content="${message.content.slice(0, 80)}"`,
  );

  // 2. Filter: in guild channels, only respond when mentioned
  //    Exception: voice messages in DMs always get processed
  if (!isDM) {
    const botUser = botClient?.user;
    if (!botUser) {
      console.log("[bot] Skipping — botClient.user is null");
      return;
    }
    if (!message.mentions.has(botUser)) {
      console.log("[bot] Skipping — bot not mentioned");
      return;
    }
  }

  // 3. Filter: check channel config
  const channelConfig = getChannelConfig(message.channelId);
  if (channelConfig?.enabled === false) return;

  // 4. Session resolve
  const isThread =
    "isThread" in message.channel &&
    typeof message.channel.isThread === "function"
      ? message.channel.isThread()
      : false;

  const session = resolveSession({
    threadId: isThread ? message.channel.id : undefined,
    channelId: message.channelId,
    userId: message.author.id,
    guildId: message.guildId || undefined,
    isDM,
  });

  // 5. Build context
  const history = getSessionHistory(session.id);

  // Strip bot mention from content before sending to the agent
  let cleanContent = message.content.replace(/<@!?\d+>/g, "").trim();

  // 5b. Handle voice messages — transcribe audio and use as message content
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

  // Resolve context details
  const guildName = message.guild?.name;
  const channelName =
    "name" in message.channel && message.channel.name
      ? message.channel.name
      : "DM";

  // 6. Show typing indicator — refresh every 8s (Discord typing expires after ~10s)
  let typingInterval: ReturnType<typeof setInterval> | null = null;
  const startTyping = () => {
    if (!("sendTyping" in message.channel)) return;
    message.channel.sendTyping().catch(() => {});
    typingInterval = setInterval(() => {
      (
        message.channel as { sendTyping: () => Promise<void> }
      ).sendTyping().catch(() => {});
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
    // 7. Agent dispatch — now returns AgentResponse with text + images + usage
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

    stopTyping();

    // 8. Log both messages to DB (store the full text with images for history)
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

    // 8b. Broadcast to WebSocket log viewers
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

    // 9. Build image embeds and attachments
    const embeds = buildImageEmbeds(response.images);
    const files = buildImageAttachments(response.images);
    const hasMedia = embeds.length > 0 || files.length > 0;

    // 10. Reply — split text if necessary, attach images to the first message
    const chunks = splitMessage(response.text);

    for (let i = 0; i < chunks.length; i++) {
      if (i === 0) {
        // First message: include text + any images
        const replyPayload: {
          content: string;
          embeds?: EmbedBuilder[];
          files?: AttachmentBuilder[];
        } = { content: chunks[i] };

        if (hasMedia) {
          if (embeds.length > 0) replyPayload.embeds = embeds;
          if (files.length > 0) replyPayload.files = files;
        }

        await message.reply(replyPayload);
      } else {
        if ("send" in message.channel) {
          await message.channel.send(chunks[i]);
        }
      }
    }

    // Edge case: if there's no text but there are images, send images alone
    if (!response.text && hasMedia) {
      const replyPayload: {
        embeds?: EmbedBuilder[];
        files?: AttachmentBuilder[];
      } = {};
      if (embeds.length > 0) replyPayload.embeds = embeds;
      if (files.length > 0) replyPayload.files = files;
      await message.reply(replyPayload);
    }

    // 11. Send token cost line as a follow-up message
    if (response.usage && "send" in message.channel) {
      const costLine = formatUsageLine(response.usage);
      await message.channel.send(costLine);
    }

    const imageCount = response.images.length;
    // Log usage info
    if (response.usage) {
      const u = response.usage;
      console.log(
        `[bot] Usage: model=${u.model} in=${u.inputTokens} out=${u.outputTokens} cache_create=${u.cacheCreationTokens} cache_read=${u.cacheReadTokens}`,
      );
    }
    console.log(
      `[bot] Replied to ${message.author.tag} in ${channelName} (session ${session.id})${imageCount > 0 ? ` with ${imageCount} image(s)` : ""}${isVoice ? " [voice]" : ""}`,
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
      await message.reply(
        "Sorry, I ran into an error processing your message. Please try again.",
      );
    } catch {
      // If even the error reply fails, just log it
      console.error("[bot] Failed to send error reply");
    }
  }
}
