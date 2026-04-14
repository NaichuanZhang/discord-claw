/**
 * Voice-optimized Claude agent.
 *
 * Uses Sonnet (fast) with a short max_tokens limit and a voice-specific
 * system prompt that produces spoken-style responses (no markdown, no lists,
 * 1-3 sentences).
 *
 * Has the same tools as the main agent EXCEPT for evolution tools.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getSoul } from "../soul/soul.js";
import { memoryTools, handleMemoryTool } from "../memory/tools.js";
import { discordTools, handleDiscordTool } from "../agent/tools.js";
import { skillTools, handleSkillTool } from "../skills/tools.js";
import { dangerousTools, handleDangerousTool } from "../agent/dangerous-tools.js";
import { getRecentMessages, getConversationStats } from "../db/index.js";
import { getSkillService } from "../skills/service.js";

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
const VOICE_MAX_TOKENS = 1024;
const MAX_TOOL_ROUNDS = 5; // Max tool-use rounds before forcing a text response

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

You have access to the full set of tools: memory, Discord, bash, file I/O, and skills. Use them when needed, but keep your spoken responses brief.`;

// ---------------------------------------------------------------------------
// Conversation history tools (same as main agent)
// ---------------------------------------------------------------------------

const conversationHistoryTools: Anthropic.Messages.Tool[] = [
  {
    name: "get_conversation_history",
    description:
      "Get recent conversation messages from the database, spanning across all sessions (including archived ones). " +
      "Use this to review what conversations happened recently. Returns messages newest-first.",
    input_schema: {
      type: "object" as const,
      properties: {
        hours: {
          type: "number",
          description: "How many hours back to look (default: 24)",
        },
        limit: {
          type: "number",
          description: "Max messages to return (default: 100, max: 500)",
        },
        role: {
          type: "string",
          description: "Filter by role: 'user' or 'assistant' (default: both)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_conversation_stats",
    description:
      "Get statistics about recent conversations: total sessions, messages, unique users, etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        hours: {
          type: "number",
          description: "How many hours back to look (default: 24)",
        },
      },
      required: [],
    },
  },
];

function handleConversationHistoryTool(
  name: string,
  input: Record<string, unknown>,
): string {
  try {
    switch (name) {
      case "get_conversation_history": {
        const hours = (input.hours as number) || 24;
        const limit = Math.min((input.limit as number) || 100, 500);
        const role = input.role as string | undefined;

        const messages = getRecentMessages({
          sinceMs: hours * 60 * 60 * 1000,
          limit,
          role,
        });

        const formatted = messages.map((m) => ({
          role: m.role,
          content: m.content.slice(0, 500),
          channel: m.discordKey || m.channelId || "unknown",
          userId: m.userId,
          timestamp: new Date(m.createdAt).toISOString(),
          hasMore: m.content.length > 500,
        }));

        return JSON.stringify({
          count: formatted.length,
          hours_back: hours,
          messages: formatted,
        });
      }

      case "get_conversation_stats": {
        const hours = (input.hours as number) || 24;
        const stats = getConversationStats(hours * 60 * 60 * 1000);
        return JSON.stringify(stats);
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    return JSON.stringify({
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Voice tools — everything except evolution
// ---------------------------------------------------------------------------

const voiceTools: Anthropic.Messages.Tool[] = [
  ...conversationHistoryTools,
  ...memoryTools,
  ...discordTools,
  ...skillTools,
  ...dangerousTools,
] as Anthropic.Messages.Tool[];

// ---------------------------------------------------------------------------
// Tool dispatch
// ---------------------------------------------------------------------------

async function executeVoiceTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  // Memory tools (sync)
  if (name === "memory_search" || name === "memory_get") {
    return handleMemoryTool(name, input);
  }
  // Discord tools (async)
  if (
    name === "send_message" ||
    name === "send_file" ||
    name === "add_reaction" ||
    name === "get_channel_history" ||
    name === "create_thread"
  ) {
    return await handleDiscordTool(name, input);
  }
  // Skill tools (sync)
  if (name === "read_skill" || name === "list_skill_files") {
    return handleSkillTool(name, input);
  }
  // Dangerous tools (async)
  if (name === "bash" || name === "read_file" || name === "write_file") {
    return await handleDangerousTool(name, input);
  }
  // Conversation history tools (sync)
  if (name === "get_conversation_history" || name === "get_conversation_stats") {
    return handleConversationHistoryTool(name, input);
  }

  return JSON.stringify({ error: `Unknown tool: ${name}` });
}

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

  // Skills section
  const skillsPrompt = getSkillService()?.buildSkillsPromptSection();
  if (skillsPrompt) {
    systemParts.push(skillsPrompt);
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

  // Call Claude with tool loop
  const collectedText: string[] = [];

  console.log(`[voice-agent] Calling Claude (${messages.length} messages)...`);
  let response = await client.messages.create({
    model: getVoiceModel(),
    max_tokens: VOICE_MAX_TOKENS,
    system: systemPrompt,
    messages,
    tools: voiceTools,
  });

  console.log(`[voice-agent] Claude response: stop_reason=${response.stop_reason}, content blocks=${response.content.length}`);

  // Collect text from initial response
  for (const block of response.content) {
    if (block.type === "text") {
      collectedText.push(block.text);
      console.log(`[voice-agent] Text block: "${block.text}"`);
    } else if (block.type === "tool_use") {
      console.log(`[voice-agent] Tool use block: ${block.name}(${JSON.stringify(block.input).slice(0, 100)})`);
    }
  }

  // Tool loop — handle multiple rounds of tool calls
  let toolRound = 0;
  while (response.stop_reason === "tool_use" && toolRound < MAX_TOOL_ROUNDS) {
    toolRound++;
    console.log(`[voice-agent] Tool round ${toolRound}/${MAX_TOOL_ROUNDS}`);

    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type === "tool_use") {
        console.log(`[voice-agent] Executing tool: ${block.name}`);
        const result = await executeVoiceTool(
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

    // Follow-up call
    console.log(`[voice-agent] Follow-up Claude call after tool round ${toolRound}...`);
    response = await client.messages.create({
      model: getVoiceModel(),
      max_tokens: VOICE_MAX_TOKENS,
      system: systemPrompt,
      messages,
      tools: voiceTools,
    });

    console.log(`[voice-agent] Follow-up response: stop_reason=${response.stop_reason}, blocks=${response.content.length}`);

    for (const block of response.content) {
      if (block.type === "text") {
        collectedText.push(block.text);
        console.log(`[voice-agent] Follow-up text: "${block.text}"`);
      } else if (block.type === "tool_use") {
        console.log(`[voice-agent] Tool use block: ${block.name}(${JSON.stringify(block.input).slice(0, 100)})`);
      }
    }
  }

  const responseText = collectedText.join(" ").trim();
  const elapsed = Date.now() - startTime;

  console.log(`[voice-agent] ✅ Response in ${elapsed}ms (${toolRound} tool rounds): "${responseText}"`);

  // Update history
  voiceHistory.push({ role: "user", content: text });
  voiceHistory.push({ role: "assistant", content: responseText });

  // Trim history to max
  while (voiceHistory.length > MAX_VOICE_HISTORY * 2) {
    voiceHistory.shift();
  }

  return responseText || "Sorry, I didn't have anything to say to that.";
}
