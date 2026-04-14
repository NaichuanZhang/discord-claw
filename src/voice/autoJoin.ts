/**
 * Auto-join/leave voice channels when a tracked user joins/leaves.
 *
 * Listens to Discord's `voiceStateUpdate` event and:
 *   - When the tracked user joins a voice channel → bot auto-joins
 *   - When the tracked user leaves a voice channel → bot auto-leaves
 */

import type { Client, VoiceState } from "discord.js";
import { startVoice, stopVoice, isConnected } from "./index.js";
import { getActiveChannelId } from "./connection.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let trackedUserId: string | null = null;
let client: Client | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register the voiceStateUpdate listener on the Discord client.
 * @param discordClient - The Discord.js client
 * @param userId - The user ID to track (auto-join when they join)
 */
export function enableAutoJoin(discordClient: Client, userId: string): void {
  trackedUserId = userId;
  client = discordClient;

  discordClient.on("voiceStateUpdate", handleVoiceStateUpdate);
  console.log(`[voice:autoJoin] Tracking user ${userId} for auto-join/leave`);
}

/**
 * Remove the voiceStateUpdate listener.
 */
export function disableAutoJoin(): void {
  if (client) {
    client.removeListener("voiceStateUpdate", handleVoiceStateUpdate);
    client = null;
  }
  trackedUserId = null;
  console.log("[voice:autoJoin] Auto-join disabled");
}

// ---------------------------------------------------------------------------
// Event handler
// ---------------------------------------------------------------------------

async function handleVoiceStateUpdate(
  oldState: VoiceState,
  newState: VoiceState,
): Promise<void> {
  // Only care about the tracked user
  if (newState.member?.id !== trackedUserId) return;

  const oldChannel = oldState.channelId;
  const newChannel = newState.channelId;

  // No change in channel
  if (oldChannel === newChannel) return;

  // User joined or switched to a voice channel
  if (newChannel) {
    // Don't rejoin if we're already in that channel
    const currentBotChannel = getActiveChannelId();
    if (currentBotChannel === newChannel) return;

    // If bot is in a different channel, leave first
    if (isConnected()) {
      console.log(`[voice:autoJoin] User switched channels, leaving current channel`);
      stopVoice();
    }

    // Fetch the voice channel object
    try {
      const channel = await newState.guild.channels.fetch(newChannel);
      if (!channel || !channel.isVoiceBased()) {
        console.error(`[voice:autoJoin] Channel ${newChannel} is not voice-based`);
        return;
      }

      console.log(`[voice:autoJoin] User joined ${channel.name}, auto-joining...`);
      await startVoice(channel);
      console.log(`[voice:autoJoin] Auto-joined ${channel.name}`);
    } catch (err) {
      console.error("[voice:autoJoin] Failed to auto-join:", err);
    }
  }
  // User left voice (no new channel)
  else if (oldChannel && !newChannel) {
    // Only leave if we're in the channel they left
    const currentBotChannel = getActiveChannelId();
    if (currentBotChannel === oldChannel && isConnected()) {
      console.log(`[voice:autoJoin] User left voice channel, auto-leaving...`);
      stopVoice();
      console.log(`[voice:autoJoin] Auto-left voice channel`);
    }
  }
}
