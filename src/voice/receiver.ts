/**
 * Audio receiver — subscribes to user audio streams from a VoiceConnection,
 * decodes opus to PCM, and downsamples from 48kHz stereo to 16kHz mono
 * for VAD and STT processing.
 */

import type { VoiceConnection } from "@discordjs/voice";
import opus from "@discordjs/opus";
const { OpusEncoder } = opus;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Discord sends 48kHz stereo opus */
const DISCORD_SAMPLE_RATE = 48000;
const DISCORD_CHANNELS = 2;

/** Silero VAD expects 16kHz mono */
export const VAD_SAMPLE_RATE = 16000;
export const VAD_CHANNELS = 1;

/** Frame duration in ms — Discord sends 20ms opus frames */
const FRAME_DURATION_MS = 20;

// ---------------------------------------------------------------------------
// Opus decoder
// ---------------------------------------------------------------------------

const opusDecoder = new OpusEncoder(DISCORD_SAMPLE_RATE, DISCORD_CHANNELS);

// ---------------------------------------------------------------------------
// Audio processing
// ---------------------------------------------------------------------------

/**
 * Decode an opus packet to PCM Int16 (48kHz stereo).
 */
export function decodeOpus(opusPacket: Buffer): Int16Array {
  const pcmBuffer = opusDecoder.decode(opusPacket);
  return new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.byteLength / 2);
}

/**
 * Downsample from 48kHz stereo Int16 to 16kHz mono Float32.
 * Simple approach: take every 3rd sample from left channel (48k/3 = 16k),
 * stepping by 2 for stereo interleaving (so step = 6).
 */
export function downsampleToMono16k(pcm48kStereo: Int16Array): Float32Array {
  const ratio = DISCORD_SAMPLE_RATE / VAD_SAMPLE_RATE; // 3
  const step = ratio * DISCORD_CHANNELS; // 6
  const outputLength = Math.floor(pcm48kStereo.length / step);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    // Convert Int16 [-32768, 32767] to Float32 [-1.0, 1.0]
    output[i] = pcm48kStereo[i * step] / 32768;
  }

  return output;
}

/**
 * Convert PCM 48kHz stereo Int16 to 16kHz mono Int16 (for WAV encoding).
 */
export function downsampleToMono16kInt16(pcm48kStereo: Int16Array): Int16Array {
  const ratio = DISCORD_SAMPLE_RATE / VAD_SAMPLE_RATE;
  const step = ratio * DISCORD_CHANNELS;
  const outputLength = Math.floor(pcm48kStereo.length / step);
  const output = new Int16Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    output[i] = pcm48kStereo[i * step];
  }

  return output;
}

// ---------------------------------------------------------------------------
// Per-user audio subscription
// ---------------------------------------------------------------------------

export interface UserAudioStream {
  userId: string;
  /** Callback when we receive a decoded + downsampled audio frame */
  onFrame: (frame: Float32Array) => void;
  /** Callback when the raw PCM (48kHz stereo) is available for buffering */
  onRawPcm: (pcm: Int16Array) => void;
  /** Stop listening */
  destroy: () => void;
}

/**
 * Subscribe to a user's audio stream from a voice connection.
 * Decodes opus and downsamples to 16kHz mono for VAD processing.
 *
 * @param onStreamEnd - Called when the opus stream ends/closes, so the caller
 *   can clean up and allow re-subscription on the next speaking:start event.
 */
export function subscribeToUser(
  connection: VoiceConnection,
  userId: string,
  onFrame: (frame: Float32Array) => void,
  onRawPcm: (pcm: Int16Array) => void,
  onStreamEnd?: () => void,
): UserAudioStream {
  const receiver = connection.receiver;

  // Subscribe to the user's audio — get opus packets.
  // Use a generous AfterSilence duration so the stream stays alive during
  // natural speech pauses. Our own VAD + silence timer handles utterance
  // boundary detection, so we just need the opus stream to keep feeding us
  // data as long as the user is reasonably active.
  const opusStream = receiver.subscribe(userId, {
    end: {
      behavior: 1, // AfterSilence
      duration: 5000, // 5 seconds — much more forgiving than 100ms
    },
  });

  let packetCount = 0;
  let decodeErrors = 0;
  let ended = false;

  const handleData = (packet: Buffer) => {
    try {
      packetCount++;

      // Log first packet and every 250th (~5 seconds of audio)
      if (packetCount === 1) {
        console.log(`[voice:recv] First opus packet from ${userId}: ${packet.length} bytes`);
      } else if (packetCount % 250 === 0) {
        console.log(`[voice:recv] Opus packets from ${userId}: ${packetCount} received, ${decodeErrors} decode errors`);
      }

      // Decode opus to PCM
      const pcm48k = decodeOpus(packet);
      // Pass raw PCM for buffering
      onRawPcm(pcm48k);
      // Downsample for VAD
      const frame16k = downsampleToMono16k(pcm48k);
      onFrame(frame16k);
    } catch (err) {
      decodeErrors++;
      if (decodeErrors <= 3) {
        console.log(`[voice:recv] Opus decode error #${decodeErrors} for ${userId}: ${err}`);
      }
    }
  };

  const handleEnd = () => {
    if (ended) return;
    ended = true;
    console.log(`[voice:recv] Opus stream ended for ${userId} (total packets: ${packetCount})`);
    onStreamEnd?.();
  };

  opusStream.on("data", handleData);

  opusStream.on("close", () => {
    console.log(`[voice:recv] Opus stream closed for ${userId} (total packets: ${packetCount}, errors: ${decodeErrors})`);
    handleEnd();
  });

  opusStream.on("end", handleEnd);

  const destroy = () => {
    console.log(`[voice:recv] Destroying audio stream for ${userId} (total packets: ${packetCount})`);
    opusStream.removeListener("data", handleData);
    opusStream.destroy();
  };

  return { userId, onFrame, onRawPcm: onRawPcm, destroy };
}
