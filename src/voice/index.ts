/**
 * Voice assistant orchestrator.
 *
 * Wires together: connection → receiver → VAD → STT → agent → TTS → playback.
 *
 * Flow:
 *   User speaks → opus decode → downsample → Silero VAD → utterance detection
 *   → EigenAI Whisper STT → Claude Sonnet → EigenAI Chatterbox TTS → play audio
 */

import {
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  StreamType,
  type VoiceConnection,
} from "@discordjs/voice";
import { Readable } from "node:stream";
import type { VoiceBasedChannel, Client } from "discord.js";
import { joinChannel, leaveChannel, isConnected, getConnection } from "./connection.js";
import { subscribeToUser, downsampleToMono16kInt16, type UserAudioStream } from "./receiver.js";
import { SileroVAD, FRAME_SIZE } from "./vad.js";
import { transcribe } from "./stt.js";
import { synthesize } from "./tts.js";
import { processVoiceUtterance, clearVoiceHistory } from "./agent.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SILENCE_DURATION_MS = parseInt(process.env.VOICE_SILENCE_MS || "1500", 10);
const MIN_UTTERANCE_MS = parseInt(process.env.VOICE_MIN_UTTERANCE_MS || "500", 10);
const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/** At 16kHz, samples per ms */
const SAMPLES_PER_MS = 16;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let vad: SileroVAD | null = null;
let audioPlayer = createAudioPlayer();
let userStreams: Map<string, UserAudioStream> = new Map();
let processing = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let discordClient: Client | null = null;

// Per-user utterance state
interface UserUtteranceState {
  /** Accumulated raw PCM (48kHz stereo) chunks for the current utterance */
  rawChunks: Int16Array[];
  /** Total raw samples accumulated */
  totalRawSamples: number;
  /** VAD frame buffer — accumulates samples until we have FRAME_SIZE */
  vadFrameBuffer: Float32Array;
  vadFrameOffset: number;
  /** Whether we're currently in speech */
  isSpeaking: boolean;
  /** Timestamp of last speech detection */
  lastSpeechTime: number;
  /** Timer for silence detection */
  silenceTimer: ReturnType<typeof setTimeout> | null;
  /** Timestamp when speech started */
  speechStartTime: number;
}

const userStates = new Map<string, UserUtteranceState>();

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize the voice assistant. Must be called at startup.
 */
export async function initVoice(): Promise<void> {
  vad = new SileroVAD();
  await vad.init();
  console.log("[voice] Voice assistant initialized");
}

/**
 * Set the Discord client reference (for resolving user display names).
 */
export function setVoiceDiscordClient(client: Client): void {
  discordClient = client;
}

// ---------------------------------------------------------------------------
// Join / Leave
// ---------------------------------------------------------------------------

/**
 * Join a voice channel and start listening.
 */
export async function startVoice(channel: VoiceBasedChannel): Promise<void> {
  if (!vad) {
    throw new Error("Voice not initialized. Call initVoice() first.");
  }

  const connection = await joinChannel(channel);

  // Set up the audio player on this connection
  connection.subscribe(audioPlayer);

  // Listen for users speaking
  const receiver = connection.receiver;

  receiver.speaking.on("start", (userId: string) => {
    if (userStreams.has(userId)) return; // Already subscribed

    console.log(`[voice] User ${userId} started speaking`);
    resetIdleTimer();

    // Initialize utterance state
    const state: UserUtteranceState = {
      rawChunks: [],
      totalRawSamples: 0,
      vadFrameBuffer: new Float32Array(FRAME_SIZE),
      vadFrameOffset: 0,
      isSpeaking: false,
      lastSpeechTime: 0,
      silenceTimer: null,
      speechStartTime: 0,
    };
    userStates.set(userId, state);

    // Subscribe to their audio
    const stream = subscribeToUser(
      connection,
      userId,
      // onFrame: downsampled 16kHz mono Float32 for VAD
      (frame: Float32Array) => handleVadFrame(userId, frame),
      // onRawPcm: 48kHz stereo Int16 for buffering
      (pcm: Int16Array) => handleRawPcm(userId, pcm),
    );

    userStreams.set(userId, stream);
  });

  receiver.speaking.on("end", (userId: string) => {
    // Don't immediately clean up — wait for silence timer to fire
    // This handles brief pauses in speech
    console.log(`[voice] User ${userId} stopped speaking (Discord event)`);
  });

  resetIdleTimer();
  console.log(`[voice] Listening in ${channel.name}`);
}

