/**
 * Speech-to-Text client using EigenAI Whisper V3 Turbo.
 *
 * Takes PCM audio (16kHz mono Int16) → wraps in WAV → sends to EigenAI API → returns text.
 */

import { VAD_SAMPLE_RATE } from "./receiver.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EIGENAI_STT_URL = "https://api-web.eigenai.com/api/v1/generate";
const EIGENAI_MODEL = "whisper_v3_turbo";

// ---------------------------------------------------------------------------
// WAV encoding
// ---------------------------------------------------------------------------

/**
 * Wrap raw PCM Int16 samples in a WAV header.
 */
function encodeWav(samples: Int16Array, sampleRate: number, channels: number = 1): Buffer {
  const bytesPerSample = 2; // Int16
  const dataSize = samples.length * bytesPerSample;
  const headerSize = 44;
  const buffer = Buffer.alloc(headerSize + dataSize);

  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);

  // fmt chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28); // byte rate
  buffer.writeUInt16LE(channels * bytesPerSample, 32); // block align
  buffer.writeUInt16LE(bytesPerSample * 8, 34); // bits per sample

  // data chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Copy PCM data
  Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength).copy(buffer, headerSize);

  return buffer;
}

// ---------------------------------------------------------------------------
// STT API
// ---------------------------------------------------------------------------

/**
 * Transcribe PCM audio to text using EigenAI Whisper.
 * @param pcm16kMono Int16Array of 16kHz mono audio samples
 * @returns Transcribed text, or empty string if nothing was detected
 */
export async function transcribe(pcm16kMono: Int16Array): Promise<string> {
  const apiKey = process.env.EIGENAI_API_KEY;
  if (!apiKey) {
    throw new Error("EIGENAI_API_KEY environment variable is not set");
  }

  // Encode as WAV
  const wavBuffer = encodeWav(pcm16kMono, VAD_SAMPLE_RATE);

  // Build multipart form data
  const formData = new FormData();
  formData.append("model", EIGENAI_MODEL);
  formData.append("file", new Blob([wavBuffer], { type: "audio/wav" }), "utterance.wav");
  formData.append("language", "en");
  formData.append("response_format", "json");

  const startTime = Date.now();

  const response = await fetch(EIGENAI_STT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "unknown error");
    throw new Error(`EigenAI STT failed (${response.status}): ${errText}`);
  }

  const data = await response.json() as { text?: string };
  const elapsed = Date.now() - startTime;
  const text = (data.text ?? "").trim();

  console.log(`[stt] Transcribed in ${elapsed}ms: "${text.slice(0, 100)}"`);

  return text;
}
