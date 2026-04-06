import Anthropic from "@anthropic-ai/sdk";
import { getSoul } from "../soul/soul.js";
import { memoryTools, handleMemoryTool } from "../memory/tools.js";
import { discordTools, handleDiscordTool } from "./tools.js";
import { skillTools, handleSkillTool } from "../skills/tools.js";
import { dangerousTools, handleDangerousTool } from "./dangerous-tools.js";
import { evolutionTools, handleEvolutionTool, setEvolutionContext } from "../evolution/tools.js";
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
const MAX_TOKENS = 16384;
const MAX_CONSECUTIVE_DUPES = 2; // Break loop after this many identical consecutive tool calls

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

const EVOLUTION_INSTRUCTIONS = `## Self-Evolution

You can modify your own source code through GitHub pull requests. All changes are isolated in a worktree and require human review before deployment.

**Tools:**
- \`evolve_start\`: Begin an evolution session (creates isolated worktree)
- \`evolve_read\` / \`evolve_write\` / \`evolve_bash\`: Work within the worktree
- \`evolve_propose\`: Submit changes as a PR (runs typecheck first)
- \`evolve_suggest\`: Record an idea for a potential improvement

**Rules:**
- For any changes to source code (\`src/\`), TypeScript files, \`start.sh\`, or \`migrations/\`, you MUST use the evolution tools.
- Do NOT modify source code directly with \`write_file\` or \`bash\`.
- When you encounter a limitation you could fix by modifying your own code, use \`evolve_suggest\` to record the idea. Only start an evolution if the user explicitly asks you to implement a change.
- Always use \`evolve_read\` to understand existing code before making changes.

**Querying evolution history:**
When users ask what you've learned, what improvements you're thinking about, or what PRs are pending, query the evolutions table:
- Deployed: \`bash\` → \`sqlite3 data/discordclaw.db "SELECT id, changes_summary, deployed_at FROM evolutions WHERE status='deployed' ORDER BY deployed_at DESC LIMIT 10"\`
- Ideas: \`bash\` → \`sqlite3 data/discordclaw.db "SELECT id, trigger_message FROM evolutions WHERE status='idea' ORDER BY created_at DESC LIMIT 10"\`
- Pending PRs: \`bash\` → \`sqlite3 data/discordclaw.db "SELECT id, pr_url, changes_summary FROM evolutions WHERE status='proposed'"\``;

// ---------------------------------------------------------------------------
// All tools combined
// ---------------------------------------------------------------------------

const allTools: Anthropic.Messages.Tool[] = [
  ...memoryTools,
  ...discordTools,
  ...skillTools,
  ...dangerousTools,
  ...evolutionTools,
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

  // 3.5 Evolution instructions
  parts.push(EVOLUTION_INSTRUCTIONS);

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
  if (name === "send_message" || name === "send_file" || name === "add_reaction" || name === "get_channel_history") {
    return await handleDiscordTool(name, input);
  }

  // Skill tools are synchronous
  if (name === "read_skill" || name === "list_skill_files") {
    return handleSkillTool(name, input);
  }

  // Dangerous tools (bash, read_file, write_file)
  if (name === "bash" || name === "read_file" || name === "write_file") {
    return await handleDangerousTool(name, input);
  }

  // Evolution tools
  if (
    name === "evolve_start" ||
    name === "evolve_read" ||
    name === "evolve_write" ||
    name === "evolve_bash" ||
    name === "evolve_propose" ||
    name === "evolve_suggest" ||
    name === "evolve_cancel"
  ) {
    return await handleEvolutionTool(name, input);
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

  // Set evolution context so tools know the triggering user
  setEvolutionContext(undefined, opts.context.userId);

  // Build conversation history and append the current message
  const messages: Anthropic.Messages.MessageParam[] = [
    ...buildMessageHistory(opts.history),
    { role: "user", content: opts.message },
  ];

  const collectedText: string[] = [];
  let turns = 0;

  // Duplicate tool call detection — track previous turn's calls
  let prevCallSignatures: string[] = [];
  let consecutiveDupes = 0;

  while (true) {
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

    // Build signatures for this turn's tool calls
    const currentSignatures: string[] = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        currentSignatures.push(`${block.name}:${JSON.stringify(block.input)}`);
      }
    }

    // Check for duplicate calls (same tools+args as previous turn)
    const isDuplicate =
      currentSignatures.length > 0 &&
      currentSignatures.length === prevCallSignatures.length &&
      currentSignatures.every((sig, i) => sig === prevCallSignatures[i]);

    if (isDuplicate) {
      consecutiveDupes++;
      console.log(
        `[agent] Duplicate tool call detected (${consecutiveDupes}/${MAX_CONSECUTIVE_DUPES})`,
      );
    } else {
      consecutiveDupes = 0;
    }
    prevCallSignatures = currentSignatures;

    // If we've hit the dupe limit, force the model to stop looping
    if (consecutiveDupes >= MAX_CONSECUTIVE_DUPES) {
      console.log("[agent] Breaking loop — repeated duplicate tool calls");
      // Give the model one last chance with a nudge instead of tools
      messages.push({ role: "assistant", content: response.content });
      messages.push({
        role: "user",
        content:
          "[System: You have called the same tools with identical inputs multiple times. Stop calling tools and produce your final response now using the information you already have.]",
      });
      // One final turn without tools to force a text response
      const final = await client.messages.create({
        model: getModel(),
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages,
      });
      for (const block of final.content) {
        if (block.type === "text") {
          collectedText.push(block.text);
        }
      }
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
  let prevCallSignatures: string[] = [];
  let consecutiveDupes = 0;

  while (true) {
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

    // Duplicate detection
    const currentSignatures: string[] = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        currentSignatures.push(`${block.name}:${JSON.stringify(block.input)}`);
      }
    }

    const isDuplicate =
      currentSignatures.length > 0 &&
      currentSignatures.length === prevCallSignatures.length &&
      currentSignatures.every((sig, i) => sig === prevCallSignatures[i]);

    if (isDuplicate) {
      consecutiveDupes++;
      console.log(`[agent] Cron duplicate tool call (${consecutiveDupes}/${MAX_CONSECUTIVE_DUPES})`);
    } else {
      consecutiveDupes = 0;
    }
    prevCallSignatures = currentSignatures;

    if (consecutiveDupes >= MAX_CONSECUTIVE_DUPES) {
      console.log("[agent] Cron loop broken — repeated duplicate tool calls");
      messages.push({ role: "assistant", content: response.content });
      messages.push({
        role: "user",
        content:
          "[System: You have called the same tools with identical inputs multiple times. Stop calling tools and produce your final response now.]",
      });
      const final = await client.messages.create({
        model: getModel(opts.model),
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages,
      });
      for (const block of final.content) {
        if (block.type === "text") {
          collectedText.push(block.text);
        }
      }
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
