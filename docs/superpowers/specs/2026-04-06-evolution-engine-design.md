# Evolution Engine — Self-Evolving Bot System

**Date:** 2026-04-06
**Status:** Draft
**Repo:** NaichuanZhang/discord-claw

## Overview

The Evolution Engine is a new subsystem that gives the bot the ability to modify its own source code through GitHub pull requests. All changes are isolated in a git worktree (`beta/`), reviewed via PR, and deployed through an idempotent startup script. The bot can also detect its own limitations and propose improvements for human approval.

### Design Principles

1. **All source changes go through PRs** — the running bot's code is never modified directly
2. **Idempotent startup** — `start.sh` is safe to run any number of times with identical results
3. **Human approves, bot implements** — any user can trigger an evolution request, but all changes require PR review before they reach production
4. **Rollback is automatic** — if new code fails health checks after deploy, the system reverts to the last working state
5. **Worst case is a notification, not a lost bot** — every failure mode preserves the ability to recover

## Architecture

```
User request or bot detects limitation
        |
        v
Evolution Engine creates git worktree at beta/
        |
        v
Bot makes changes inside beta/ (isolated from running code)
        |
        v
Typecheck passes -> commit, push, create GitHub PR
        |
        v
Discord notification to owner with PR link + summary
        |
        v
Owner reviews & merges on GitHub
        |
        v
/restart -> start.sh: git pull -> migrate -> build -> start
        |
        v
Health check passes -> done (or auto-rollback + notify)
```

### New Files

```
discordclaw/
  start.sh                          # Idempotent startup script (new entry point)
  migrations/                       # Idempotent migration scripts
    README.md                       # How to write migrations
  src/evolution/
    engine.ts                       # Worktree lifecycle, PR creation, orchestration
    log.ts                          # SQLite-backed evolution history
    health.ts                       # /api/health endpoint
    tools.ts                        # Agent tool definitions for evolution
  src/gateway/ui/
    (evolution dashboard components) # Evolution history, ideas, active session
```

### Runtime Data

```
data/
  .migrations/                      # Marker files for completed migrations
    001-add-evolution-table.done    # Timestamp of completion

beta/                               # Git worktree at repo root (gitignored, exists only during active evolution)
```

Note: `beta/` must be added to `.gitignore`. It lives at repo root (not under `data/`) because it is a full git worktree checkout of a separate branch.

## Component 1: Startup Script (`start.sh`)

The new entry point for production. Replaces `npm run dev`.

### Requirements

- Every step is idempotent — running `start.sh` twice produces the same result
- Migrations track their own completion via marker files in `data/.migrations/`
- If the bot fails health checks after deploying new code, automatically rollback to the previous commit and restart
- Notification via Discord webhook on both success and failure — but notification failure never blocks startup
- If `git pull` or a migration fails, the bot is never started with partially-applied changes

### Script Flow

1. Save current `HEAD` as `$PREVIOUS_HEAD`
2. `git pull origin main` — if this fails, notify and exit (old bot keeps running)
3. `npm ci` only if `package-lock.json` changed between `$PREVIOUS_HEAD` and new `HEAD`
4. Run migrations: iterate `migrations/*.sh` in sorted order. For each:
   - Check if marker file `data/.migrations/<name>.done` exists — skip if so
   - Execute the migration script
   - On success: write marker file with timestamp
   - On failure: notify and exit immediately (do not start bot with partial migrations)
5. `npm run build`
6. Start bot (`tsx src/index.ts`) in background
7. Health check: poll `GET /api/health` for up to 30 seconds
8. If healthy: notify success, wait on bot process
9. If unhealthy: kill bot, `git reset --hard $PREVIOUS_HEAD`, re-execute `start.sh` (which re-runs idempotently — already-completed migrations are skipped)

### Rollback Safety

On rollback via `git reset --hard $PREVIOUS_HEAD`:
- Migrations that already completed keep their marker files — they won't re-run
- Migrations that were added by the failed commit no longer exist in `migrations/` — they're simply absent
- `npm ci` re-runs if lockfile differs — safe because `ci` is deterministic
- Build always runs — safe, deterministic

