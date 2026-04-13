/**
 * Text-to-Speech client using EigenAI Chatterbox.
 *
 * Takes text → sends to EigenAI Chatterbox API → returns WAV audio buffer.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EIGENAI_TTS_URL = "https://api-web.eigenai.com/api/chatterbox";

// ---------------------------------------------------------------------------
// TTS API
// ---------------------------------------------------------------------------

/**
 * Synthesize text to speech using EigenAI Chatterbox.
 * @param text The text to speak
 * @returns WAV audio buffer
 */
export async function synthesize(text: string): Promise<Buffer> {
  const apiKey = process.env.EIGENAI_API_KEY;
  if (!apiKey) {
    throw new Error("EIGENAI_API_KEY environment variable is not set");
  }

  console.log(`[tts] Synthesizing ${text.length} chars: "${text.slice(0, 100)}${text.length > 100 ? "..." : ""}"`);

  const startTime = Date.now();

  const response = await fetch(EIGENAI_TTS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "unknown error");
    console.error(`[tts] ❌ API error ${response.status}: ${errText}`);
    throw new Error(`EigenAI TTS failed (${response.status}): ${errText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const elapsed = Date.now() - startTime;

  console.log(`[tts] ✅ Synthesized in ${elapsed}ms: ${buffer.length} bytes audio for "${text.slice(0, 50)}"`);

  return buffer;
}
