/**
 * Voice coach audio player — plays mp3/audio buffers into a Discord voice channel.
 *
 * Uses @discordjs/voice AudioPlayer to play ElevenLabs mp3 output.
 * Separate from the main voice pipeline's audio player to avoid conflicts.
 */

import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
  type VoiceConnection,
} from "@discordjs/voice";
import { Readable } from "node:stream";
import type { VoiceBasedChannel } from "discord.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let connection: VoiceConnection | null = null;
let player = createAudioPlayer();
let channelId: string | null = null;
let isPlaying = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Join a voice channel for coaching audio playback.
 */
export async function joinCoachChannel(channel: VoiceBasedChannel): Promise<void> {
  if (connection && channelId === channel.id) {
    return; // Already connected
  }

  // Disconnect any existing
  if (connection) {
    leaveCoachChannel();
  }

  console.log(`[coach-player] Joining ${channel.name} (${channel.id})`);

  connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 30_000);

  connection.subscribe(player);
  channelId = channel.id;

  // Handle disconnection
  connection.on("stateChange" as any, (_oldState: any, newState: any) => {
    if (
      newState.status === VoiceConnectionStatus.Disconnected ||
      newState.status === VoiceConnectionStatus.Destroyed
    ) {
      console.log("[coach-player] Connection lost");
      connection = null;
      channelId = null;
    }
  });

  console.log(`[coach-player] Connected to ${channel.name}`);
}

/**
 * Leave the coaching voice channel.
 */
export function leaveCoachChannel(): void {
  if (connection) {
    console.log(`[coach-player] Leaving channel ${channelId}`);
    player.stop();
    connection.destroy();
    connection = null;
    channelId = null;
  }
}

/**
 * Play an mp3 audio buffer through the voice connection.
 * Returns a promise that resolves when playback finishes.
 */
export async function playCoachAudio(mp3Buffer: Buffer): Promise<void> {
  if (!connection) {
    console.warn("[coach-player] Not connected, can't play audio");
    return;
  }

  if (isPlaying) {
    console.log("[coach-player] Already playing, skipping");
    return;
  }

  isPlaying = true;

  return new Promise<void>((resolve, reject) => {
    try {
      const stream = Readable.from(mp3Buffer);
      const resource = createAudioResource(stream, {
        inputType: StreamType.Arbitrary,
      });

      player.play(resource);

      const onIdle = () => {
        player.removeListener("error", onError);
        isPlaying = false;
        resolve();
      };

      const onError = (err: Error) => {
        player.removeListener(AudioPlayerStatus.Idle, onIdle);
        isPlaying = false;
        console.error("[coach-player] ❌ Playback error:", err);
        reject(err);
      };

      player.once(AudioPlayerStatus.Idle, onIdle);
      player.once("error", onError);
    } catch (err) {
      isPlaying = false;
      reject(err);
    }
  });
}

/**
 * Check if the coach player is currently connected.
 */
export function isCoachConnected(): boolean {
  return connection !== null;
}

/**
 * Get the current voice connection (for the listener to subscribe to audio).
 */
export function getCoachConnection(): VoiceConnection | null {
  return connection;
}

/**
 * Get the current channel ID.
 */
export function getCoachChannelId(): string | null {
  return channelId;
}