### Discord Webhook

The `DISCORD_WEBHOOK_URL` environment variable enables notifications from the startup script itself (not the bot). This ensures notifications work even when the bot is down. Webhook failures are silently ignored — they never block startup.

Messages:
- `"Bot started (<commit>)"` — successful startup
- `"Health check failed after <commit>. Rolling back to <previous>..."` — rollback triggered
- `"git pull failed"` — pull error
- `"Migration <name> failed. Bot NOT started."` — migration error

## Component 2: Migrations (`migrations/`)

Migration scripts live in the `migrations/` directory, sorted by filename (e.g., `001-add-evolution-table.sh`, `002-add-column.sh`).

### Requirements

- Each migration script MUST be internally idempotent (e.g., `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN IF NOT EXISTS`)
- Completion is tracked by marker files in `data/.migrations/<name>.done`
- The startup script skips migrations whose marker file exists
- Bot evolution PRs can add new migration scripts — they run on next restart

### Migration Script Template

```bash
#!/bin/bash
set -euo pipefail
# Migration: 001-add-evolution-table
# Idempotent: uses IF NOT EXISTS

sqlite3 data/discordclaw.db <<'SQL'
CREATE TABLE IF NOT EXISTS evolutions (
  id TEXT PRIMARY KEY,
  triggered_by TEXT,
  trigger_message TEXT,
  branch TEXT,
  pr_url TEXT,
  pr_number INTEGER,
  status TEXT DEFAULT 'idea',
  changes_summary TEXT,
  files_changed TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  proposed_at INTEGER,
  merged_at INTEGER,
  deployed_at INTEGER
);
SQL
```

### Double Safety

Even though the startup script tracks completion via marker files, each migration script is also internally idempotent. This means:
- If a marker file is accidentally deleted, re-running the migration is safe
- If the startup script is run on a fresh clone, all migrations run but produce the correct end state

## Component 3: Evolution Engine (`src/evolution/`)

### `engine.ts` — Orchestration

Manages the full lifecycle of an evolution session.

**State:** One active evolution at a time (simplicity — avoids merge conflicts between concurrent evolutions).

**Functions:**

- `startEvolution(reason: string, triggeredBy: string): Promise<Evolution>`
  - Validates no active evolution in progress
  - Creates branch `evolve/<slug>-<timestamp>` from current `main` HEAD
  - Creates git worktree at `beta/` on that branch: `git worktree add beta/ -b <branch>`
  - Inserts evolution record in SQLite with status `proposing`
  - Returns evolution object with ID, branch name, worktree path

- `finalizeEvolution(id: string, summary: string): Promise<{prUrl: string}>`
  - Runs `npm run typecheck` in worktree — aborts if it fails
  - Stages and commits all changes: `feat(evolution): <summary>`
  - Pushes branch to origin
  - Creates PR via `gh pr create` with structured body (see PR Template below)
  - Sends Discord message to triggering channel with PR link
  - Cleans up worktree: `git worktree remove beta/`
  - Updates evolution status to `proposed`

- `cancelEvolution(id: string): Promise<void>`
  - Removes worktree: `git worktree remove beta/ --force`
  - Deletes remote branch if pushed
  - Updates evolution status to `cancelled`

- `recordSuggestion(what: string, why: string, triggeredBy: string): Promise<Evolution>`
  - Inserts evolution record with status `idea`
  - No worktree, no branch — just a record

- `syncDeployedEvolutions(): void`
  - Called on startup
  - Checks if any `proposed` evolutions' branches are now merged into HEAD
  - Updates their status to `deployed` with timestamp

**PR Template:**

```markdown
## Evolution: <summary>

**Triggered by:** <discord username>
**Reason:** <original message/context>

### Changes
<list of files modified with brief description of each>

### Migrations
<list of migration scripts added, or "None">

---
*This PR was created by the Evolution Engine.*
```

### `log.ts` — Evolution History

SQLite table and query functions.

**Schema:**

