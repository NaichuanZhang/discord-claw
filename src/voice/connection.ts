/**
 * Voice connection manager — handles joining/leaving voice channels
 * and managing the VoiceConnection lifecycle.
 */

import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
  type VoiceConnection,
} from "@discordjs/voice";
import type { VoiceBasedChannel } from "discord.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let activeConnection: VoiceConnection | null = null;
let activeChannelId: string | null = null;
let activeGuildId: string | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Join a voice channel. Returns the VoiceConnection.
 * If already connected to this channel, returns existing connection.
 */
export async function joinChannel(channel: VoiceBasedChannel): Promise<VoiceConnection> {
  // Already connected to this channel
  if (activeConnection && activeChannelId === channel.id) {
    return activeConnection;
  }

  // Disconnect from any existing channel first
  if (activeConnection) {
    leaveChannel();
  }

  console.log(`[voice] Joining voice channel: ${channel.name} (${channel.id})`);

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false, // We need to hear audio
    selfMute: false, // We need to speak
  });

  // Wait for the connection to be ready
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    console.log(`[voice] Connected to ${channel.name}`);
  } catch (err) {
    connection.destroy();
    throw new Error(`Failed to join voice channel: ${err}`);
  }

  // Handle disconnection
  connection.on("stateChange" as any, (_oldState: any, newState: any) => {
    if (newState.status === VoiceConnectionStatus.Disconnected) {
      console.log("[voice] Disconnected from voice channel");
      cleanup();
    } else if (newState.status === VoiceConnectionStatus.Destroyed) {
      console.log("[voice] Voice connection destroyed");
      cleanup();
    }
  });

  activeConnection = connection;
  activeChannelId = channel.id;
  activeGuildId = channel.guild.id;

  return connection;
}

/**
 * Leave the current voice channel.
 */
export function leaveChannel(): void {
  if (activeConnection) {
    console.log(`[voice] Leaving voice channel ${activeChannelId}`);
    activeConnection.destroy();
    cleanup();
  }
}

/**
 * Get the current active connection, or null.
 */
export function getConnection(): VoiceConnection | null {
  return activeConnection;
}

/**
 * Check if the bot is currently in a voice channel.
 */
export function isConnected(): boolean {
  return activeConnection !== null;
}

/**
 * Get the current voice channel ID.
 */
export function getActiveChannelId(): string | null {
  return activeChannelId;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function cleanup(): void {
  activeConnection = null;
  activeChannelId = null;
  activeGuildId = null;
}
