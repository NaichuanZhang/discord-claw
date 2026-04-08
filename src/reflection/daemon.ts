// ---------------------------------------------------------------------------
// Reflection Daemon — periodic self-analysis for improvement opportunities
// ---------------------------------------------------------------------------
//
// Level 1 trust: discovers ideas and posts them to Discord for human approval.
// Does NOT auto-implement anything.
// ---------------------------------------------------------------------------

import Anthropic from "@anthropic-ai/sdk";
import { getDb } from "../db/index.js";
import {
  getSignalsSince,
  getSignalSummary,
  getTopSignals,
  pruneSignals,
} from "./signals.js";
import { listEvolutions, type Evolution } from "../evolution/log.js";
import { recordSuggestion } from "../evolution/engine.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** How often the reflection runs (default: 6 hours) */
const REFLECTION_INTERVAL_MS = parseInt(
  process.env.REFLECTION_INTERVAL_HOURS || "6",
  10,
) * 60 * 60 * 1000;

/** How far back to look for signals (default: 24 hours) */
const SIGNAL_LOOKBACK_MS = parseInt(
  process.env.REFLECTION_LOOKBACK_HOURS || "24",
  10,
) * 60 * 60 * 1000;

/** Minimum number of signals before reflection is worth running */
const MIN_SIGNALS_FOR_REFLECTION = parseInt(
  process.env.REFLECTION_MIN_SIGNALS || "3",
  10,
);

/** Prune signals older than this (default: 7 days) */
const SIGNAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Max characters of conversation history to include in the reflection prompt */
const MAX_CONVERSATION_CHARS = parseInt(
  process.env.REFLECTION_MAX_CONVERSATION_CHARS || "50000",
  10,
);

const REFLECTION_MODEL = process.env.REFLECTION_MODEL || process.env.ANTHROPIC_MODEL || "bedrock-claude-opus-4-6-1m";

function log(...args: unknown[]): void {
  console.log("[reflection]", ...args);
}

// ---------------------------------------------------------------------------
// Anthropic client (reuse the same config as the main agent)
// ---------------------------------------------------------------------------

const client = new Anthropic({
  baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
  apiKey: process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY,
});

// ---------------------------------------------------------------------------
// Discord notification callback
// ---------------------------------------------------------------------------

let _sendToDiscord: ((channelId: string, text: string) => Promise<void>) | null = null;
let _reflectionChannelId: string | null = null;

export function setReflectionSendToDiscord(
  fn: (channelId: string, text: string) => Promise<void>,
): void {
  _sendToDiscord = fn;
}

export function setReflectionChannelId(channelId: string): void {
  _reflectionChannelId = channelId;
}

// ---------------------------------------------------------------------------
// Conversation history types
// ---------------------------------------------------------------------------

interface ConversationThread {
  sessionId: string;
  channelId: string | null;
  userId: string | null;
  startedAt: number;
  lastActiveAt: number;
  messages: { role: string; content: string; createdAt: number }[];
}

// ---------------------------------------------------------------------------
// Gather context for reflection
// ---------------------------------------------------------------------------

interface ReflectionContext {
  signalSummary: Record<string, number>;
  topErrors: { detail: string; count: number; type: string }[];
  topFailures: { detail: string; count: number; type: string }[];
  topUnknown: { detail: string; count: number; type: string }[];
  recentPositive: { detail: string; count: number; type: string }[];
  recentIdeas: Evolution[];
  recentDeployed: Evolution[];
  conversationStats: { totalSessions: number; totalMessages: number };
  conversationHistory: ConversationThread[];
  totalSignals: number;
}

function gatherContext(): ReflectionContext {
  const since = Date.now() - SIGNAL_LOOKBACK_MS;
  const db = getDb();

  const signalSummary = getSignalSummary(since);
  const topErrors = getTopSignals(since, { type: "error", limit: 10 });
  const topFailures = getTopSignals(since, { type: "tool_failure", limit: 10 });
  const topUnknown = getTopSignals(since, { type: "unknown_request", limit: 10 });
  const recentPositive = getTopSignals(since, { type: "user_sentiment", limit: 10 });

  const recentIdeas = listEvolutions({ status: "idea" }).slice(0, 10);
  const recentDeployed = listEvolutions({ status: "deployed" }).slice(0, 5);

  // Conversation stats
  const sessionRow = db
    .prepare("SELECT COUNT(*) as count FROM sessions WHERE last_active > ?")
    .get(since) as { count: number };
  const messageRow = db
    .prepare("SELECT COUNT(*) as count FROM messages WHERE created_at > ?")
    .get(since) as { count: number };

  // Full conversation history from the lookback window
  const conversationHistory = gatherConversationHistory(since);

  const allSignals = getSignalsSince(since);

  return {
    signalSummary,
    topErrors,
    topFailures,
    topUnknown,
    recentPositive,
    recentIdeas,
    recentDeployed,
    conversationStats: {
      totalSessions: sessionRow.count,
      totalMessages: messageRow.count,
    },
    conversationHistory,
    totalSignals: allSignals.length,
  };
}

