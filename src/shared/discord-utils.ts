// ---------------------------------------------------------------------------
// Shared Discord utility functions — thread creation, channel type checks,
// message splitting
// ---------------------------------------------------------------------------

import { registerBotThread } from "../bot/messages.js";

// ---------------------------------------------------------------------------
// Channel type constants (discord.js ChannelType enum values)
// ---------------------------------------------------------------------------

/** ChannelType.GuildText = 0 */
const GUILD_TEXT = 0;
/** ChannelType.GuildAnnouncement = 5 */
const GUILD_ANNOUNCEMENT = 5;

/** Discord's max thread name length. */
export const MAX_THREAD_NAME_LENGTH = 100;

/** Discord's max message content length. */
export const DISCORD_MAX_LENGTH = 2000;

// ---------------------------------------------------------------------------
// Channel type helpers
// ---------------------------------------------------------------------------

/**
 * Check if a channel is a guild text channel (not a thread, not a DM).
 * These channels require messages to be sent inside threads per the
 * thread-only policy.
 */
export function isGuildTextChannel(channel: any): boolean {
  return channel.type === GUILD_TEXT || channel.type === GUILD_ANNOUNCEMENT;
}

// ---------------------------------------------------------------------------
// Message splitting
// ---------------------------------------------------------------------------

/**
 * Split a message into chunks that fit within Discord's 2000-character limit.
 * Tries to split at newline boundaries first, then spaces, then hard-splits.
 */
export function splitMessage(text: string): string[] {
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

/**
 * Send a long message to a Discord channel, automatically chunking if it
 * exceeds the 2000-character limit. Each chunk is sent as a separate message.
 */
export async function sendChunked(
  target: { send: (content: string) => Promise<any> },
  text: string,
): Promise<void> {
  const chunks = splitMessage(text);
  for (const chunk of chunks) {
    await target.send(chunk);
  }
}

// ---------------------------------------------------------------------------
// Thread creation
// ---------------------------------------------------------------------------

/**
 * Create a public thread in a guild text channel and register it as
 * bot-created so the bot responds without @mentions.
 *
 * If the channel is not a guild text channel (e.g. already a thread, a DM,
 * or a voice channel), returns the channel unchanged.
 *
 * @param channel  The Discord channel object.
 * @param threadName  Desired thread name (will be truncated to 100 chars).
 * @param source  Label for log messages (e.g. "agent", "cron", "evolution").
 * @returns The thread channel to send messages in (or the original channel).
 */
export async function ensureThread(
  channel: any,
  threadName: string,
  source: string,
): Promise<any> {
  if (!isGuildTextChannel(channel)) return channel;

  const name = threadName.slice(0, MAX_THREAD_NAME_LENGTH);
  console.log(
    `[${source}] Auto-creating thread "${name}" in channel ${channel.id} (enforcing thread-only policy)`,
  );

  const thread = await channel.threads.create({
    name,
    // ChannelType.PublicThread = 11
    type: 11,
  });

  registerBotThread(thread.id);
  return thread;
}

// ---------------------------------------------------------------------------
// Thread name generation
// ---------------------------------------------------------------------------

/**
 * Generate a short thread name from a text string.
 * Takes the first line, falls back to a default if too short,
 * and truncates with ellipsis if too long.
 */
export function generateThreadName(text: string, fallback = "Bot message"): string {
  // Take the first line, trimmed
  let name = text.split("\n")[0].trim();

  // If too short or empty, use the fallback
  if (!name || name.length < 3) {
    name = fallback;
  }

  // Truncate with ellipsis
  if (name.length > MAX_THREAD_NAME_LENGTH - 1) {
    name = name.slice(0, MAX_THREAD_NAME_LENGTH - 1) + "…";
  }

  return name;
}
