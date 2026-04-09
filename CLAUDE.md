# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start bot + gateway (tsx src/index.ts)
npm run build        # TypeScript compile + Vite build dashboard
npm run build:ui     # Build dashboard SPA only
npm run typecheck    # tsc --noEmit (no test suite exists)
./start.sh           # Production: git pull → migrate → build → start → health check → rollback
```

The dashboard SPA lives at `src/gateway/ui/` and builds to `dist/ui/`. Vite dev server proxies `/api` and `/ws` to localhost:3000.

## Architecture

This is a Discord bot that uses Claude as its AI backend. The system has nine major subsystems that initialize sequentially in `src/index.ts`:

**Bot → Agent → Claude API pipeline**: Discord messages flow through `bot/messages.ts` (filter, session resolve, thread creation, voice transcription, context build) → `agent/agent.ts` (system prompt assembly, tool loop with duplicate detection) → Anthropic SDK. The agent returns an `AgentResponse` with text, extracted images (from markdown `![](url)` syntax), and aggregated token usage. `messages.ts` renders images as Discord embeds (URLs) or attachments (local files), and stores usage data alongside the assistant message in SQLite. The agent has tools for memory search, Discord actions, skill reading, dangerous ops (bash, file I/O), and self-evolution (worktree + PR).

**Thread-based replies**: In guild text channels, the bot always creates a new thread on the user's message and replies inside it. This ensures each conversation gets its own isolated context (no cross-conversation pollution). In bot-created threads, no @mention is required — the bot responds to all messages. Thread ownership is tracked in-memory with a fallback check on `thread.ownerId`. DMs continue to work without threads. The thread name is auto-generated from the first line of the user's message.

**Token usage tracking**: Each assistant message in the `messages` table stores per-API-call token counts: `model`, `input_tokens`, `output_tokens`, `cache_creation_tokens`, `cache_read_tokens`. Usage is aggregated across all API calls within a single user→response turn (including tool-use loops). Costs are computed at query time (not stored) so pricing can be updated without migrating data. Query example: `SELECT model, SUM(input_tokens), SUM(output_tokens) FROM messages WHERE model IS NOT NULL GROUP BY model`.

**Voice message transcription**: `audio/transcribe.ts` handles Discord voice DMs. When a message has the `IsVoiceMessage` flag or audio attachments (.ogg, .mp3, .wav, etc.), `messages.ts` downloads the audio and sends it to OpenAI's Whisper API for transcription. The transcribed text is then passed to the agent as the message content. Requires `OPENAI_API_KEY`. Gracefully degrades if not configured.

**Session management**: Sessions are keyed by thread/channel/user/DM combination. `agent/sessions.ts` resolves the correct session and loads history from SQLite. Sessions auto-expire based on `SESSION_TTL_HOURS`. Thread-based sessions use the `thread:<threadId>` key format, ensuring each thread has its own isolated conversation history.

**Soul system**: Bot personality loaded from `data/SOUL.md` with filesystem watcher for hot-reload. Injected into every system prompt.

**Memory system**: Markdown files in `data/` and `data/memory/` are chunked and indexed into SQLite FTS5. The agent searches memory via BM25-ranked full-text search before answering context-dependent questions.

**Skills system**: SKILL.md files with YAML frontmatter in `data/skills/`. Uses progressive loading — only metadata goes into the system prompt; full content is read on demand via `read_skill` tool. Installable from GitHub URLs.

**Cron service**: Scheduled tasks stored as JSON in `data/cron/`. Three schedule types: one-shot (`at`), interval (`every`), cron expression. Jobs can run agent turns and deliver results to Discord channels. Auto-disables after 3 consecutive failures.

**Evolution engine**: Self-modification via GitHub PRs. `src/evolution/engine.ts` manages git worktrees at `beta/`, runs typecheck, pushes branches, and creates PRs via `gh` CLI. 9 agent tools (`evolve_start/read/write/bash/propose/suggest/cancel/review/merge`). `evolve_review` shows PR diff and summary; `evolve_merge` merges the PR via `gh` and triggers an automatic restart to deploy. Evolution history tracked in SQLite `evolutions` table. On startup, `syncDeployedEvolutions()` checks if proposed PRs were merged. `start.sh` is the production entry point: pulls, runs idempotent migrations from `migrations/`, builds, starts, health-checks, and auto-rolls back on failure.

**Reflection system** (self-evolution feedback loop): `src/reflection/` implements autonomous self-improvement discovery. Two components:
- **Signal collection** (`reflection/signals.ts`): Records events that inform self-evolution — errors, tool failures, duplicate loop patterns. Signals are collected passively from `bot/messages.ts` (message processing errors) and `agent/agent.ts` (tool failures, duplicate tool call loops). Stored in the `signals` SQLite table with type, source, detail, and metadata. Auto-prunes signals older than 7 days.
- **Reflection daemon** (`reflection/daemon.ts`): Runs on a configurable interval (default: every 6 hours). Gathers signals from the lookback window (default: 24h), builds a structured prompt with signal summaries/conversation stats/existing ideas, calls Claude to analyze the data, and if an improvement is found, records it as an evolution idea and posts a proposal to a Discord channel. Level 1 trust: never auto-implements — always requires human approval. Configured via `REFLECTION_CHANNEL_ID`, `REFLECTION_INTERVAL_HOURS`, `REFLECTION_LOOKBACK_HOURS`, `REFLECTION_MIN_SIGNALS`.

**Gateway**: Express server + WebSocket at `/ws/logs` for real-time log streaming. REST API at `/api/*` exposes all subsystem CRUD including evolution history. React SPA dashboard served from `dist/ui/`.

## Key Patterns

- **ESM throughout**: `"type": "module"` in package.json. All internal imports use `.js` extensions (NodeNext module resolution). Use `import.meta.url` / `fileURLToPath` for `__dirname`.
- **Singleton services**: `getDb()`, `getSoul()`, `getSkillService()` are module-level singletons. The Discord client reference is passed via setter functions (`setDiscordClient`, `setMessageClient`) to avoid circular deps.
- **Shared restart trigger**: `src/restart.ts` holds a callback set by `index.ts` and called by `commands.ts` / `api.ts` — avoids circular dependency between entry point and command handlers.
- **Thread-first replies**: In guild text channels, every bot response creates a thread. Bot-created threads don't require @mentions for follow-up messages. Thread ownership is tracked in a `Set<string>` with a fallback to `thread.ownerId`. DMs bypass threading entirely.
- **DM dedup**: `bot/client.ts` uses both `messageCreate` and a raw gateway event fallback for DMs, with a Set-based dedup mechanism (discord.js v14 sometimes misses DM events for uncached channels).
- **All runtime data** lives in `data/` (gitignored): SQLite DB, SOUL.md, memory files, cron store, skills, migration markers.
- **Evolution isolation**: `beta/` is a git worktree (gitignored). The running bot's source is never modified directly — all changes go through PRs.
- **Skill vs Code guardrail**: The evolution system prompt includes a mandatory pre-flight decision tree. Before starting any code evolution, the agent must evaluate whether the capability can be delivered as a skill (`data/skills/<name>/SKILL.md`) using existing tools, or as a soul/memory change. Code evolutions are reserved for new runtime capabilities (new tools, new API clients, new packages, pipeline changes, bug fixes). See `EVOLUTION_INSTRUCTIONS` in `src/agent/agent.ts`.
- **Signal collection is passive and non-blocking**: `recordSignal()` never throws — errors during recording are caught and logged. This ensures signal collection can never crash the main message processing pipeline.

## Skill vs Code Decision Guide

When adding new capabilities to the bot, use this decision tree:

1. **Needs new runtime plumbing?** (npm package, API client, Discord command, new tool, message pipeline change) → **Code evolution** via `evolve_start`
2. **Teachable via existing tools?** (bash, write_file, read_file, send_message, curl) → **Skill** — create `data/skills/<name>/SKILL.md`
3. **Personality/behavior/context change?** → **Soul/Memory** — update `data/SOUL.md` or `data/memory/`

Skills are preferred over code when possible: they're cheaper, safer, instantly available, don't require a restart, and are portable.

## Environment

Requires either `ANTHROPIC_API_KEY` or `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` (for proxy). `DISCORD_BOT_TOKEN` is always required. `OPENAI_API_KEY` is optional — enables voice message transcription via Whisper. `REFLECTION_CHANNEL_ID` is optional — sets the Discord channel where the reflection daemon posts improvement proposals. See `.env.example`.