```sql
CREATE TABLE IF NOT EXISTS evolutions (
  id TEXT PRIMARY KEY,
  triggered_by TEXT,
  trigger_message TEXT,
  branch TEXT,
  pr_url TEXT,
  pr_number INTEGER,
  status TEXT DEFAULT 'idea',
  changes_summary TEXT,
  files_changed TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  proposed_at INTEGER,
  merged_at INTEGER,
  deployed_at INTEGER
);
```

**Status values:** `idea`, `proposing`, `proposed`, `deployed`, `rolled_back`, `cancelled`, `rejected`

Note: There is no separate `merged` status. From the bot's perspective, merge and deploy happen together — `syncDeployedEvolutions()` runs on startup after `git pull` and transitions `proposed` → `deployed` for any evolutions whose branches are now in HEAD.

**Query functions:**
- `getEvolution(id)` — single evolution by ID
- `listEvolutions(filter?: {status?})` — list with optional status filter
- `getActiveEvolution()` — returns the current `proposing` evolution, or null
- `updateEvolution(id, fields)` — partial update
- `getDeployedEvolutions()` — all successfully deployed evolutions (for "what have you learned" queries)
- `getIdeas()` — all `idea` status records

### `health.ts` — Health Endpoint

Adds `GET /api/health` to the existing Express gateway.

Returns 200 with `{"status": "ok"}` when:
- SQLite database is responding (simple query succeeds)
- Discord client is connected (client.ws.status === 0)
- All core services initialized (soul, memory, skills loaded)

Returns 503 with `{"status": "unhealthy", "reason": "..."}` otherwise.

Registered during gateway startup — minimal code, no new dependencies.

## Component 4: Evolution Tools

Six new tools added to the agent's tool definitions.

### `evolve_start`

- **Input:** `reason: string` — why this evolution is needed
- **Behavior:** Calls `engine.startEvolution()`. Returns evolution ID, branch, and confirmation message.
- **Fails if:** Evolution already in progress.

### `evolve_read`

- **Input:** `path: string` — file path relative to repo root
- **Behavior:** Reads file from `beta/` worktree. Agent uses this to understand existing code before modifying.
- **Fails if:** No active evolution.

### `evolve_write`

- **Input:** `path: string`, `content: string`
- **Behavior:** Writes file inside `beta/` worktree. Creates parent directories if needed.
- **Fails if:** No active evolution. Path attempts to escape worktree.

### `evolve_bash`

- **Input:** `command: string`, `timeout?: number` (default 30s, max 60s)
- **Behavior:** Executes command with `cwd` set to `beta/`. Same output limits as existing bash tool (8KB cap).
- **Fails if:** No active evolution.

### `evolve_propose`

- **Input:** `summary: string` — PR description
- **Behavior:** Calls `engine.finalizeEvolution()`. Runs typecheck, commits, pushes, creates PR, notifies Discord. Returns PR URL.
- **Fails if:** No active evolution. Typecheck fails (returns errors for agent to fix).

### `evolve_suggest`

- **Input:** `what: string` — what capability is missing. `why: string` — context for why it's needed.
- **Behavior:** Calls `engine.recordSuggestion()`. Returns confirmation.
- **No active evolution required** — this is just recording an idea.

### Existing Tools

`write_file`, `bash`, `read_file` remain unchanged for operations on `data/`, runtime files, etc. The agent's system prompt instructs: "For any changes to source code (`src/`), TypeScript files, the startup script, or migrations, you MUST use the evolution tools. Use `evolve_start` to begin, make changes with `evolve_write`/`evolve_bash`, and submit with `evolve_propose`."

## Component 5: Bot-Initiated Proposals

The bot detects its own limitations and records suggestions.

### Triggers

1. **Tool failure during conversation** — When a tool call errors because the capability doesn't exist (not transient errors like network timeouts), the agent recognizes the gap and uses `evolve_suggest` to record the idea. It also tells the user: "I can't do that yet, but I've noted it as a potential improvement."

2. **Explicit reflection** — The agent's system prompt includes: "When you encounter a limitation that you could fix by modifying your own code, record it with `evolve_suggest`. Don't start an evolution unless explicitly asked."

### Lifecycle

