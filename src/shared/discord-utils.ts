// ---------------------------------------------------------------------------
// Shared Discord utility functions — thread creation, channel type checks
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
