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
./start.sh           # Production: git pull → migrate → build → start → health check → rollback
```

The dashboard SPA lives at `src/gateway/ui/` and builds to `dist/ui/`. Vite dev server proxies `/api` and `/ws` to localhost:3000. The UI is excluded from `tsconfig.json` — it's built by Vite with its own React plugin.

## Testing

Integration tests live in `tests/integration/` and use **vitest**. They validate the critical boot path without calling external APIs:

- **Database**: Schema init, table existence, CRUD operations
- **Soul**: Loading and hot-reload from `data/SOUL.md`
- **Memory**: FTS5 indexing, search queries
- **Skills**: Service init, prompt section generation
- **Image extraction**: Pure function — markdown parsing for URL/file images
- **Tool registration**: All tool arrays export correctly with unique names

Tests run automatically as a quality gate in the evolution engine — `finalizeEvolution()` runs both `tsc --noEmit` and `vitest run` before allowing a PR to be created. If tests fail, the PR is blocked.

To add new tests, create files matching `tests/**/*.test.ts`.

## Architecture

This is a Discord bot that uses Claude as its AI backend. The system has major subsystems that initialize sequentially in `src/index.ts`: dotenv → database → soul → memory FTS5 indexing → skills → `gh` CLI check → voice assistant → cron → Discord client → gateway server → health check → evolution sync → session cleanup → reflection daemon.

### Bot → Agent → Claude API Pipeline

Discord messages flow through `bot/messages.ts` (filter, session resolve, thread creation, voice transcription, context build) → `agent/agent.ts` (system prompt assembly, tool loop with duplicate detection) → Anthropic SDK. The agent returns an `AgentResponse` with text, extracted images (from markdown `![](url)` syntax), and aggregated token usage. `messages.ts` renders images as Discord embeds (URLs) or attachments (local files), and stores usage data alongside the assistant message in SQLite.

Key constants in `agent/agent.ts`: `DEFAULT_MODEL = "bedrock-claude-opus-4-6-1m"`, `MAX_TOKENS = 16384`, `MAX_CONSECUTIVE_DUPES = 2` (breaks infinite tool loops).

### Agent Tools

Tools are defined across multiple files and registered in `agent/agent.ts`:

| File | Tools | Purpose |
|------|-------|---------|
| `agent/tools.ts` | send_message, send_file, add_reaction, get_channel_history, create_thread | Discord channel operations |
| `agent/dangerous-tools.ts` | bash, read_file, write_file | System access |
| `agent/agent.ts` | get_conversation_history, get_conversation_stats | Cross-session conversation replay |
| `memory/tools.ts` | memory_search, memory_get, memory_store | BM25 FTS5 knowledge search + mem9 cloud memory |
| `skills/tools.ts` | read_skill, list_skill_files | Progressive skill loading |
| `evolution/tools.ts` | evolve_start, evolve_read, evolve_write, evolve_bash, evolve_propose, evolve_suggest, evolve_cancel, evolve_review, evolve_merge | Self-modification via PRs |

### Thread-Based Replies

In guild text channels, the bot always creates a new thread on the user's message and replies inside it (isolated context per conversation). Bot-created threads don't require @mention — thread ownership is tracked in a `Set<string>` with a fallback to `thread.ownerId`. DMs bypass threading. Monitored channels auto-respond without @mention. Thread names are auto-generated from the first line of the user's message.

### Voice System

`src/voice/` implements a full voice assistant pipeline: Discord audio → Opus decode → downsample to 16kHz mono (`receiver.ts`) → Silero VAD v4 (`vad.ts`, frame size 480 samples = 30ms) → EigenAI Whisper STT (`stt.ts`) → Claude Sonnet agent (`agent.ts`, model `claude-sonnet-4-20250514` configurable via `VOICE_MODEL`) → EigenAI Chatterbox TTS (`tts.ts`) → playback. STT/TTS require `EIGENAI_API_KEY`. `autoJoin.ts` tracks a configured user and auto-joins/leaves their voice channel. The voice agent has the same tools as the main agent except evolution tools.

Key voice constants: `SILENCE_DURATION_MS = 1500`, `MIN_UTTERANCE_MS = 500`, `IDLE_TIMEOUT_MS = 10min` (auto-leave), `VOICE_MAX_TOKENS = 1024`. Configurable via `VOICE_SILENCE_MS`, `VOICE_MIN_UTTERANCE_MS` env vars.

Separate from voice chat: `audio/transcribe.ts` handles Discord voice message transcription (audio attachments) via OpenAI's Whisper API.

### Session Management

Sessions are keyed by thread/channel/user/DM combination. `agent/sessions.ts` resolves the correct session and loads history from SQLite. Sessions auto-expire based on `SESSION_TTL_HOURS`. Thread-based sessions use the `thread:<threadId>` key format. Messages are archived across sessions, queryable via `get_conversation_history` and `get_conversation_stats` tools.

### Soul, Memory, and Skills

- **Soul**: Bot personality loaded from `data/SOUL.md` with filesystem watcher for hot-reload. Injected into every system prompt.
- **Memory**: Dual-layer memory system. Local layer: Markdown files in `data/` and `data/memory/` are chunked and indexed into SQLite FTS5 (BM25-ranked full-text search). Cloud layer: mem9 API (`src/memory/mem9.ts`) provides semantic cloud memory via `https://api.mem9.ai`. When configured (`MEM9_API_KEY` + `MEM9_ORG_ID`), `memory_search` queries both local FTS5 and mem9, merging results. `memory_store` writes to mem9 cloud. Falls back gracefully to local-only when mem9 is not configured.
- **Skills**: SKILL.md files with YAML frontmatter in `data/skills/`. Progressive loading — only metadata in system prompt; full content via `read_skill` tool. Installable from GitHub URLs.

