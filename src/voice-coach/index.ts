/**
 * Voice Coach Orchestrator
 *
 * Wires together: mock cycling data → coach brain → ElevenLabs TTS → Discord playback.
 *
 * Polling loop runs every POLL_INTERVAL_MS:
 *   1. Get current cycling telemetry
 *   2. Ask the coach brain what to say (LLM)
 *   3. If coach has something to say → synthesize via ElevenLabs → play in voice channel
 *
 * Designed to run independently of the main voice assistant pipeline.
 */

import type { VoiceBasedChannel, Client, VoiceState } from "discord.js";
import { startRide, stopRide, getCyclingData } from "./mock-server.js";
import { getCoachResponse, resetCoachBrain } from "./coach-brain.js";
import { initElevenLabs, synthesizeElevenLabs } from "./elevenlabs-tts.js";
import {
  joinCoachChannel,
  leaveCoachChannel,
  playCoachAudio,
  isCoachConnected,
} from "./player.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 7_000; // 7 seconds

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

let coachChannelId: string | null = null;
let trackedUserId: string | null = null;
let discordClient: Client | null = null;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let pollTimer: ReturnType<typeof setInterval> | null = null;
let isProcessing = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize the voice coach system.
 *
 * @param config.channelId - The voice channel ID dedicated to coaching
 * @param config.userId - The user ID to track (auto-join when they join this channel)
 * @param config.elevenLabsApiKey - ElevenLabs API key
 * @param config.elevenLabsVoiceId - ElevenLabs voice ID
 */
export function initVoiceCoach(config: {
  channelId: string;
  userId: string;
  elevenLabsApiKey: string;
  elevenLabsVoiceId: string;
}): void {
  coachChannelId = config.channelId;
  trackedUserId = config.userId;

  initElevenLabs({
    apiKey: config.elevenLabsApiKey,
    voiceId: config.elevenLabsVoiceId,
  });

  console.log(`[voice-coach] Initialized — channel: ${coachChannelId}, tracking user: ${trackedUserId}`);
}

/**
 * Set the Discord client reference and register the voiceStateUpdate listener.
 */
export function setVoiceCoachClient(client: Client): void {
  discordClient = client;
  client.on("voiceStateUpdate", handleVoiceStateUpdate);
  console.log("[voice-coach] Registered voiceStateUpdate listener");
}

/**
 * Stop the voice coach and clean up.
 */
export function destroyVoiceCoach(): void {
  stopCoachSession();

  if (discordClient) {
    discordClient.removeListener("voiceStateUpdate", handleVoiceStateUpdate);
    discordClient = null;
  }

  console.log("[voice-coach] Destroyed");
}

// ---------------------------------------------------------------------------
// Voice state handler — auto-join/leave the coach channel
// ---------------------------------------------------------------------------

async function handleVoiceStateUpdate(
  oldState: VoiceState,
  newState: VoiceState,
): Promise<void> {
  // Only care about the tracked user
  if (newState.member?.id !== trackedUserId) return;

  const oldChannel = oldState.channelId;
  const newChannel = newState.channelId;

  // No change
  if (oldChannel === newChannel) return;

  // User joined the coach channel
  if (newChannel && newChannel === coachChannelId) {
    console.log(`[voice-coach] Tracked user joined coach channel — starting session`);

    try {
      const channel = await newState.guild.channels.fetch(newChannel);
      if (!channel || !channel.isVoiceBased()) {
        console.error("[voice-coach] Channel is not voice-based");
        return;
      }
      await startCoachSession(channel);
    } catch (err) {
      console.error("[voice-coach] Failed to start session:", err);
    }
  }
  // User left the coach channel
  else if (oldChannel === coachChannelId) {
    console.log("[voice-coach] Tracked user left coach channel — stopping session");
    stopCoachSession();
  }
}

// ---------------------------------------------------------------------------
// Coach session lifecycle
// ---------------------------------------------------------------------------

async function startCoachSession(channel: VoiceBasedChannel): Promise<void> {
  // Join the voice channel
  await joinCoachChannel(channel);

  // Reset state
  resetCoachBrain();
  startRide();

  // Start the polling loop
  pollTimer = setInterval(pollCycle, POLL_INTERVAL_MS);
  console.log(`[voice-coach] Session started — polling every ${POLL_INTERVAL_MS}ms`);

  // Play an intro message after a short delay
  setTimeout(async () => {
    try {
      const introText = "Alright, let's get to work. I'm watching your numbers. Don't disappoint me.";
      console.log(`[voice-coach] Playing intro: "${introText}"`);
      const audio = await synthesizeElevenLabs(introText);
      await playCoachAudio(audio);
    } catch (err) {
      console.error("[voice-coach] Failed to play intro:", err);
    }
  }, 2000);
}

function stopCoachSession(): void {
  // Stop polling
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  // Stop the mock ride
  stopRide();

  // Leave voice
  leaveCoachChannel();

  console.log("[voice-coach] Session stopped");
}

// ---------------------------------------------------------------------------
// Core polling loop
// ---------------------------------------------------------------------------

async function pollCycle(): Promise<void> {
  // Don't stack polls if processing is slow
  if (isProcessing) {
    console.log("[voice-coach] Still processing previous cycle, skipping");
    return;
  }

  if (!isCoachConnected()) {
    console.log("[voice-coach] Not connected, skipping poll");
    return;
  }

  isProcessing = true;
  const cycleStart = Date.now();

  try {
    // 1. Get cycling data
    const data = getCyclingData();
    if (!data) {
      console.log("[voice-coach] No cycling data available");
      return;
    }

    console.log(
      `[voice-coach] 📊 ${data.phase} | HR:${data.hr} W:${data.watts} CAD:${data.cadence} Z${data.zone} | ${data.elapsed_min}min`,
    );

    // 2. Ask the coach brain
    const coachText = await getCoachResponse(data);

    if (!coachText) {
      // Coach chose silence
      return;
    }

    // 3. Synthesize via ElevenLabs
    const audio = await synthesizeElevenLabs(coachText);

    // 4. Play in voice channel
    await playCoachAudio(audio);

    const elapsed = Date.now() - cycleStart;
    console.log(`[voice-coach] ✅ Cycle complete in ${elapsed}ms`);
  } catch (err) {
    console.error("[voice-coach] ❌ Poll cycle error:", err);
  } finally {
    isProcessing = false;
  }
}