/**
 * Leave the voice channel and clean up.
 */
export function stopVoice(): void {
  // Clean up all user streams
  for (const [userId, stream] of userStreams) {
    stream.destroy();
    const state = userStates.get(userId);
    if (state?.silenceTimer) clearTimeout(state.silenceTimer);
  }
  userStreams.clear();
  userStates.clear();

  // Stop audio player
  audioPlayer.stop();

  // Clear idle timer
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  // Clear voice history
  clearVoiceHistory();

  // Disconnect
  leaveChannel();

  console.log("[voice] Voice assistant stopped");
}

// ---------------------------------------------------------------------------
// Audio processing pipeline
// ---------------------------------------------------------------------------

/**
 * Handle raw PCM data from a user (buffer for STT).
 */
function handleRawPcm(userId: string, pcm: Int16Array): void {
  const state = userStates.get(userId);
  if (!state) return;

  if (state.isSpeaking) {
    state.rawChunks.push(new Int16Array(pcm)); // Copy
    state.totalRawSamples += pcm.length;
  }
}

/**
 * Handle a downsampled audio frame for VAD processing.
 */
async function handleVadFrame(userId: string, frame: Float32Array): Promise<void> {
  const state = userStates.get(userId);
  if (!state || !vad) return;

  // Accumulate samples into the VAD frame buffer
  let offset = 0;
  while (offset < frame.length) {
    const remaining = FRAME_SIZE - state.vadFrameOffset;
    const toCopy = Math.min(remaining, frame.length - offset);
    state.vadFrameBuffer.set(frame.subarray(offset, offset + toCopy), state.vadFrameOffset);
    state.vadFrameOffset += toCopy;
    offset += toCopy;

    // When we have a full frame, process it
    if (state.vadFrameOffset >= FRAME_SIZE) {
      try {
        const isSpeech = await vad.isSpeech(state.vadFrameBuffer);

        if (isSpeech) {
          if (!state.isSpeaking) {
            // Speech started
            state.isSpeaking = true;
            state.speechStartTime = Date.now();
            state.rawChunks = [];
            state.totalRawSamples = 0;
            console.log(`[voice] Speech detected from ${userId}`);

            // If bot is speaking, interrupt it
            if (audioPlayer.state.status === AudioPlayerStatus.Playing) {
              console.log("[voice] Interrupting bot playback");
              audioPlayer.stop();
            }
          }

          state.lastSpeechTime = Date.now();

          // Reset silence timer
          if (state.silenceTimer) {
            clearTimeout(state.silenceTimer);
            state.silenceTimer = null;
          }
        } else if (state.isSpeaking) {
          // In speech but VAD says silence — start silence timer
          if (!state.silenceTimer) {
            state.silenceTimer = setTimeout(() => {
              onUtteranceComplete(userId);
            }, SILENCE_DURATION_MS);
          }
        }
      } catch (err) {
        // VAD processing error — skip this frame
      }

      // Reset frame buffer
      state.vadFrameOffset = 0;
    }
  }
}

/**
 * Called when an utterance is considered complete (silence after speech).
 */
