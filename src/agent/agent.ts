import Anthropic from "@anthropic-ai/sdk";
import { getSoul } from "../soul/soul.js";
import { memoryTools, handleMemoryTool } from "../memory/tools.js";
import { discordTools, handleDiscordTool } from "./tools.js";
import { skillTools, handleSkillTool } from "../skills/tools.js";
import type { Message, ChannelConfig } from "../db/index.js";
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

const DEFAULT_MODEL = "bedrock-claude-opus-4-6-1m";
const MAX_TOKENS = 4096;
const MAX_TOOL_TURNS = 10;

/** Strip ANSI escape artifacts from env values (e.g. trailing [1m] from shell). */
function cleanModelName(s: string): string {
  return s.replace(/\x1b\[[\d;]*m/g, "").replace(/\[[\d;]*m\]?$/g, "").trim();
}

function getModel(override?: string): string {
  const raw = override || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  return cleanModelName(raw);
}

const BASE_INSTRUCTIONS = `You are a Discord assistant. You participate in conversations, answer questions, and help users. You can use tools to interact with Discord channels and to recall information from memory.

Guidelines:
- Be concise and conversational — this is Discord, not an essay.
- Match the tone of the channel. Casual channels get casual responses.
- Use Discord markdown when helpful (bold, code blocks, etc.).
- If you don't know something, say so rather than guessing.
- When users reference past conversations, search your memory first.`;

const MEMORY_RECALL_INSTRUCTIONS = `## Memory

You have access to a persistent memory system. Use it proactively:
- **memory_search**: Search for prior context before answering questions about people, preferences, past decisions, or facts you may have stored. When in doubt, search.
- **memory_get**: Read full context around a search result when you need more detail.

Search memory when:
- A user asks "do you remember…" or references something from the past
- You need context about a user, project, or ongoing topic
- You want to check if you've discussed something before`;

// ---------------------------------------------------------------------------
// All tools combined
// ---------------------------------------------------------------------------

const allTools: Anthropic.Messages.Tool[] = [
  ...memoryTools,
  ...discordTools,
  ...skillTools,
] as Anthropic.Messages.Tool[];

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

function buildSystemPrompt(opts: {
  context: {
    guildName?: string;
    channelName: string;
    userName: string;
    userId: string;
  };
  channelConfig?: ChannelConfig;
}): string {
  const parts: string[] = [];

  // 1. Base instructions
  parts.push(BASE_INSTRUCTIONS);

  // 2. Soul content
  const soul = getSoul();
  if (soul) {
    parts.push(`## Soul\n\n${soul}`);
  }

  // 2.5. Skills content
  const skillsPrompt = getSkillService()?.buildSkillsPromptSection();
  if (skillsPrompt) {
    parts.push(skillsPrompt);
  }

  // 3. Memory recall instructions
  parts.push(MEMORY_RECALL_INSTRUCTIONS);

  // 4. Channel-specific instructions
  if (opts.channelConfig?.systemPrompt) {
    parts.push(
      `## Channel Instructions\n\n${opts.channelConfig.systemPrompt}`,
    );
  }

  // 5. Context info
  const ctx = opts.context;
  const contextLines = [`## Current Context`];
  if (ctx.guildName) {
    contextLines.push(`- Server: ${ctx.guildName}`);
  }
  contextLines.push(`- Channel: #${ctx.channelName}`);
  contextLines.push(`- Speaking with: ${ctx.userName} (ID: ${ctx.userId})`);
  parts.push(contextLines.join("\n"));

  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// History converter
// ---------------------------------------------------------------------------

function buildMessageHistory(
  history: Message[],
): Anthropic.Messages.MessageParam[] {
  const messages: Anthropic.Messages.MessageParam[] = [];

  for (const msg of history) {
    const role = msg.role === "assistant" ? "assistant" : "user";
    // Merge consecutive same-role messages (Anthropic API requires alternation)
    const last = messages[messages.length - 1];
    if (last && last.role === role && typeof last.content === "string") {
      last.content += `\n${msg.content}`;
    } else {
      messages.push({ role, content: msg.content });
    }
  }

  // Ensure the conversation starts with a user message
  if (messages.length > 0 && messages[0].role === "assistant") {
    messages.shift();
  }

  return messages;
}

// ---------------------------------------------------------------------------
// Tool dispatch
// ---------------------------------------------------------------------------

async function executeTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  // Memory tools are synchronous
  if (name === "memory_search" || name === "memory_get") {
    return handleMemoryTool(name, input);
  }

  // Discord tools are async
  if (name === "send_message" || name === "add_reaction" || name === "get_channel_history") {
    return await handleDiscordTool(name, input);
  }

  // Skill tools are synchronous
  if (name === "read_skill" || name === "list_skill_files") {
    return handleSkillTool(name, input);
  }

  return JSON.stringify({ error: `Unknown tool: ${name}` });
}

// ---------------------------------------------------------------------------
// processMessage — main conversation entry point
// ---------------------------------------------------------------------------

export async function processMessage(opts: {
  message: string;
  sessionId: string;
  context: {
    guildName?: string;
    channelName: string;
    userName: string;
    userId: string;
  };
  history: Message[];
  channelConfig?: ChannelConfig;
}): Promise<string> {
  const systemPrompt = buildSystemPrompt({
    context: opts.context,
    channelConfig: opts.channelConfig,
  });

  // Build conversation history and append the current message
  const messages: Anthropic.Messages.MessageParam[] = [
    ...buildMessageHistory(opts.history),
    { role: "user", content: opts.message },
  ];

  const collectedText: string[] = [];
  let turns = 0;

  while (turns < MAX_TOOL_TURNS) {
    turns++;

    const response = await client.messages.create({
      model: getModel(),
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages,
      tools: allTools,
    });

    // Collect text blocks from the response
    for (const block of response.content) {
      if (block.type === "text") {
        collectedText.push(block.text);
      }
    }

    // If the model didn't ask to use a tool, we're done
    if (response.stop_reason !== "tool_use") {
      break;
    }

    // Process tool calls: append the assistant response, then tool results
    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type === "tool_use") {
        console.log(`[agent] Tool call: ${block.name}`, JSON.stringify(block.input));
        const result = await executeTool(
          block.name,
          block.input as Record<string, unknown>,
        );
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result,
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  const finalText = collectedText.join("\n").trim();
  if (!finalText) {
    return "I processed your request but had nothing to say.";
  }

  return finalText;
}

// ---------------------------------------------------------------------------
// processAgentTurn — simple single-turn for cron jobs
// ---------------------------------------------------------------------------

export async function processAgentTurn(opts: {
  message: string;
  model?: string;
}): Promise<string> {
  const soul = getSoul();
  const systemParts: string[] = [BASE_INSTRUCTIONS];
  if (soul) {
    systemParts.push(`## Soul\n\n${soul}`);
  }
  const skillsPrompt = getSkillService()?.buildSkillsPromptSection();
  if (skillsPrompt) {
    systemParts.push(skillsPrompt);
  }
  systemParts.push(MEMORY_RECALL_INSTRUCTIONS);

  const systemPrompt = systemParts.join("\n\n");

  // Only memory tools are available in cron context (no Discord tools)
  const tools = memoryTools as Anthropic.Messages.Tool[];

  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: opts.message },
  ];

  const collectedText: string[] = [];
  let turns = 0;

  while (turns < MAX_TOOL_TURNS) {
    turns++;

    const response = await client.messages.create({
      model: getModel(opts.model),
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages,
      tools,
    });

    for (const block of response.content) {
      if (block.type === "text") {
        collectedText.push(block.text);
      }
    }

    if (response.stop_reason !== "tool_use") {
      break;
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type === "tool_use") {
        console.log(`[agent] Cron tool call: ${block.name}`, JSON.stringify(block.input));
        const result = handleMemoryTool(
          block.name,
          block.input as Record<string, unknown>,
        );
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result,
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  return collectedText.join("\n").trim() || "";
}
