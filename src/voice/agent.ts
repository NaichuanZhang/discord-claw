/**
 * Voice-optimized Claude agent.
 *
 * Uses Sonnet (fast) with a short max_tokens limit and a voice-specific
 * system prompt that produces spoken-style responses (no markdown, no lists,
 * 1-3 sentences).
 */

import Anthropic from "@anthropic-ai/sdk";
import { getSoul } from "../soul/soul.js";
import { memoryTools, handleMemoryTool } from "../memory/tools.js";

// ---------------------------------------------------------------------------
// Anthropic client (singleton)
// ---------------------------------------------------------------------------

const client = new Anthropic({
  baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
  apiKey: process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY,
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_VOICE_MODEL = "claude-sonnet-4-20250514";
const VOICE_MAX_TOKENS = 512;

function getVoiceModel(): string {
  return process.env.VOICE_MODEL || DEFAULT_VOICE_MODEL;
}

// ---------------------------------------------------------------------------
// Voice system prompt
// ---------------------------------------------------------------------------

const VOICE_SYSTEM_PROMPT = `You are a voice assistant in a Discord voice channel. You hear what users say and speak back to them.

CRITICAL RULES FOR VOICE RESPONSES:
- Respond in 1-3 SHORT spoken sentences. Maximum.
- NO markdown formatting (no bold, no code blocks, no headers, no lists).
- NO URLs or links — describe them verbally instead.
- NO bullet points or numbered lists.
- NO emojis.
- Speak naturally, like a smart friend in the room.
- Use contractions (I'm, you're, that's, etc.)
- If you don't know something, say so briefly.
- Be direct and concise — every word should earn its place.
- Numbers should be spoken form (say "about three thousand" not "3,000").

You have access to memory tools to recall past conversations and facts.`;

// ---------------------------------------------------------------------------
// Voice tools (memory only — keep it fast)
// ---------------------------------------------------------------------------

const voiceTools: Anthropic.Messages.Tool[] = [...memoryTools] as Anthropic.Messages.Tool[];

// ---------------------------------------------------------------------------
// Conversation history (ephemeral per voice session)
// ---------------------------------------------------------------------------

interface VoiceTurn {
  role: "user" | "assistant";
  content: string;
}

const MAX_VOICE_HISTORY = 10;
let voiceHistory: VoiceTurn[] = [];

/**
 * Clear voice conversation history (call on disconnect).
 */
export function clearVoiceHistory(): void {
  voiceHistory = [];
}

// ---------------------------------------------------------------------------
// Process a voice utterance
// ---------------------------------------------------------------------------

/**
 * Process a transcribed voice utterance and return the text response.
 * @param text Transcribed speech from the user
 * @param userName Display name of the speaker
 * @returns Response text suitable for TTS
 */
export async function processVoiceUtterance(
  text: string,
  userName: string,
): Promise<string> {
  const startTime = Date.now();

  console.log(`[voice-agent] Processing utterance from ${userName}: "${text}"`);
  console.log(`[voice-agent] Voice history: ${voiceHistory.length} turns, model: ${getVoiceModel()}`);

  // Build system prompt with soul
  const systemParts: string[] = [VOICE_SYSTEM_PROMPT];
  const soul = getSoul();
  if (soul) {
    // Only include a brief personality note, not the full soul
    const soulBrief = soul.split("\n").slice(0, 5).join("\n");
    systemParts.push(`Personality: ${soulBrief}`);
  }

  const now = new Date().toLocaleString("en-US", {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  systemParts.push(`Current time: ${now}`);
  systemParts.push(`Speaking with: ${userName}`);

  const systemPrompt = systemParts.join("\n\n");

  // Build messages with history
  const messages: Anthropic.Messages.MessageParam[] = [];

  for (const turn of voiceHistory) {
    messages.push({ role: turn.role, content: turn.content });
  }

  messages.push({ role: "user", content: text });

  // Call Claude
  const collectedText: string[] = [];

  console.log(`[voice-agent] Calling Claude (${messages.length} messages)...`);
  const response = await client.messages.create({
    model: getVoiceModel(),
    max_tokens: VOICE_MAX_TOKENS,
    system: systemPrompt,
    messages,
    tools: voiceTools,
  });

  console.log(`[voice-agent] Claude response: stop_reason=${response.stop_reason}, content blocks=${response.content.length}`);

  // Collect text
  for (const block of response.content) {
    if (block.type === "text") {
      collectedText.push(block.text);
      console.log(`[voice-agent] Text block: "${block.text}"`);
    } else if (block.type === "tool_use") {
      console.log(`[voice-agent] Tool use block: ${block.name}(${JSON.stringify(block.input).slice(0, 100)})`);
    }
  }

  // Handle tool calls (one round only — keep it fast)
  if (response.stop_reason === "tool_use") {
    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type === "tool_use") {
        console.log(`[voice-agent] Executing tool: ${block.name}`);
        const result = handleMemoryTool(
          block.name,
          block.input as Record<string, unknown>,
        );
        console.log(`[voice-agent] Tool result (${block.name}): ${result.slice(0, 200)}`);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result,
        });
      }
    }

    messages.push({ role: "user", content: toolResults });

    // Second call to get the actual response
    console.log(`[voice-agent] Follow-up Claude call after tool use...`);
    const followUp = await client.messages.create({
      model: getVoiceModel(),
      max_tokens: VOICE_MAX_TOKENS,
      system: systemPrompt,
      messages,
    });

    console.log(`[voice-agent] Follow-up response: stop_reason=${followUp.stop_reason}, blocks=${followUp.content.length}`);

    for (const block of followUp.content) {
      if (block.type === "text") {
        collectedText.push(block.text);
        console.log(`[voice-agent] Follow-up text: "${block.text}"`);
      }
    }
  }

  const responseText = collectedText.join(" ").trim();
  const elapsed = Date.now() - startTime;

  console.log(`[voice-agent] ✅ Response in ${elapsed}ms: "${responseText}"`);

  // Update history
  voiceHistory.push({ role: "user", content: text });
  voiceHistory.push({ role: "assistant", content: responseText });

  // Trim history to max
  while (voiceHistory.length > MAX_VOICE_HISTORY * 2) {
    voiceHistory.shift();
  }

  return responseText || "Sorry, I didn't have anything to say to that.";
}