async function onUtteranceComplete(userId: string): Promise<void> {
  const state = userStates.get(userId);
  if (!state || !state.isSpeaking) return;

  // Mark as no longer speaking
  state.isSpeaking = false;
  if (state.silenceTimer) {
    clearTimeout(state.silenceTimer);
    state.silenceTimer = null;
  }

  // Check minimum utterance length
  const utteranceDuration = Date.now() - state.speechStartTime;
  if (utteranceDuration < MIN_UTTERANCE_MS) {
    console.log(`[voice] Utterance too short (${utteranceDuration}ms), discarding`);
    state.rawChunks = [];
    state.totalRawSamples = 0;
    return;
  }

  // If already processing another utterance, skip (queue could be added later)
  if (processing) {
    console.log("[voice] Already processing, skipping utterance");
    state.rawChunks = [];
    state.totalRawSamples = 0;
    return;
  }

  // Grab the raw chunks and clear state
  const rawChunks = state.rawChunks;
  state.rawChunks = [];
  state.totalRawSamples = 0;

  if (rawChunks.length === 0) {
    return;
  }

  // Reset VAD state for fresh detection
  vad?.reset();

  processing = true;

  try {
    // 1. Concatenate raw PCM chunks
    const totalSamples = rawChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const rawPcm = new Int16Array(totalSamples);
    let writeOffset = 0;
    for (const chunk of rawChunks) {
      rawPcm.set(chunk, writeOffset);
      writeOffset += chunk.length;
    }

    // 2. Downsample to 16kHz mono Int16 for STT
    const mono16k = downsampleToMono16kInt16(rawPcm);

    const durationSec = mono16k.length / 16000;
    console.log(`[voice] Processing utterance: ${durationSec.toFixed(1)}s from user ${userId}`);

    // 3. STT
    const text = await transcribe(mono16k);

    if (!text || text.trim().length === 0) {
      console.log("[voice] Empty transcription, skipping");
      return;
    }

    // 4. Get user display name
    const userName = await getUserDisplayName(userId);

    // 5. Claude voice agent
    const response = await processVoiceUtterance(text, userName);

    // 6. TTS
    const audioBuffer = await synthesize(response);

    // 7. Play audio
    await playAudio(audioBuffer);

    console.log(`[voice] Full pipeline complete for: "${text.slice(0, 50)}"`);
  } catch (err) {
    console.error("[voice] Pipeline error:", err);
  } finally {
    processing = false;
  }
}

// ---------------------------------------------------------------------------
// Audio playback
// ---------------------------------------------------------------------------

/**
 * Play a WAV audio buffer through the voice connection.
 */
async function playAudio(wavBuffer: Buffer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    try {
      const stream = Readable.from(wavBuffer);
      const resource = createAudioResource(stream, {
        inputType: StreamType.Arbitrary,
      });

      audioPlayer.play(resource);

      const onIdle = () => {
        audioPlayer.removeListener("error", onError);
        resolve();
      };

      const onError = (err: Error) => {
        audioPlayer.removeListener(AudioPlayerStatus.Idle, onIdle);
        console.error("[voice] Audio player error:", err);
        reject(err);
      };

      audioPlayer.once(AudioPlayerStatus.Idle, onIdle);
      audioPlayer.once("error", onError);
    } catch (err) {
      reject(err);
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get a user's display name from Discord.
 */
async function getUserDisplayName(userId: string): Promise<string> {
  if (!discordClient) return `User ${userId}`;

  try {
    const user = await discordClient.users.fetch(userId);
    return user.displayName || user.username || `User ${userId}`;
  } catch {
    return `User ${userId}`;
  }
}

/**
 * Reset the idle timer. Auto-leaves after IDLE_TIMEOUT_MS of no activity.
 */
function resetIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
  }

  idleTimer = setTimeout(() => {
    console.log("[voice] Idle timeout reached, leaving voice channel");
    stopVoice();
  }, IDLE_TIMEOUT_MS);
}

// ---------------------------------------------------------------------------
// Clean up on destroy
// ---------------------------------------------------------------------------

/**
 * Destroy VAD and clean up all resources.
 */
export async function destroyVoice(): Promise<void> {
  stopVoice();
  if (vad) {
    await vad.destroy();
    vad = null;
  }
}

// ---------------------------------------------------------------------------
// Re-export for external use
// ---------------------------------------------------------------------------

export { isConnected } from "./connection.js";