### Cron Service

Scheduled tasks in `data/cron/jobs.json` (gitignored; seed file tracked). Three schedule types: one-shot (`at`), interval (`every`), cron expression. Two payload kinds: `agentTurn` (agent handles delivery via tools — creates threads, no duplicate top-level messages) and `systemEvent` (cron service delivers directly). Auto-disables after 3 consecutive failures. Hot-reloads `jobs.json` on each tick cycle (up to every 60s).

### Evolution Engine

Self-modification via GitHub PRs. `src/evolution/engine.ts` manages git worktrees at `beta/`, runs typecheck and integration tests, pushes branches, creates PRs via `gh` CLI. Evolution status flow: `idea` → `proposing` → `proposed` (PR open) → `deployed` (merged). Also: `cancelled`, `rejected`, `rolled_back`. On startup, `syncDeployedEvolutions()` checks if proposed PRs were merged. `evolve_merge` merges the PR, posts a deployment notification thread to a configured channel, and triggers restart.

**Quality gates in `finalizeEvolution()`:**
1. `tsc --noEmit` — TypeScript typecheck
2. `vitest run` — Integration tests (120s timeout)
3. Both must pass before the PR is created

### Reflection System

`src/reflection/` implements autonomous self-improvement discovery. Signal collection (`signals.ts`) passively records errors, tool failures, and duplicate loop patterns from `bot/messages.ts` and `agent/agent.ts`. The reflection daemon (`daemon.ts`) runs on a configurable interval (default: 6h), analyzes signals, and if an improvement is found, records an evolution idea and posts to Discord. Level 1 trust: never auto-implements.

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
- **Signal collection is passive and non-blocking**: `recordSignal()` never throws — errors during recording are caught and logged.
- **Token usage**: Aggregated across all API calls within a single user→response turn (including tool-use loops). Costs computed at query time (not stored) so pricing can be updated without migration.
- **Production deployment**: `start.sh` runs: kill existing → git pull → npm ci (if lockfile changed) → migrations → seed cron → build → start → health check (30s timeout) → auto-rollback on failure. Discord webhook notifications on success/failure.
- **Memory dual-layer**: When `MEM9_API_KEY` and `MEM9_ORG_ID` are set, memory tools operate in dual mode — searching both local FTS5 and mem9 cloud, and enabling `memory_store` for cloud persistence. When not configured, gracefully falls back to local-only. The `handleMemoryTool` function is async to support mem9 API calls.

## Skill vs Code Decision Guide

When adding new capabilities to the bot, use this decision tree:

1. **Needs new runtime plumbing?** (npm package, API client, Discord command, new tool, message pipeline change) → **Code evolution** via `evolve_start`
2. **Teachable via existing tools?** (bash, write_file, read_file, send_message, curl) → **Skill** — create `data/skills/<name>/SKILL.md`
3. **Personality/behavior/context change?** → **Soul/Memory** — update `data/SOUL.md` or `data/memory/`

Skills are preferred over code when possible: they're cheaper, safer, instantly available, don't require a restart, and are portable.

## Environment

Requires either `ANTHROPIC_API_KEY` or `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` (for proxy). `DISCORD_BOT_TOKEN` is always required. `OPENAI_API_KEY` is optional — enables voice message transcription via Whisper. `EIGENAI_API_KEY` is optional — enables voice assistant STT/TTS via EigenAI. `MEM9_API_KEY` + `MEM9_ORG_ID` are optional — enable mem9 cloud memory (search + store). `REFLECTION_CHANNEL_ID` is optional — sets the Discord channel where reflection daemon posts proposals. `GATEWAY_PORT` defaults to 3000. `GATEWAY_TOKEN` configures API auth (currently disabled). `LOG_LEVEL` controls logging verbosity. Voice tuning: `VOICE_MODEL`, `VOICE_SILENCE_MS`, `VOICE_MIN_UTTERANCE_MS`. Reflection tuning: `REFLECTION_INTERVAL_HOURS`, `REFLECTION_LOOKBACK_HOURS`, `REFLECTION_MIN_SIGNALS` (default 3), `REFLECTION_MODEL`. See `.env.example`.