// ---------------------------------------------------------------------------
// Gather full conversation history grouped by session
// ---------------------------------------------------------------------------

function gatherConversationHistory(since: number): ConversationThread[] {
  const db = getDb();

  // Get all sessions active in the lookback window
  const sessions = db
    .prepare(
      `SELECT id, channel_id, user_id, created_at, last_active
       FROM sessions
       WHERE last_active > ?
       ORDER BY last_active DESC`,
    )
    .all(since) as {
      id: string;
      channel_id: string | null;
      user_id: string | null;
      created_at: number;
      last_active: number;
    }[];

  const threads: ConversationThread[] = [];

  for (const session of sessions) {
    // Get all messages for this session in the lookback window
    const messages = db
      .prepare(
        `SELECT role, content, created_at
         FROM messages
         WHERE session_id = ? AND created_at > ?
         ORDER BY created_at ASC`,
      )
      .all(session.id, since) as {
        role: string;
        content: string;
        created_at: number;
      }[];

    if (messages.length === 0) continue;

    threads.push({
      sessionId: session.id,
      channelId: session.channel_id,
      userId: session.user_id,
      startedAt: session.created_at,
      lastActiveAt: session.last_active,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        createdAt: m.created_at,
      })),
    });
  }

  return threads;
}

// ---------------------------------------------------------------------------
// Format conversation history for the prompt with smart truncation
// ---------------------------------------------------------------------------

