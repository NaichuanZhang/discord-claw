/**
 * Voice Coach Listener — subscribes to rider audio in the coach voice channel,
 * runs VAD + STT, and queues transcriptions for the coach brain to consume.
 *
 * Design: rider speech is buffered as timestamped messages. The coach brain
 * reads and flushes the queue each poll cycle (every 7s), so the coach
 * responds on its own schedule — not in real-time.
 */

import type { VoiceConnection } from "@discordjs/voice";
import { subscribeToUser, downsampleToMono16kInt16, type UserAudioStream } from "../voice/receiver.js";
import { SileroVAD, FRAME_SIZE } from "../voice/vad.js";
import { transcribe } from "../voice/stt.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SILENCE_DURATION_MS = 800;
const MIN_UTTERANCE_MS = 400;

// ---------------------------------------------------------------------------
// Rider message queue
// ---------------------------------------------------------------------------

export interface RiderMessage {
  text: string;
  timestamp: number;
  /** Seconds ago relative to when it's consumed */
  agoSec?: number;
}

const messageQueue: RiderMessage[] = [];
const MAX_QUEUE_SIZE = 10;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let vad: SileroVAD | null = null;
let userStream: UserAudioStream | null = null;
let isListening = false;

// Per-user utterance state
interface UtteranceState {
  rawChunks: Int16Array[];
  totalRawSamples: number;
  vadFrameBuffer: Float32Array;
  vadFrameOffset: number;
  isSpeaking: boolean;
  lastSpeechTime: number;
  silenceTimer: ReturnType<typeof setTimeout> | null;
  speechStartTime: number;
  vadFrameCount: number;
  vadSpeechFrames: number;
  isTranscribing: boolean;
}

let utteranceState: UtteranceState | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start listening to a user in the voice connection.
 * Runs VAD → STT and queues transcriptions.
 */
export async function startListening(
  connection: VoiceConnection,
  userId: string,
): Promise<void> {
  if (isListening) {
    console.log("[coach-listener] Already listening, stopping first");
    stopListening();
  }

  // Initialize VAD
  vad = new SileroVAD();
  await vad.init();

  // Initialize utterance state
  utteranceState = {
    rawChunks: [],
    totalRawSamples: 0,
    vadFrameBuffer: new Float32Array(FRAME_SIZE),
    vadFrameOffset: 0,
    isSpeaking: false,
    lastSpeechTime: 0,
    silenceTimer: null,
    speechStartTime: 0,
    vadFrameCount: 0,
    vadSpeechFrames: 0,
    isTranscribing: false,
  };

  // Subscribe to the user's audio
  const receiver = connection.receiver;

  // We need to listen for speaking events to subscribe
  const onSpeakingStart = (speakingUserId: string) => {
    if (speakingUserId !== userId) return;
    if (userStream) return; // Already subscribed

    console.log(`[coach-listener] Rider started speaking, subscribing to audio`);

    userStream = subscribeToUser(
      connection,
      userId,
      (frame: Float32Array) => handleVadFrame(frame),
      (pcm: Int16Array) => handleRawPcm(pcm),
      () => handleStreamEnd(userId, connection),
    );
  };

  receiver.speaking.on("start", onSpeakingStart);
  isListening = true;

  // Store the handler for cleanup
  (startListening as any)._onSpeakingStart = onSpeakingStart;
  (startListening as any)._connection = connection;

  console.log(`[coach-listener] Listening for rider speech from ${userId}`);
}

/**
 * Stop listening and clean up.
 */
export function stopListening(): void {
  if (userStream) {
    userStream.destroy();
    userStream = null;
  }

  if (utteranceState?.silenceTimer) {
    clearTimeout(utteranceState.silenceTimer);
  }
  utteranceState = null;

  // Remove speaking listener
  const connection = (startListening as any)._connection as VoiceConnection | undefined;
  const onSpeakingStart = (startListening as any)._onSpeakingStart as ((id: string) => void) | undefined;
  if (connection && onSpeakingStart) {
    connection.receiver.speaking.removeListener("start", onSpeakingStart);
  }

  if (vad) {
    vad.destroy().catch(() => {});
    vad = null;
  }

  isListening = false;
  messageQueue.length = 0;

  console.log("[coach-listener] Stopped listening");
}

/**
 * Get and flush all queued rider messages.
 * Called by the coach brain each poll cycle.
 */
export function flushRiderMessages(): RiderMessage[] {
  if (messageQueue.length === 0) return [];

  const now = Date.now();
  const messages = messageQueue.splice(0, messageQueue.length).map((m) => ({
    ...m,
    agoSec: Math.round((now - m.timestamp) / 1000),
  }));

  console.log(`[coach-listener] Flushed ${messages.length} rider message(s)`);
  return messages;
}

/**
 * Check if there are queued messages.
 */
export function hasRiderMessages(): boolean {
  return messageQueue.length > 0;
}