Ideas are just records. They sit in the evolution log with status `idea` until:
- A user says "implement that idea" → bot starts an evolution session
- Owner clicks "implement" in the dashboard → sends a message to the bot
- Owner dismisses the idea → status updated to `rejected`

The bot never starts an evolution for its own ideas without human approval.

## Component 6: Dashboard & Discord Integration

### Dashboard (Gateway SPA)

New section in the existing React dashboard:

**Evolution History page:**
- Table of all evolutions: status badge, summary, triggered by, PR link, timestamps
- Filter by status
- Click into detail view showing files changed, full context

**Ideas page:**
- List of `idea` status evolutions
- "Implement" button (triggers bot to start an evolution session via API)
- "Dismiss" button (sets status to `rejected`)

**Active Evolution indicator:**
- If an evolution is in progress, show banner with branch name and files changed so far

### API Endpoints

Added to existing gateway:

- `GET /api/health` — health check (used by start.sh)
- `GET /api/evolutions` — list evolutions, optional `?status=` filter
- `GET /api/evolutions/:id` — single evolution detail
- `POST /api/evolutions/:id/implement` — tell bot to start evolution for an idea
- `POST /api/evolutions/:id/dismiss` — reject an idea

### Discord Integration

No new slash commands. The bot responds naturally in conversation:

- "What have you learned to do?" → queries deployed evolutions, summarizes capabilities added
- "What improvements are you thinking about?" → queries ideas
- "What PRs are pending?" → queries proposed evolutions with PR links
- "Implement idea #X" → starts evolution session for that idea

Notifications are sent to the channel where evolution was triggered:
- PR created: "I've created a PR for this: <link> — <summary>"
- PR merged detection (on restart): "Evolution deployed: <summary>"

## Dependencies

### Required

- `gh` CLI — must be installed and authenticated for PR creation. The bot checks for this on startup and logs a warning if missing.

### No New npm Packages

The design uses only existing dependencies:
- `better-sqlite3` for evolution log
- `express` for health endpoint
- `discord.js` for notifications
- Node `child_process` for git/gh commands

## Migration Plan

Initial setup requires one migration:

**`migrations/001-add-evolution-table.sh`:**
```bash
#!/bin/bash
set -euo pipefail
sqlite3 data/discordclaw.db <<'SQL'
CREATE TABLE IF NOT EXISTS evolutions (
  id TEXT PRIMARY KEY,
  triggered_by TEXT,
  trigger_message TEXT,
  branch TEXT,
  pr_url TEXT,
  pr_number INTEGER,
  status TEXT DEFAULT 'idea',
  changes_summary TEXT,
  files_changed TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  proposed_at INTEGER,
  merged_at INTEGER,
  deployed_at INTEGER
);
SQL
```

## Security Considerations

- **Path traversal:** `evolve_write` validates that resolved paths stay within the `beta/` worktree. Attempts to escape (e.g., `../../etc/passwd`) are rejected.
- **PR scope:** PRs are created against `main` on the same repo. No cross-repo pushes.
- **No self-merge:** The bot cannot merge its own PRs. A human must review and merge.
- **Worktree cleanup:** If the bot crashes mid-evolution, the worktree is cleaned up on next `evolve_start` (detects orphaned worktree and removes it).
- **gh CLI auth:** Uses whatever auth is configured on the host. The bot does not store GitHub tokens.

## Summary

| Component | File(s) | Purpose |
|-----------|---------|---------|
| Startup script | `start.sh` | Idempotent deploy: pull, migrate, build, start, health check, rollback |
| Migrations | `migrations/*.sh` | Schema/data changes, tracked by marker files |
| Evolution engine | `src/evolution/engine.ts` | Worktree lifecycle, PR creation, orchestration |
| Evolution log | `src/evolution/log.ts` | SQLite history of all evolutions |
| Health check | `src/evolution/health.ts` | `/api/health` for startup script |
| Evolution tools | `src/evolution/tools.ts` | Agent-facing tools: start, read, write, bash, propose, suggest |
| Dashboard | `src/gateway/ui/` | Evolution history, ideas, active session views |
| Discord | Agent system prompt | Natural language queries about evolution history |
