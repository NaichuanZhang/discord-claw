import { type Client, type Message as DiscordMessage } from "discord.js";
import { processMessage } from "../agent/agent.js";
import { resolveSession, getSessionHistory } from "../agent/sessions.js";
import { getChannelConfig, addMessage } from "../db/index.js";
import { broadcastLog } from "../gateway/server.js";
import { isRestarting } from "../restart.js";

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
// Main message handler
// ---------------------------------------------------------------------------

export async function handleMessage(message: DiscordMessage): Promise<void> {
  // 0. Filter: ignore messages during restart (prevents double replies)
  if (isRestarting()) return;

  // 1. Filter: skip bot messages
  if (message.author.bot) return;

  const isDM = message.channel.isDMBased();

  console.log(`[bot] Message from ${message.author.tag} isDM=${isDM} content="${message.content.slice(0, 80)}"`);

  // 2. Filter: in guild channels, only respond when mentioned
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
  const isThread = "isThread" in message.channel && typeof message.channel.isThread === "function"
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
  const cleanContent = message.content.replace(/<@!?\d+>/g, "").trim();

  if (!cleanContent) return; // Nothing left after stripping mentions

  // Resolve context details
  const guildName = message.guild?.name;
  const channelName = "name" in message.channel && message.channel.name
    ? message.channel.name
    : "DM";

  // 6. Show typing indicator — refresh every 8s (Discord typing expires after ~10s)
  let typingInterval: ReturnType<typeof setInterval> | null = null;
  const startTyping = () => {
    if (!("sendTyping" in message.channel)) return;
    message.channel.sendTyping().catch(() => {});
    typingInterval = setInterval(() => {
      (message.channel as { sendTyping: () => Promise<void> }).sendTyping().catch(() => {});
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
    // 7. Agent dispatch
    const response = await processMessage({
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

    // 8. Log both messages to DB
    addMessage({
      sessionId: session.id,
      role: "user",
      content: cleanContent,
      discordMessageId: message.id,
    });

    addMessage({
      sessionId: session.id,
      role: "assistant",
      content: response,
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
      content: response,
      channel: channelName,
      timestamp: Date.now(),
    });

    // 9. Reply — split if necessary
    const chunks = splitMessage(response);

    for (let i = 0; i < chunks.length; i++) {
      if (i === 0) {
        await message.reply(chunks[i]);
      } else {
        if ("send" in message.channel) {
          await message.channel.send(chunks[i]);
        }
      }
    }

    console.log(
      `[bot] Replied to ${message.author.tag} in ${channelName} (session ${session.id})`,
    );
  } catch (err) {
    stopTyping();
    console.error("[bot] Error processing message:", err);
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
