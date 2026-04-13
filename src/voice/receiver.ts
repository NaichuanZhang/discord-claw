/**
 * Audio receiver — subscribes to user audio streams from a VoiceConnection,
 * decodes opus to PCM, and downsamples to 16kHz mono for VAD and STT processing.
 *
 * Discord user audio streams can be either mono or stereo depending on the
 * client. We auto-detect the format on the first packet and adapt accordingly.
 */

import type { VoiceConnection } from "@discordjs/voice";
import opus from "@discordjs/opus";
const { OpusEncoder } = opus;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Discord sends 48kHz opus */
const DISCORD_SAMPLE_RATE = 48000;

/** Silero VAD expects 16kHz mono */
export const VAD_SAMPLE_RATE = 16000;
export const VAD_CHANNELS = 1;

/** Expected samples per 20ms frame at 48kHz */
const MONO_FRAME_SAMPLES = 960;   // 48000 * 0.020
const STEREO_FRAME_SAMPLES = 1920; // 48000 * 0.020 * 2

// ---------------------------------------------------------------------------
// Opus decoders — one for each channel configuration
// ---------------------------------------------------------------------------

const opusDecoderMono = new OpusEncoder(DISCORD_SAMPLE_RATE, 1);
const opusDecoderStereo = new OpusEncoder(DISCORD_SAMPLE_RATE, 2);

// ---------------------------------------------------------------------------
// Audio processing
// ---------------------------------------------------------------------------

/**
 * Decode an opus packet to PCM Int16.
 */
export function decodeOpus(opusPacket: Buffer, channels: 1 | 2): Int16Array {
  const decoder = channels === 2 ? opusDecoderStereo : opusDecoderMono;
  const pcmBuffer = decoder.decode(opusPacket);
  return new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.byteLength / 2);
}

/**
 * Downsample from 48kHz Int16 to 16kHz mono Float32.
 * Handles both mono and stereo input.
 */
export function downsampleToMono16k(pcm48k: Int16Array, channels: 1 | 2): Float32Array {
  const ratio = DISCORD_SAMPLE_RATE / VAD_SAMPLE_RATE; // 3
  const step = ratio * channels; // 3 for mono, 6 for stereo
  const outputLength = Math.floor(pcm48k.length / step);
  const output = new Float32Array(outputLength);

  if (channels === 1) {
    // Mono: just take every 3rd sample
    for (let i = 0; i < outputLength; i++) {
      output[i] = pcm48k[i * step] / 32768;
    }
  } else {
    // Stereo: average L+R channels, then downsample
    for (let i = 0; i < outputLength; i++) {
      const baseIdx = i * step;
      const left = pcm48k[baseIdx];
      const right = pcm48k[baseIdx + 1];
      output[i] = ((left + right) / 2) / 32768;
    }
  }

  return output;
}

/**
 * Convert PCM 48kHz Int16 to 16kHz mono Int16 (for WAV encoding / STT).
 * Handles both mono and stereo input.
 */
export function downsampleToMono16kInt16(pcm48k: Int16Array, channels: 1 | 2): Int16Array {
  const ratio = DISCORD_SAMPLE_RATE / VAD_SAMPLE_RATE;
  const step = ratio * channels;
  const outputLength = Math.floor(pcm48k.length / step);
  const output = new Int16Array(outputLength);

  if (channels === 1) {
    for (let i = 0; i < outputLength; i++) {
      output[i] = pcm48k[i * step];
    }
  } else {
    for (let i = 0; i < outputLength; i++) {
      const baseIdx = i * step;
      const left = pcm48k[baseIdx];
      const right = pcm48k[baseIdx + 1];
      output[i] = Math.round((left + right) / 2);
    }
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
  /** Callback when the raw PCM is available for buffering */
  onRawPcm: (pcm: Int16Array) => void;
  /** Detected channel count for this stream */
  channels: 1 | 2;
  /** Stop listening */
  destroy: () => void;
}

/**
 * Subscribe to a user's audio stream from a voice connection.
 * Decodes opus and downsamples to 16kHz mono for VAD processing.
 *
 * Auto-detects mono vs stereo on the first decoded packet based on
 * the number of samples returned.
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

  const opusStream = receiver.subscribe(userId, {
    end: {
      behavior: 1, // AfterSilence
      duration: 5000, // 5 seconds
    },
  });

  let packetCount = 0;
  let decodeErrors = 0;
  let ended = false;

  // Auto-detect channels on first packet. Default to stereo but will
  // correct on first decode.
  let detectedChannels: 1 | 2 = 2;
  let channelsDetected = false;

  const handleData = (packet: Buffer) => {
    try {
      packetCount++;

      // On the first packet, try to detect mono vs stereo
      if (!channelsDetected) {
        // Try decoding as stereo first
        const stereoPcm = decodeOpus(packet, 2);

        // If stereo decode gives 960 samples instead of 1920, it's actually mono
        if (stereoPcm.length === MONO_FRAME_SAMPLES) {
          detectedChannels = 1;
          console.log(`[voice:recv] Detected MONO stream for ${userId} (stereo decode returned ${stereoPcm.length} samples)`);
        } else {
          // Also try mono and compare RMS — higher RMS in mono means it's likely mono
          const monoPcm = decodeOpus(packet, 1);

          let stereoRms = 0;
          for (let i = 0; i < stereoPcm.length; i++) stereoRms += stereoPcm[i] * stereoPcm[i];
          stereoRms = Math.sqrt(stereoRms / stereoPcm.length);

          let monoRms = 0;
          for (let i = 0; i < monoPcm.length; i++) monoRms += monoPcm[i] * monoPcm[i];
          monoRms = Math.sqrt(monoRms / monoPcm.length);

          if (monoRms > stereoRms * 2 && monoRms > 100) {
            detectedChannels = 1;
            console.log(`[voice:recv] Detected MONO stream for ${userId} (mono RMS ${monoRms.toFixed(0)} >> stereo RMS ${stereoRms.toFixed(0)})`);
          } else {
            detectedChannels = 2;
            console.log(`[voice:recv] Detected STEREO stream for ${userId} (stereo: ${stereoPcm.length} samples, rms=${stereoRms.toFixed(0)})`);
          }
        }

        channelsDetected = true;
        stream.channels = detectedChannels;

        // Process this first packet with detected channels
        // Need a fresh decode since we may have corrupted decoder state
        const pcm = decodeOpus(packet, detectedChannels);
        onRawPcm(pcm);
        const frame16k = downsampleToMono16k(pcm, detectedChannels);
        onFrame(frame16k);
        return;
      }

      // Normal packet processing
      const pcm48k = decodeOpus(packet, detectedChannels);
      onRawPcm(pcm48k);
      const frame16k = downsampleToMono16k(pcm48k, detectedChannels);
      onFrame(frame16k);

      // Log audio level periodically (every 250 packets = ~5 seconds)
      if (packetCount % 250 === 0) {
        let rms = 0;
        for (let i = 0; i < pcm48k.length; i++) rms += pcm48k[i] * pcm48k[i];
        rms = Math.sqrt(rms / pcm48k.length);
        console.log(`[voice:recv] Audio level for ${userId} at packet #${packetCount}: rms=${rms.toFixed(1)}, channels=${detectedChannels}`);
      }
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

  const stream: UserAudioStream = { userId, onFrame, onRawPcm, channels: detectedChannels, destroy };
  return stream;
}
