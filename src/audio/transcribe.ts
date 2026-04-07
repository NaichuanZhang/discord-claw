/**
 * Audio transcription for Discord voice messages.
 *
 * Downloads voice message attachments and transcribes them using
 * OpenAI's Whisper API. Requires OPENAI_API_KEY env var.
 */

import OpenAI from "openai";
import { writeFileSync, unlinkSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";

// ---------------------------------------------------------------------------
// OpenAI client (lazy singleton)
// ---------------------------------------------------------------------------

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI | null {
  if (openaiClient) return openaiClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

/**
 * Check if voice transcription is available (i.e., OPENAI_API_KEY is set).
 */
export function isTranscriptionAvailable(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

// ---------------------------------------------------------------------------
// Download helper
// ---------------------------------------------------------------------------

async function downloadFile(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Transcribe
// ---------------------------------------------------------------------------

/**
 * Download and transcribe an audio file from a URL.
 * Returns the transcribed text, or null if transcription is unavailable.
 *
 * @param url - URL of the audio file (e.g., Discord attachment URL)
 * @param filename - Original filename (used to determine format)
 */
export async function transcribeAudio(
  url: string,
  filename?: string,
): Promise<string | null> {
  const client = getOpenAIClient();
  if (!client) {
    console.log("[audio] Transcription unavailable — no OPENAI_API_KEY set");
    return null;
  }

  // Download the audio file
  const audioBuffer = await downloadFile(url);

  // Write to a temp file (Whisper API needs a file)
  const ext = filename?.split(".").pop() || "ogg";
  const tempPath = join(
    tmpdir(),
    `discordclaw-voice-${randomBytes(8).toString("hex")}.${ext}`,
  );

  try {
    writeFileSync(tempPath, audioBuffer);

    console.log(
      `[audio] Transcribing ${filename || "voice message"} (${audioBuffer.length} bytes)`,
    );

    // Use OpenAI Whisper API
    const file = new File([readFileSync(tempPath)], filename || `voice.${ext}`, {
      type: ext === "ogg" ? "audio/ogg" : `audio/${ext}`,
    });

    const transcription = await client.audio.transcriptions.create({
      model: "whisper-1",
      file,
      response_format: "text",
    });

    const text =
      typeof transcription === "string"
        ? transcription.trim()
        : (transcription as unknown as { text: string }).text?.trim() || "";

    console.log(
      `[audio] Transcription result (${text.length} chars): "${text.slice(0, 100)}${text.length > 100 ? "..." : ""}"`,
    );

    return text || null;
  } finally {
    // Clean up temp file
    try {
      unlinkSync(tempPath);
    } catch {
      // ignore cleanup errors
    }
  }
}