function formatConversationHistory(threads: ConversationThread[]): string {
  if (threads.length === 0) return "";

  const parts: string[] = [];
  let totalChars = 0;

  for (const thread of threads) {
    const threadHeader = `### Conversation (session: ${thread.sessionId.slice(0, 8)}..., channel: ${thread.channelId || "DM"}, user: ${thread.userId || "unknown"})`;
    const threadMessages: string[] = [];

    for (const msg of thread.messages) {
      const timestamp = new Date(msg.createdAt).toISOString();
      // Truncate very long individual messages (e.g., tool results with huge output)
      const content = msg.content.length > 2000
        ? msg.content.slice(0, 2000) + "... [truncated]"
        : msg.content;
      const formatted = `[${timestamp}] **${msg.role}**: ${content}`;

      // Check if adding this message would exceed our budget
      if (totalChars + formatted.length > MAX_CONVERSATION_CHARS) {
        threadMessages.push(`... [${thread.messages.length - threadMessages.length} more messages truncated]`);
        break;
      }

      threadMessages.push(formatted);
      totalChars += formatted.length;
    }

    parts.push(threadHeader + "\n" + threadMessages.join("\n"));

    // If we've hit the budget, stop adding threads
    if (totalChars >= MAX_CONVERSATION_CHARS) {
      parts.push(`\n... [${threads.length - parts.length} more conversations truncated]`);
      break;
    }
  }

  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Build the reflection prompt
// ---------------------------------------------------------------------------

function buildReflectionPrompt(ctx: ReflectionContext): string {
  const parts: string[] = [];

  parts.push(`You are a self-improving AI assistant analyzing your own performance over the last ${Math.round(SIGNAL_LOOKBACK_MS / 3600000)} hours.

Your job is to identify the SINGLE most impactful improvement you could make to yourself. You have access to signals collected from your recent operation, as well as the FULL conversation history from this period.

## Rules
- Be specific and actionable. "Improve error handling" is too vague. "Add retry logic for Discord API timeouts in send_message tool" is good.
- Consider whether the improvement should be a CODE change (new runtime capability) or a SKILL (procedural knowledge using existing tools).
- If you don't see any meaningful improvement opportunity, say so. Don't force it.
- Prioritize: errors/failures > unhandled user requests > efficiency > nice-to-haves.
- Don't suggest things that have already been deployed or are in the ideas backlog (listed below).
- Pay close attention to the conversation history — look for patterns where users struggled, where you gave suboptimal answers, where you took too many steps to accomplish something, or where users asked for things you couldn't do.`);

  parts.push(`## Activity Summary
- Active sessions: ${ctx.conversationStats.totalSessions}
- Messages processed: ${ctx.conversationStats.totalMessages}
- Total signals collected: ${ctx.totalSignals}`);

  parts.push(`## Signal Summary
- Errors: ${ctx.signalSummary.error || 0}
- Tool failures: ${ctx.signalSummary.tool_failure || 0}
- Unknown requests: ${ctx.signalSummary.unknown_request || 0}
- User sentiment signals: ${ctx.signalSummary.user_sentiment || 0}
- Patterns: ${ctx.signalSummary.pattern || 0}`);

  if (ctx.topErrors.length > 0) {
    parts.push(`## Top Errors\n${ctx.topErrors.map((e) => `- [${e.count}x] ${e.detail}`).join("\n")}`);
  }

  if (ctx.topFailures.length > 0) {
    parts.push(`## Top Tool Failures\n${ctx.topFailures.map((e) => `- [${e.count}x] ${e.detail}`).join("\n")}`);
  }

  if (ctx.topUnknown.length > 0) {
    parts.push(`## Things Users Asked For That I Couldn't Do\n${ctx.topUnknown.map((e) => `- [${e.count}x] ${e.detail}`).join("\n")}`);
  }

  if (ctx.recentPositive.length > 0) {
    parts.push(`## Positive Signals\n${ctx.recentPositive.map((e) => `- [${e.count}x] ${e.detail}`).join("\n")}`);
  }

  // Full conversation history
  const conversationText = formatConversationHistory(ctx.conversationHistory);
  if (conversationText) {
    parts.push(`## Full Conversation History\n\nBelow are all conversations from the lookback period. Analyze these for patterns, pain points, and improvement opportunities.\n\n${conversationText}`);
  }

  if (ctx.recentIdeas.length > 0) {
    parts.push(`## Existing Ideas (don't repeat these)\n${ctx.recentIdeas.map((e) => `- ${e.triggerMessage?.slice(0, 200)}`).join("\n")}`);
  }

  if (ctx.recentDeployed.length > 0) {
    parts.push(`## Recently Deployed Improvements\n${ctx.recentDeployed.map((e) => `- ${e.changesSummary || e.triggerMessage?.slice(0, 200)}`).join("\n")}`);
  }

  parts.push(`## Your Response Format

Respond in EXACTLY this JSON format:
{
  "has_proposal": true/false,
  "title": "Short title for the improvement",
  "description": "Detailed description of what to change and why",
  "type": "code" | "skill" | "soul",
  "priority": "high" | "medium" | "low",
  "reasoning": "Why this is the most impactful thing to work on",
  "evidence": "Specific quotes or patterns from conversations that support this proposal"
}

If nothing warrants action, set has_proposal to false and explain why in reasoning.`);

  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Run a single reflection cycle
// ---------------------------------------------------------------------------

interface ReflectionResult {
  outcome: "no_action" | "idea_recorded" | "proposal_sent" | "skipped" | "error";
  proposal?: string;
  evolutionId?: string;
  error?: string;
}

async function runReflection(): Promise<ReflectionResult> {
  const runStarted = Date.now();

  try {
    // 1. Gather context
    const ctx = gatherContext();

    // Skip if not enough signals AND no conversations to analyze
    if (ctx.totalSignals < MIN_SIGNALS_FOR_REFLECTION && ctx.conversationHistory.length === 0) {
      log(`Skipping reflection — only ${ctx.totalSignals} signals (need ${MIN_SIGNALS_FOR_REFLECTION}) and no conversations`);
      recordReflectionRun(runStarted, "skipped", 0, null, null, null);
      return { outcome: "skipped" };
    }

    const totalMessages = ctx.conversationHistory.reduce((sum, t) => sum + t.messages.length, 0);
    log(`Running reflection with ${ctx.totalSignals} signals, ${ctx.conversationHistory.length} conversations (${totalMessages} messages)...`);

    // 2. Build prompt and call Claude
    const prompt = buildReflectionPrompt(ctx);

    const response = await client.messages.create({
      model: REFLECTION_MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const responseText = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    // 3. Parse the response
    let proposal: {
      has_proposal: boolean;
      title?: string;
      description?: string;
      type?: string;
      priority?: string;
      reasoning?: string;
      evidence?: string;
    };

    try {
      // Extract JSON from potential markdown code block
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }
      proposal = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      log("Failed to parse reflection response:", parseErr);
      log("Raw response:", responseText.slice(0, 500));
      recordReflectionRun(runStarted, "error", ctx.totalSignals, null, null, `Parse error: ${parseErr}`);
      return { outcome: "error", error: `Parse error: ${parseErr}` };
    }

    // 4. Act on the proposal
    if (!proposal.has_proposal) {
      log(`Reflection concluded: no action needed. Reason: ${proposal.reasoning}`);
      recordReflectionRun(runStarted, "no_action", ctx.totalSignals, null, null, null);
      return { outcome: "no_action" };
    }

    const proposalText = `**${proposal.title}**\n\n${proposal.description}\n\n**Type:** ${proposal.type} | **Priority:** ${proposal.priority}\n**Reasoning:** ${proposal.reasoning}${proposal.evidence ? `\n**Evidence:** ${proposal.evidence}` : ""}`;

    // Record as an evolution idea
    const evolution = recordSuggestion({
      what: proposal.title || "Untitled improvement",
      why: `${proposal.description}\n\n[Auto-discovered by reflection daemon]\nType: ${proposal.type}\nPriority: ${proposal.priority}\nReasoning: ${proposal.reasoning}${proposal.evidence ? `\nEvidence: ${proposal.evidence}` : ""}`,
      triggeredBy: "reflection-daemon",
    });

    log(`Reflection found improvement: "${proposal.title}" (${proposal.type}/${proposal.priority})`);

    // 5. Notify Discord (Level 1: human must approve)
    if (_sendToDiscord && _reflectionChannelId) {
      try {
        const discordMessage = [
          `🔮 **Self-Reflection Report**`,
          ``,
          `I analyzed ${ctx.totalSignals} signals and ${totalMessages} messages across ${ctx.conversationHistory.length} conversations from the last ${Math.round(SIGNAL_LOOKBACK_MS / 3600000)} hours and found a potential improvement:`,
          ``,
          proposalText,
          ``,
          `---`,
          `💡 Recorded as idea \`${evolution.id}\``,
          `To implement, tell me: "implement evolution idea ${evolution.id}"`,
        ].join("\n");

        await _sendToDiscord(_reflectionChannelId, discordMessage);
      } catch (err) {
        log("Failed to send reflection to Discord:", err);
      }
    }

    recordReflectionRun(
      runStarted,
      _reflectionChannelId ? "proposal_sent" : "idea_recorded",
      ctx.totalSignals,
      proposalText,
      evolution.id,
      null,
    );

    return {
      outcome: _reflectionChannelId ? "proposal_sent" : "idea_recorded",
      proposal: proposalText,
      evolutionId: evolution.id,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("Reflection failed:", msg);
    recordReflectionRun(runStarted, "error", 0, null, null, msg);
    return { outcome: "error", error: msg };
  }
}

// ---------------------------------------------------------------------------
// Record reflection run in DB
// ---------------------------------------------------------------------------

function recordReflectionRun(
  startedAt: number,
  outcome: string,
  signalsAnalyzed: number,
  proposal: string | null,
  evolutionId: string | null,
  error: string | null,
): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO reflection_runs (started_at, completed_at, signals_analyzed, outcome, proposal, evolution_id, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        startedAt,
        Date.now(),
        signalsAnalyzed,
        outcome,
        proposal,
        evolutionId,
        error,
        Date.now(),
      );
  } catch (err) {
    console.error("[reflection] Failed to record run:", err);
  }
}

// ---------------------------------------------------------------------------
// Daemon lifecycle
// ---------------------------------------------------------------------------

let _reflectionTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the reflection daemon. Runs reflection on a fixed interval.
 * The first run happens after one full interval (not immediately on startup).
 */
export function startReflectionDaemon(): void {
  if (_reflectionTimer) {
    log("Daemon already running");
    return;
  }

  const hours = REFLECTION_INTERVAL_MS / 3600000;
  log(`Starting reflection daemon (every ${hours}h, lookback ${SIGNAL_LOOKBACK_MS / 3600000}h, min signals: ${MIN_SIGNALS_FOR_REFLECTION})`);

  if (!_reflectionChannelId) {
    log("WARNING: No REFLECTION_CHANNEL_ID set — ideas will be recorded but not posted to Discord");
  }

  _reflectionTimer = setInterval(async () => {
    try {
      // Prune old signals first
      const pruned = pruneSignals(Date.now() - SIGNAL_RETENTION_MS);
      if (pruned > 0) {
        log(`Pruned ${pruned} old signals`);
      }

      await runReflection();
    } catch (err) {
      log("Daemon tick error:", err);
    }
  }, REFLECTION_INTERVAL_MS);

  log("Reflection daemon started");
}

/**
 * Stop the reflection daemon.
 */
export function stopReflectionDaemon(): void {
  if (_reflectionTimer) {
    clearInterval(_reflectionTimer);
    _reflectionTimer = null;
    log("Reflection daemon stopped");
  }
}

/**
 * Manually trigger a reflection cycle (for testing/debugging).
 */
export async function triggerReflection(): Promise<ReflectionResult> {
  log("Manual reflection triggered");
  return runReflection();
}