// ---------------------------------------------------------------------------
// Audio processing
// ---------------------------------------------------------------------------

function handleRawPcm(pcm: Int16Array): void {
  if (!utteranceState) return;

  if (utteranceState.isSpeaking) {
    utteranceState.rawChunks.push(new Int16Array(pcm));
    utteranceState.totalRawSamples += pcm.length;
  }
}

async function handleVadFrame(frame: Float32Array): Promise<void> {
  if (!utteranceState || !vad) return;

  const state = utteranceState;

  // Accumulate into VAD frame buffer
  let offset = 0;
  while (offset < frame.length) {
    const remaining = FRAME_SIZE - state.vadFrameOffset;
    const toCopy = Math.min(remaining, frame.length - offset);
    state.vadFrameBuffer.set(frame.subarray(offset, offset + toCopy), state.vadFrameOffset);
    state.vadFrameOffset += toCopy;
    offset += toCopy;

    if (state.vadFrameOffset >= FRAME_SIZE) {
      try {
        const prob = await vad.process(state.vadFrameBuffer);
        const isSpeech = prob > 0.5;
        state.vadFrameCount++;

        if (isSpeech) {
          state.vadSpeechFrames++;

          if (!state.isSpeaking) {
            state.isSpeaking = true;
            state.speechStartTime = Date.now();
            state.rawChunks = [];
            state.totalRawSamples = 0;
            console.log(`[coach-listener] 🎤 Rider speech STARTED (prob=${prob.toFixed(3)})`);
          }

          state.lastSpeechTime = Date.now();

          if (state.silenceTimer) {
            clearTimeout(state.silenceTimer);
            state.silenceTimer = null;
          }
        } else if (state.isSpeaking) {
          if (!state.silenceTimer) {
            state.silenceTimer = setTimeout(() => {
              onUtteranceComplete();
            }, SILENCE_DURATION_MS);
          }
        }
      } catch (err) {
        // VAD error — ignore
      }

      state.vadFrameOffset = 0;
    }
  }
}

function handleStreamEnd(userId: string, connection: VoiceConnection): void {
  console.log(`[coach-listener] Audio stream ended for rider, cleaning up for re-subscription`);

  userStream = null;

  if (utteranceState?.isSpeaking) {
    if (utteranceState.silenceTimer) {
      clearTimeout(utteranceState.silenceTimer);
      utteranceState.silenceTimer = null;
    }
    onUtteranceComplete();
  }
}

async function onUtteranceComplete(): Promise<void> {
  if (!utteranceState || !utteranceState.isSpeaking) return;

  const state = utteranceState;
  const duration = Date.now() - state.speechStartTime;

  console.log(`[coach-listener] 🔇 Rider speech ENDED (duration=${duration}ms, chunks=${state.rawChunks.length})`);

  state.isSpeaking = false;
  if (state.silenceTimer) {
    clearTimeout(state.silenceTimer);
    state.silenceTimer = null;
  }

  // Too short
  if (duration < MIN_UTTERANCE_MS) {
    console.log(`[coach-listener] Utterance too short (${duration}ms), discarding`);
    state.rawChunks = [];
    state.totalRawSamples = 0;
    return;
  }

  // Already transcribing
  if (state.isTranscribing) {
    console.log("[coach-listener] Already transcribing, discarding");
    state.rawChunks = [];
    state.totalRawSamples = 0;
    return;
  }

  const rawChunks = state.rawChunks;
  state.rawChunks = [];
  state.totalRawSamples = 0;

  if (rawChunks.length === 0) return;

  // Get channel count from the stream
  const channels: 1 | 2 = userStream?.channels ?? 2;

  // Reset VAD for clean state
  vad?.reset();

  state.isTranscribing = true;

  try {
    // Concatenate raw PCM
    const totalSamples = rawChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const rawPcm = new Int16Array(totalSamples);
    let writeOffset = 0;
    for (const chunk of rawChunks) {
      rawPcm.set(chunk, writeOffset);
      writeOffset += chunk.length;
    }

    // Downsample to 16kHz mono
    const mono16k = downsampleToMono16kInt16(rawPcm, channels);
    const durationSec = mono16k.length / 16000;

    console.log(`[coach-listener] 📝 Transcribing ${durationSec.toFixed(1)}s of rider speech...`);

    const text = await transcribe(mono16k);

    if (text && text.trim().length > 0) {
      console.log(`[coach-listener] 🗣️ Rider said: "${text}"`);

      messageQueue.push({
        text: text.trim(),
        timestamp: Date.now(),
      });

      // Trim queue
      while (messageQueue.length > MAX_QUEUE_SIZE) {
        messageQueue.shift();
      }
    } else {
      console.log("[coach-listener] Empty transcription, discarding");
    }
  } catch (err) {
    console.error("[coach-listener] ❌ STT error:", err);
  } finally {
    state.isTranscribing = false;
  }
}
