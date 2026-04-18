# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start bot + gateway (tsx src/index.ts)
npm run build        # TypeScript compile + Vite build dashboard
npm run build:ui     # Build dashboard SPA only
npm run typecheck    # tsc --noEmit
npm test             # Run integration tests (vitest run)
npm run test:watch   # Run tests in watch mode
npx vitest run tests/integration/foo.test.ts  # Run a single test file
npm run daemon       # Start watchdog daemon (spawns bot, health checks, crash recovery)
./start.sh           # Production: git pull → migrate → build → start → health check → rollback
```

The dashboard SPA lives at `src/gateway/ui/` and builds to `dist/ui/`. Vite dev server proxies `/api` and `/ws` to localhost:3000. The UI is excluded from `tsconfig.json` — it's built by Vite with its own React plugin.

## Testing

Integration tests live in `tests/integration/` and use **vitest**. They validate the critical boot path without calling external APIs:

- **Database**: Schema init, table existence, CRUD operations
- **Soul**: Loading from `data/SOUL.md`
- **Memory**: FTS5 indexing, search queries
- **Skills**: Service init, prompt section generation
- **Image extraction**: Pure function — markdown parsing for URL/file images
- **Tool registration**: All tool arrays export correctly with unique names

Tests run automatically as a quality gate in the evolution engine — `finalizeEvolution()` runs both `tsc --noEmit` and `vitest run` (120s timeout) before allowing a PR to be created. If either fails, the PR is blocked.

To add new tests, create files matching `tests/**/*.test.ts`.

## Architecture

This is a Discord bot that uses Claude as its AI backend. The system has major subsystems that initialize sequentially in `src/index.ts`: dotenv → database → soul → memory FTS5 indexing → skills → `gh` CLI check → voice assistant → cron → Discord client → gateway server → health check → evolution sync → session cleanup → reflection daemon.

### Bot → Agent → Claude API Pipeline

Discord messages flow through `bot/messages.ts` (filter, session resolve, thread creation, voice transcription, context build) → `agent/agent.ts` (system prompt assembly, tool loop with duplicate detection) → Anthropic SDK. The agent accepts an optional `onToolCallProgress` callback that fires for each tool invocation (start + result phases); `messages.ts` uses this to send real-time tool call status messages to Discord as the agentic loop runs. The agent returns an `AgentResponse` with text, extracted images (from markdown `![](url)` syntax), and aggregated token usage. `messages.ts` renders images as Discord embeds (URLs) or attachments (local files), and stores usage data alongside the assistant message in SQLite. Tool progress messages are rate-limited (max 4 per 5s window) and batched to respect Discord limits.

Key constants in `agent/agent.ts`: `DEFAULT_MODEL = "bedrock-claude-opus-4-7-1m"`, `MAX_TOKENS = 16384`, `MAX_CONSECUTIVE_DUPES = 2` (breaks infinite tool loops).

### Agent Tools

Tools are defined across multiple files and registered in `agent/agent.ts`:

| File | Tools | Purpose |
|------|-------|---------|
| `agent/tools.ts` | send_message, send_file, add_reaction, get_channel_history, create_thread | Discord channel operations |
| `agent/dangerous-tools.ts` | bash, read_file, write_file | System access |
| `shared/conversation-history.ts` | get_conversation_history, get_conversation_stats | Cross-session conversation replay |
| `memory/tools.ts` | memory_search, memory_get, mem9_store, mem9_update, mem9_delete | Hybrid search: local BM25 FTS5 + mem9 cloud memory |
| `memory/mem9.ts` | (internal) | mem9 cloud memory API client |
| `skills/tools.ts` | read_skill, list_skill_files | Progressive skill loading |
| `evolution/tools.ts` | evolve_start, evolve_read, evolve_write, evolve_bash, evolve_propose, evolve_suggest, evolve_cancel, evolve_review, evolve_merge | Self-modification via PRs |

**mem9 tools** (`mem9_store`, `mem9_update`, `mem9_delete`) are only registered when mem9 is configured via `data/skills/mem9/auth.json`. The `memory_search` tool always queries both local FTS5 and mem9 cloud in parallel (graceful fallback if mem9 is unavailable).

### Thread-Based Replies

In guild text channels, the bot always creates a new thread on the user's message and replies inside it (isolated context per conversation). Bot-created threads don't require @mention — thread ownership is tracked in a `Set<string>` with a fallback to `thread.ownerId`. DMs bypass threading. Monitored channels auto-respond without @mention. Thread names are auto-generated from the first line of the user's message.

### Voice System

`src/voice/` implements a full voice assistant pipeline: Discord audio → Opus decode → downsample to 16kHz mono (`receiver.ts`) → Silero VAD v4 (`vad.ts`, frame size 480 samples = 30ms) → EigenAI Whisper STT (`stt.ts`) → LLM agent (`agent.ts`) → EigenAI Chatterbox TTS (`tts.ts`) → playback.

Two LLM backends:
- **Anthropic** (default): `claude-sonnet-4-20250514` configurable via `VOICE_MODEL`. Full tool support with up to 5 tool rounds per utterance.
- **Eigen LLM** (`eigenllm.ts`): Set `VOICE_MODEL=eigen:<model>` (e.g., `eigen:qwen3-8b-fp8`). OpenAI-compatible streaming, pure text mode (no tools) for minimum latency.

Tool availability configurable via `VOICE_TOOLS_MODE`:
- `full` (default): memory, conversation history, Discord, skills, bash, file I/O — everything except evolution tools
- `minimal`: memory + conversation history only

`autoJoin.ts` tracks a configured user and auto-joins/leaves their voice channel. STT/TTS require `EIGENAI_API_KEY`.

Key voice constants: `SILENCE_DURATION_MS = 800` (configurable via `VOICE_SILENCE_MS`), `MIN_UTTERANCE_MS = 500` (configurable via `VOICE_MIN_UTTERANCE_MS`), `IDLE_TIMEOUT_MS = 10min` (auto-leave), `VOICE_MAX_TOKENS = 512` (configurable via `VOICE_MAX_TOKENS`), `MAX_TOOL_ROUNDS = 5`, `MAX_VOICE_HISTORY = 10` turns. Streaming TTS pipelining enabled by default (disable with `VOICE_TTS_STREAM=0`).

Separate from voice chat: `audio/transcribe.ts` handles Discord voice message transcription (audio attachments) via OpenAI's Whisper API.

### Session Management

Sessions are keyed by thread/channel/user/DM combination. `agent/sessions.ts` resolves the correct session and loads history from SQLite. Sessions auto-expire based on `SESSION_TTL_HOURS`. Thread-based sessions use the `thread:<threadId>` key format. Messages are archived across sessions, queryable via `get_conversation_history` and `get_conversation_stats` tools (defined in `shared/conversation-history.ts`).

### Soul, Memory, and Skills

- **Soul**: Bot personality loaded from `data/SOUL.md` with filesystem watcher for hot-reload. Injected into every system prompt.
- **Memory**: Hybrid search — local markdown files in `data/` and `data/memory/` chunked and indexed into SQLite FTS5 (BM25-ranked), plus optional mem9 cloud memory (`src/memory/mem9.ts`). Both sources are queried in parallel on every `memory_search` call. mem9 config lives in `data/skills/mem9/auth.json`. When mem9 is configured, additional tools (`mem9_store`, `mem9_update`, `mem9_delete`) are dynamically registered. Graceful fallback if mem9 is unavailable.
- **Skills**: SKILL.md files with YAML frontmatter in `data/skills/`. Progressive loading — only metadata in system prompt; full content via `read_skill` tool. Installable from GitHub URLs.

### Cron Service

Scheduled tasks in `data/cron/jobs.json` (gitignored; seed file tracked). Three schedule types: one-shot (`at`), interval (`every`), cron expression. Two payload kinds: `agentTurn` (agent handles delivery via tools — creates threads, no duplicate top-level messages) and `systemEvent` (cron service delivers directly). Auto-disables after 3 consecutive failures. Hot-reloads `jobs.json` on each tick cycle (up to every 60s).

### Evolution Engine

Self-modification via GitHub PRs. `src/evolution/engine.ts` manages git worktrees at `beta/`, runs typecheck and integration tests, pushes branches, creates PRs via `gh` CLI. Evolution status flow: `idea` → `proposing` → `proposed` (PR open) → `deployed` (merged). Also: `cancelled`, `rejected`, `rolled_back`. On startup, `syncDeployedEvolutions()` checks if proposed PRs were merged. `evolve_merge` merges the PR, posts a deployment notification thread to a configured channel, and triggers restart.

**Quality gates in `finalizeEvolution()`:**
1. `tsc --noEmit` — TypeScript typecheck (60s timeout)
2. `vitest run` — Integration tests (120s timeout)
3. Both must pass before the PR is created

### Structured Logging

`src/logging/` provides a lightweight structured logging system with three SQLite-backed log streams:

| Table | Purpose | Retention |
|-------|---------|-----------|
| `application_log` | General operational events (info, warn, debug) | 7 days |
| `error_log` | Errors & exceptions with stack traces | 30 days |
| `tool_call_log` | Every tool invocation with input, result, timing, success/failure | 7 days |

**Key files:**
- `logging/logger.ts` — Core logging functions: `appLog()`, `errorLog()`, `toolCallLog()`, plus `createLogger(category)` factory for scoped module loggers
- `logging/queries.ts` — Read-side queries: `getAppLogs()`, `getErrorLogs()`, `getToolCallLogs()`, `getToolCallStats()`, `getSlowestToolCalls()`, `getErrorCountsByCategory()`, `pruneLogs()`

**Usage pattern:**
```typescript
import { createLogger, toolCallLog } from "../logging/logger.js";
const log = createLogger("agent");
log.info("Processing message", { userId: "123" });
log.error("Failed to process", someError, { channelId: "456" });
```

All logging functions are **non-blocking and never throw** — errors during log persistence are silently caught. Console output is always preserved for the daemon's log buffer. DB persistence respects a configurable minimum log level (default: `info`).

The reflection daemon automatically consumes structured logs alongside signals, providing tool call statistics, error breakdowns by category, and slowest tool calls as additional context for self-improvement analysis. Log pruning happens during each reflection cycle.

### Reflection System

`src/reflection/` implements autonomous self-improvement discovery. Signal collection (`signals.ts`) passively records errors, tool failures, and duplicate loop patterns from `bot/messages.ts` and `agent/agent.ts`. The structured logging system (`src/logging/`) provides additional data: tool call statistics, error logs with stack traces, and performance metrics. The reflection daemon (`daemon.ts`) runs on a configurable interval (default: 6h), analyzes both signals and structured logs, and if an improvement is found, records an evolution idea and posts to Discord. Level 1 trust: never auto-implements.

### Gateway

Express server + WebSocket at `/ws/logs` for real-time log streaming. REST API at `/api/*` exposes CRUD for sessions, channels, config, soul, memory, skills, cron, and evolutions. Health check at `/api/health` (no auth). Auth middleware is currently disabled (TODO for cloud gateway). React SPA dashboard served from `dist/ui/`.

### Database Schema

SQLite with WAL mode, FKs enabled. Key tables in `src/db/index.ts`:
- `sessions` — keyed by discord_key (thread/channel/user combo), tracks agent_session_id and last_active
- `messages` — conversation history per session, includes per-API-call token usage columns (model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens)
- `channel_configs` — per-channel settings and system prompts
- `config` — global key-value store
- `memory_fts` — FTS5 virtual table for memory search
- `evolutions` — PR tracking (status, branch, pr_url, files_changed)
- `signals` — reflection event collection (type, source, detail, metadata JSON)
- `reflection_runs` — reflection daemon run history
- `message_history` — archived messages from deleted/expired sessions (preserves conversation history across cleanup)
- `application_log` — structured application log entries (level, category, message, metadata)
- `error_log` — structured error log entries with stack traces
- `tool_call_log` — tool invocation records with input, result, timing, success/failure status

### Migrations

Shell scripts in `migrations/` run by `start.sh` before build. All idempotent (`CREATE TABLE IF NOT EXISTS`). Completion tracked via `data/.migrations/{name}.done` marker files. Current migrations: evolution table, signals/reflection tables, usage columns on messages, Silero VAD v4 model download.

## Key Patterns

- **ESM throughout**: `"type": "module"` in package.json. All internal imports use `.js` extensions (NodeNext module resolution). Use `import.meta.url` / `fileURLToPath` for `__dirname`.
- **Singleton services**: `getDb()`, `getSoul()`, `getSkillService()` are module-level singletons. The Discord client reference is passed via setter functions (`setDiscordClient`, `setMessageClient`) to avoid circular deps.
- **Shared restart trigger**: `src/restart.ts` holds a callback set by `index.ts` and called by `commands.ts` / `api.ts` — avoids circular dependency between entry point and command handlers.
- **DM dedup**: `bot/client.ts` uses both `messageCreate` and a raw gateway event fallback for DMs, with a Set-based dedup mechanism (discord.js v14 sometimes misses DM events for uncached channels).
- **All runtime data** lives in `data/` (gitignored): SQLite DB, SOUL.md, memory files, cron store, skills, migration markers.
- **Evolution isolation**: `beta/` is a git worktree (gitignored). The running bot's source is never modified directly — all changes go through PRs.
- **Cron delivery separation**: `agentTurn` jobs let the agent handle all delivery. `systemEvent` jobs have results delivered by cron service directly. This prevents duplicate messages outside threads.
- **Skill vs Code guardrail**: The evolution system prompt includes a mandatory pre-flight decision tree. Before starting code evolution, the agent must evaluate whether the capability can be a skill or soul/memory change. See `EVOLUTION_INSTRUCTIONS` in `src/agent/agent.ts`.
- **Shared utilities**: `src/shared/` contains extracted helpers used by both the main agent and the voice agent — `paths.ts` (project root resolution), `anthropic.ts` (SDK client factory), `discord-utils.ts` (channel/guild helpers), `conversation-history.ts` (cross-session message loading + conversation history tool definitions). Import from `shared/` when adding code that both pipelines need.
- **Watchdog daemon**: `src/daemon/index.ts` is a standalone process (zero imports from the main bot) that spawns the bot, monitors health, handles crash recovery with evolution rollback, and sends Discord webhook notifications. Exit code 100 from the bot triggers a deploy-restart (git pull + rebuild) rather than a simple respawn.
- **Signal collection is passive and non-blocking**: `recordSignal()` never throws — errors during recording are caught and logged.
- **Structured logging is non-blocking**: All `appLog()`, `errorLog()`, and `toolCallLog()` calls silently catch DB errors. Console output is always preserved for the daemon log buffer. Use `createLogger(category)` factory for scoped module loggers.
- **Token usage**: Aggregated across all API calls within a single user→response turn (including tool-use loops). Costs computed at query time (not stored) so pricing can be updated without migration.
- **Production deployment**: `start.sh` runs: kill existing → git pull → npm ci (if lockfile changed) → migrations → seed cron → build → start → health check (30s timeout) → auto-rollback on failure. Discord webhook notifications on success/failure.
- **Dynamic tool registration**: Some tools are conditionally registered based on config (e.g., mem9 tools only appear when `data/skills/mem9/auth.json` exists). Tool lists are built via functions (`getMemoryTools()`, `getAllTools()`, `getCronTools()`) rather than static arrays.

## Skill vs Code Decision Guide

When adding new capabilities to the bot, use this decision tree:

1. **Needs new runtime plumbing?** (npm package, API client, Discord command, new tool, message pipeline change) → **Code evolution** via `evolve_start`
2. **Teachable via existing tools?** (bash, write_file, read_file, send_message, curl) → **Skill** — create `data/skills/<name>/SKILL.md`
3. **Personality/behavior/context change?** → **Soul/Memory** — update `data/SOUL.md` or `data/memory/`

Skills are preferred over code when possible: they're cheaper, safer, instantly available, don't require a restart, and are portable.

## Environment

`reference/` contains the upstream openclaw source (read-only) — useful for understanding original patterns when this fork diverges. It is not part of the build.

Requires either `ANTHROPIC_API_KEY` or `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` (for proxy). `DISCORD_BOT_TOKEN` is always required. `OPENAI_API_KEY` is optional — enables voice message transcription via Whisper. `EIGENAI_API_KEY` is optional — enables voice assistant STT/TTS via EigenAI. `REFLECTION_CHANNEL_ID` is optional — sets the Discord channel where reflection daemon posts proposals. `GATEWAY_PORT` defaults to 3000. `GATEWAY_TOKEN` configures API auth (currently disabled). Voice tuning: `VOICE_MODEL` (supports `eigen:<model>` prefix for Eigen LLM), `VOICE_SILENCE_MS` (default 800), `VOICE_MIN_UTTERANCE_MS` (default 500), `VOICE_MAX_TOKENS` (default 512), `VOICE_DEBUG` (default on), `VOICE_TTS_STREAM` (default on), `VOICE_TOOLS_MODE` (`full` or `minimal`, default `full`). Reflection tuning: `REFLECTION_INTERVAL_HOURS`, `REFLECTION_LOOKBACK_HOURS`, `REFLECTION_MIN_SIGNALS` (default 3), `REFLECTION_MODEL`. mem9 cloud memory: configured via `data/skills/mem9/auth.json` (contains `api_key`), not via `.env`. See `.env.example`.
