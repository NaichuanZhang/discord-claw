/**
 * ElevenLabs Text-to-Speech client.
 *
 * Converts text to audio using the ElevenLabs API and returns
 * an mp3 buffer ready for Discord voice playback.
 */

import { Readable } from "node:stream";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1/text-to-speech";

// ---------------------------------------------------------------------------
// Config (set via init)
// ---------------------------------------------------------------------------

let apiKey: string | null = null;
let voiceId: string | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize the ElevenLabs TTS client.
 */
export function initElevenLabs(config: { apiKey: string; voiceId: string }): void {
  apiKey = config.apiKey;
  voiceId = config.voiceId;
  console.log(`[elevenlabs] Initialized with voice ${voiceId}`);
}

/**
 * Synthesize text to speech via ElevenLabs.
 * Returns an mp3 audio buffer.
 */
export async function synthesizeElevenLabs(
  text: string,
  signal?: AbortSignal,
): Promise<Buffer> {
  if (!apiKey || !voiceId) {
    throw new Error("ElevenLabs not initialized. Call initElevenLabs() first.");
  }

  const url = `${ELEVENLABS_API_URL}/${voiceId}`;
  const startTime = Date.now();

  console.log(`[elevenlabs] Synthesizing: "${text.slice(0, 80)}${text.length > 80 ? "..." : ""}"`);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_turbo_v2_5",
      voice_settings: {
        stability: 0.4,
        similarity_boost: 0.75,
        style: 0.3,
        use_speaker_boost: true,
      },
    }),
    signal,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "unknown error");
    console.error(`[elevenlabs] ❌ API error ${response.status}: ${errText}`);
    throw new Error(`ElevenLabs TTS failed (${response.status}): ${errText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const elapsed = Date.now() - startTime;

  console.log(`[elevenlabs] ✅ Synthesized in ${elapsed}ms: ${buffer.length} bytes`);

  return buffer;
}
