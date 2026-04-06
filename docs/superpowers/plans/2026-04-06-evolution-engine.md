# Evolution Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a self-evolution system where the bot proposes source code changes via GitHub PRs, isolated in a git worktree at `beta/`.

**Architecture:** New `src/evolution/` subsystem with 4 files (log, engine, tools, health). All source changes go through PRs created from an isolated git worktree. An idempotent `start.sh` handles pull, migrate, build, start, and auto-rollback. Dashboard and API expose evolution history.

**Tech Stack:** TypeScript, better-sqlite3, Express, discord.js, git worktrees, `gh` CLI, bash

---

## File Structure

**Create:**
- `src/evolution/log.ts` — Evolution SQLite table + CRUD functions
- `src/evolution/engine.ts` — Worktree lifecycle, git operations, PR creation
- `src/evolution/tools.ts` — 6 agent-facing tool definitions + handler
- `src/evolution/health.ts` — `/api/health` endpoint registration
- `src/gateway/ui/pages/Evolution.tsx` — Dashboard evolution page
- `start.sh` — Idempotent startup script
- `migrations/001-add-evolution-table.sh` — Initial migration (template)

**Modify:**
- `src/db/index.ts:74-116` — Add evolution table to `initDb()` schema
- `src/agent/agent.ts:1-8` — Import evolution tools
- `src/agent/agent.ts:61-66` — Register evolution tools in `allTools`
- `src/agent/agent.ts:81-118` — Add evolution section to `buildSystemPrompt()`
- `src/agent/agent.ts:153-178` — Add evolution tool dispatch to `executeTool()`
- `src/gateway/api.ts:1-18` — Import evolution log functions
- `src/gateway/api.ts:519-526` — Add evolution API routes before bot control section
- `src/gateway/ui/App.tsx:1-9` — Import Evolution page
- `src/gateway/ui/App.tsx:182-190` — Add evolution to pages map
- `src/index.ts:7-14` — Import evolution modules
- `src/index.ts:56-72` — Initialize evolution engine + sync deployed
- `src/index.ts:119-128` — Log evolution count in startup summary
- `.gitignore` — Add `beta/` and `data/.migrations/`

---

### Task 1: Evolution Log — Database Schema & CRUD

**Files:**
- Modify: `src/db/index.ts:74-116`
- Create: `src/evolution/log.ts`

- [ ] **Step 1: Add evolution table to initDb()**

In `src/db/index.ts`, add the evolution table to the `d.exec()` call, right before the closing `);` on line 115:

```typescript
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      path,
      chunk_text,
      start_line UNINDEXED,
      end_line UNINDEXED
    );

    CREATE TABLE IF NOT EXISTS evolutions (
      id TEXT PRIMARY KEY,
      triggered_by TEXT,
      trigger_message TEXT,
      branch TEXT,
      pr_url TEXT,
      pr_number INTEGER,
      status TEXT NOT NULL DEFAULT 'idea',
      changes_summary TEXT,
      files_changed TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      proposed_at INTEGER,
      merged_at INTEGER,
      deployed_at INTEGER
    );
```

Note: timestamps use `Date.now()` (milliseconds) to match the rest of the codebase.

- [ ] **Step 2: Create `src/evolution/log.ts`**

```typescript
// ---------------------------------------------------------------------------
// Evolution log — SQLite-backed history of all evolutions
// ---------------------------------------------------------------------------

import { nanoid } from "nanoid";
import { getDb } from "../db/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EvolutionStatus =
  | "idea"
  | "proposing"
  | "proposed"
  | "deployed"
  | "rolled_back"
  | "cancelled"
  | "rejected";

export interface Evolution {
  id: string;
  triggeredBy: string | null;
  triggerMessage: string | null;
  branch: string | null;
  prUrl: string | null;
  prNumber: number | null;
  status: EvolutionStatus;
  changesSummary: string | null;
  filesChanged: string[] | null;
  createdAt: number;
  proposedAt: number | null;
  mergedAt: number | null;
  deployedAt: number | null;
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function rowToEvolution(row: Record<string, unknown>): Evolution {
  return {
    id: row.id as string,
    triggeredBy: (row.triggered_by as string) ?? null,
    triggerMessage: (row.trigger_message as string) ?? null,
    branch: (row.branch as string) ?? null,
    prUrl: (row.pr_url as string) ?? null,
    prNumber: (row.pr_number as number) ?? null,
    status: row.status as EvolutionStatus,
    changesSummary: (row.changes_summary as string) ?? null,
    filesChanged: row.files_changed
      ? (JSON.parse(row.files_changed as string) as string[])
      : null,
    createdAt: row.created_at as number,
    proposedAt: (row.proposed_at as number) ?? null,
    mergedAt: (row.merged_at as number) ?? null,
    deployedAt: (row.deployed_at as number) ?? null,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function createEvolution(opts: {
  triggeredBy: string;
  triggerMessage?: string;
  branch?: string;
  status?: EvolutionStatus;
}): Evolution {
  const id = nanoid();
  const now = Date.now();
  const status = opts.status ?? "idea";

  getDb()
    .prepare(
      `INSERT INTO evolutions (id, triggered_by, trigger_message, branch, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, opts.triggeredBy, opts.triggerMessage ?? null, opts.branch ?? null, status, now);

  return {
    id,
    triggeredBy: opts.triggeredBy,
    triggerMessage: opts.triggerMessage ?? null,
    branch: opts.branch ?? null,
    prUrl: null,
    prNumber: null,
    status,
    changesSummary: null,
    filesChanged: null,
    createdAt: now,
    proposedAt: null,
    mergedAt: null,
    deployedAt: null,
  };
}

export function getEvolution(id: string): Evolution | undefined {
  const row = getDb()
    .prepare("SELECT * FROM evolutions WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToEvolution(row) : undefined;
}

export function getActiveEvolution(): Evolution | undefined {
  const row = getDb()
    .prepare("SELECT * FROM evolutions WHERE status = 'proposing' LIMIT 1")
    .get() as Record<string, unknown> | undefined;
  return row ? rowToEvolution(row) : undefined;
}

export function listEvolutions(filter?: {
  status?: EvolutionStatus;
}): Evolution[] {
  const db = getDb();
  let sql = "SELECT * FROM evolutions";
  const params: unknown[] = [];

  if (filter?.status) {
    sql += " WHERE status = ?";
    params.push(filter.status);
  }

  sql += " ORDER BY created_at DESC";

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(rowToEvolution);
}

export function getIdeas(): Evolution[] {
  return listEvolutions({ status: "idea" });
}

export function getDeployedEvolutions(): Evolution[] {
  return listEvolutions({ status: "deployed" });
}

export function updateEvolution(
  id: string,
  fields: Partial<{
    status: EvolutionStatus;
    branch: string;
    prUrl: string;
    prNumber: number;
    changesSummary: string;
    filesChanged: string[];
    proposedAt: number;
    mergedAt: number;
    deployedAt: number;
  }>,
): void {
  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (fields.status !== undefined) {
    setClauses.push("status = ?");
    params.push(fields.status);
  }
  if (fields.branch !== undefined) {
    setClauses.push("branch = ?");
    params.push(fields.branch);
  }
  if (fields.prUrl !== undefined) {
    setClauses.push("pr_url = ?");
    params.push(fields.prUrl);
  }
  if (fields.prNumber !== undefined) {
    setClauses.push("pr_number = ?");
    params.push(fields.prNumber);
  }
  if (fields.changesSummary !== undefined) {
    setClauses.push("changes_summary = ?");
    params.push(fields.changesSummary);
  }
  if (fields.filesChanged !== undefined) {
    setClauses.push("files_changed = ?");
    params.push(JSON.stringify(fields.filesChanged));
  }
  if (fields.proposedAt !== undefined) {
    setClauses.push("proposed_at = ?");
    params.push(fields.proposedAt);
  }
  if (fields.mergedAt !== undefined) {
    setClauses.push("merged_at = ?");
    params.push(fields.mergedAt);
  }
  if (fields.deployedAt !== undefined) {
    setClauses.push("deployed_at = ?");
    params.push(fields.deployedAt);
  }

  if (setClauses.length === 0) return;

  params.push(id);
  getDb()
    .prepare(`UPDATE evolutions SET ${setClauses.join(", ")} WHERE id = ?`)
    .run(...params);
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors)

- [ ] **Step 4: Commit**

```bash
git add src/db/index.ts src/evolution/log.ts
git commit -m "feat(evolution): add evolution table schema and log CRUD"
```

---

### Task 2: Health Endpoint

**Files:**
- Create: `src/evolution/health.ts`
- Modify: `src/gateway/api.ts:49-55`

- [ ] **Step 1: Create `src/evolution/health.ts`**

```typescript
// ---------------------------------------------------------------------------
// Health endpoint — used by start.sh to verify bot is running
// ---------------------------------------------------------------------------

import type { Router, Request, Response } from "express";
import { getDb } from "../db/index.js";

let _discordClient: any = null;
let _servicesReady = false;

export function setHealthDiscordClient(client: any): void {
  _discordClient = client;
}

export function setServicesReady(ready: boolean): void {
  _servicesReady = ready;
}

export function registerHealthRoute(router: Router): void {
  router.get("/health", (_req: Request, res: Response) => {
    try {
      // Check SQLite is responding
      const dbOk = (() => {
        try {
          getDb().prepare("SELECT 1").get();
          return true;
        } catch {
          return false;
        }
      })();

      // Check Discord client is connected
      const discordOk = _discordClient?.ws?.status === 0;

      // Check all services initialized
      const allOk = dbOk && discordOk && _servicesReady;

      if (allOk) {
        res.json({ status: "ok" });
      } else {
        const reasons: string[] = [];
        if (!dbOk) reasons.push("database not responding");
        if (!discordOk) reasons.push("discord not connected");
        if (!_servicesReady) reasons.push("services not initialized");
        res.status(503).json({ status: "unhealthy", reasons });
      }
    } catch (err) {
      res.status(503).json({ status: "unhealthy", reasons: [String(err)] });
    }
  });
}
```

- [ ] **Step 2: Register health route in API router**

In `src/gateway/api.ts`, add the import at the top (after existing imports around line 14):

```typescript
import { registerHealthRoute } from "../evolution/health.js";
```

Then inside `createApiRouter()`, right after `const router = Router();` (line 55), add:

```typescript
  // Health endpoint (used by start.sh, no auth)
  registerHealthRoute(router);
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/evolution/health.ts src/gateway/api.ts
git commit -m "feat(evolution): add /api/health endpoint for startup script"
```

---

### Task 3: Evolution Engine — Worktree & Git Operations

**Files:**
- Create: `src/evolution/engine.ts`

- [ ] **Step 1: Create `src/evolution/engine.ts`**

```typescript
// ---------------------------------------------------------------------------
// Evolution Engine — worktree lifecycle, git operations, PR creation
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, symlinkSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createEvolution,
  getActiveEvolution,
  getEvolution,
  listEvolutions,
  updateEvolution,
  type Evolution,
} from "./log.js";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..", "..");
const BETA_DIR = join(PROJECT_ROOT, "beta");

const GIT_TIMEOUT = 30_000;
const GH_TIMEOUT = 30_000;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(...args: unknown[]): void {
  console.log("[evolution]", ...args);
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

async function git(
  args: string[],
  opts?: { cwd?: string },
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync("git", args, {
    cwd: opts?.cwd ?? PROJECT_ROOT,
    timeout: GIT_TIMEOUT,
    maxBuffer: 1024 * 1024,
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

async function gh(
  args: string[],
  opts?: { cwd?: string },
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync("gh", args, {
    cwd: opts?.cwd ?? PROJECT_ROOT,
    timeout: GH_TIMEOUT,
    maxBuffer: 1024 * 1024,
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

// ---------------------------------------------------------------------------
// Slug helper
// ---------------------------------------------------------------------------

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

// ---------------------------------------------------------------------------
// Discord notification callback
// ---------------------------------------------------------------------------

let _sendToDiscord: ((channelId: string, text: string) => Promise<void>) | null =
  null;

export function setEvolutionSendToDiscord(
  fn: (channelId: string, text: string) => Promise<void>,
): void {
  _sendToDiscord = fn;
}

// ---------------------------------------------------------------------------
// Engine functions
// ---------------------------------------------------------------------------

/**
 * Start a new evolution session. Creates a git worktree at beta/.
 */
export async function startEvolution(opts: {
  reason: string;
  triggeredBy: string;
  channelId?: string;
}): Promise<Evolution> {
  // Check for active evolution
  const active = getActiveEvolution();
  if (active) {
    throw new Error(
      `Evolution already in progress: ${active.id} (${active.branch}). Cancel it first with evolve_cancel.`,
    );
  }

  // Clean up orphaned worktree if it exists
  if (existsSync(BETA_DIR)) {
    log("Cleaning up orphaned beta/ worktree...");
    try {
      await git(["worktree", "remove", "beta", "--force"]);
    } catch {
      rmSync(BETA_DIR, { recursive: true, force: true });
    }
  }

  // Create branch name
  const slug = slugify(opts.reason);
  const ts = Date.now();
  const branch = `evolve/${slug}-${ts}`;

  // Create evolution record
  const evolution = createEvolution({
    triggeredBy: opts.triggeredBy,
    triggerMessage: opts.reason,
    branch,
    status: "proposing",
  });

  // Create worktree
  log(`Creating worktree at beta/ on branch ${branch}`);
  await git(["worktree", "add", "beta", "-b", branch]);

  // Symlink node_modules so typecheck works in worktree
  const worktreeNodeModules = join(BETA_DIR, "node_modules");
  const mainNodeModules = join(PROJECT_ROOT, "node_modules");
  if (!existsSync(worktreeNodeModules) && existsSync(mainNodeModules)) {
    symlinkSync(mainNodeModules, worktreeNodeModules);
  }

  log(`Evolution ${evolution.id} started on ${branch}`);
  return evolution;
}

/**
 * Finalize an evolution: typecheck, commit, push, create PR.
 */
export async function finalizeEvolution(opts: {
  id: string;
  summary: string;
  channelId?: string;
}): Promise<{ prUrl: string; prNumber: number }> {
  const evolution = getEvolution(opts.id);
  if (!evolution || evolution.status !== "proposing") {
    throw new Error(`No active evolution with id ${opts.id}`);
  }

  if (!existsSync(BETA_DIR)) {
    throw new Error("beta/ worktree does not exist");
  }

  // 1. Run typecheck in worktree
  log("Running typecheck in worktree...");
  try {
    await execFileAsync("npx", ["tsc", "--noEmit"], {
      cwd: BETA_DIR,
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });
  } catch (err: any) {
    const output = (err.stdout || "") + "\n" + (err.stderr || "");
    throw new Error(`Typecheck failed in worktree:\n${output.slice(0, 4000)}`);
  }

  // 2. Stage and commit all changes
  await git(["add", "-A"], { cwd: BETA_DIR });

  const { stdout: diffOutput } = await git(
    ["diff", "--cached", "--name-only"],
    { cwd: BETA_DIR },
  );
  const filesChanged = diffOutput
    .split("\n")
    .filter((f) => f.length > 0);

  if (filesChanged.length === 0) {
    throw new Error("No changes to commit in worktree");
  }

  await git(
    ["commit", "-m", `feat(evolution): ${opts.summary}`],
    { cwd: BETA_DIR },
  );

  // 3. Push branch
  log(`Pushing branch ${evolution.branch}...`);
  await git(["push", "-u", "origin", evolution.branch!], { cwd: BETA_DIR });

  // 4. Create PR via gh CLI
  log("Creating PR...");
  const prBody = [
    `## Evolution: ${opts.summary}`,
    "",
    `**Triggered by:** <@${evolution.triggeredBy}>`,
    `**Reason:** ${evolution.triggerMessage}`,
    "",
    "### Changes",
    ...filesChanged.map((f) => `- \`${f}\``),
    "",
    "---",
    "*This PR was created by the Evolution Engine.*",
  ].join("\n");

  const { stdout: prOutput } = await gh([
    "pr",
    "create",
    "--base",
    "main",
    "--head",
    evolution.branch!,
    "--title",
    `feat(evolution): ${opts.summary}`,
    "--body",
    prBody,
  ]);

  // Parse PR URL and number from gh output
  const prUrl = prOutput.trim();
  const prNumberMatch = prUrl.match(/\/pull\/(\d+)/);
  const prNumber = prNumberMatch ? parseInt(prNumberMatch[1], 10) : 0;

  // 5. Update evolution record
  updateEvolution(opts.id, {
    status: "proposed",
    prUrl,
    prNumber,
    changesSummary: opts.summary,
    filesChanged,
    proposedAt: Date.now(),
  });

  // 6. Clean up worktree
  log("Cleaning up worktree...");
  await git(["worktree", "remove", "beta", "--force"]);

  // 7. Notify Discord
  if (_sendToDiscord && opts.channelId) {
    try {
      await _sendToDiscord(
        opts.channelId,
        `I've created a PR for this: ${prUrl}\n**${opts.summary}** (${filesChanged.length} files changed)`,
      );
    } catch (err) {
      log("Failed to send Discord notification:", err);
    }
  }

  log(`Evolution ${opts.id} proposed: ${prUrl}`);
  return { prUrl, prNumber };
}

/**
 * Cancel an active evolution. Cleans up worktree and branch.
 */
export async function cancelEvolution(id: string): Promise<void> {
  const evolution = getEvolution(id);
  if (!evolution) {
    throw new Error(`Evolution not found: ${id}`);
  }

  // Remove worktree if it exists
  if (existsSync(BETA_DIR)) {
    try {
      await git(["worktree", "remove", "beta", "--force"]);
    } catch {
      rmSync(BETA_DIR, { recursive: true, force: true });
    }
  }

  // Delete branch locally and remotely
  if (evolution.branch) {
    try {
      await git(["branch", "-D", evolution.branch]);
    } catch {
      // Branch may not exist locally
    }
    try {
      await git(["push", "origin", "--delete", evolution.branch]);
    } catch {
      // Branch may not exist remotely
    }
  }

  updateEvolution(id, { status: "cancelled" });
  log(`Evolution ${id} cancelled`);
}

/**
 * Record a suggestion for a potential improvement (no worktree needed).
 */
export function recordSuggestion(opts: {
  what: string;
  why: string;
  triggeredBy: string;
}): Evolution {
  const evolution = createEvolution({
    triggeredBy: opts.triggeredBy,
    triggerMessage: `${opts.what}\n\nWhy: ${opts.why}`,
    status: "idea",
  });
  log(`Suggestion recorded: ${evolution.id}`);
  return evolution;
}

/**
 * On startup, check if any proposed evolutions have been merged.
 */
export async function syncDeployedEvolutions(): Promise<number> {
  const proposed = listEvolutions({ status: "proposed" });
  let deployed = 0;

  for (const evo of proposed) {
    if (!evo.branch) continue;
    try {
      // Check if branch is merged into HEAD
      const { stdout } = await git([
        "branch",
        "--merged",
        "HEAD",
        "--list",
        evo.branch,
      ]);
      if (stdout.trim().length > 0) {
        updateEvolution(evo.id, {
          status: "deployed",
          deployedAt: Date.now(),
        });
        log(`Evolution ${evo.id} marked as deployed (branch ${evo.branch} merged)`);
        deployed++;
      }
    } catch {
      // Branch may have been deleted after merge — check if PR was merged
      if (evo.prNumber) {
        try {
          const { stdout: prState } = await gh([
            "pr",
            "view",
            String(evo.prNumber),
            "--json",
            "state",
            "-q",
            ".state",
          ]);
          if (prState.trim() === "MERGED") {
            updateEvolution(evo.id, {
              status: "deployed",
              deployedAt: Date.now(),
            });
            log(`Evolution ${evo.id} marked as deployed (PR #${evo.prNumber} merged)`);
            deployed++;
          }
        } catch {
          // gh CLI may not be available; skip
        }
      }
    }
  }

  return deployed;
}

/**
 * Get the path to the beta worktree.
 */
export function getBetaDir(): string {
  return BETA_DIR;
}

/**
 * Check if gh CLI is available.
 */
export async function checkGhCli(): Promise<boolean> {
  try {
    await execFileAsync("gh", ["auth", "status"], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/evolution/engine.ts
git commit -m "feat(evolution): add evolution engine with worktree and PR lifecycle"
```

---

### Task 4: Evolution Tools — Agent-Facing Tool Definitions

**Files:**
- Create: `src/evolution/tools.ts`

- [ ] **Step 1: Create `src/evolution/tools.ts`**

```typescript
// ---------------------------------------------------------------------------
// Evolution tools — agent-facing tools for self-modification
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  startEvolution,
  finalizeEvolution,
  cancelEvolution,
  recordSuggestion,
  getBetaDir,
  getActiveEvolution as engineGetActive,
} from "./engine.js";
import { getActiveEvolution, getEvolution } from "./log.js";

const execFileAsync = promisify(execFile);

const MAX_OUTPUT = 8192;
const BASH_TIMEOUT = 30_000;

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const evolutionTools = [
  {
    name: "evolve_start",
    description:
      "Start a new evolution session. Creates an isolated git worktree at beta/ for making source code changes. All changes will be submitted as a GitHub PR. Only one evolution can be active at a time.",
    input_schema: {
      type: "object" as const,
      properties: {
        reason: {
          type: "string",
          description: "Why this evolution is needed — what capability to add or change",
        },
      },
      required: ["reason"],
    },
  },
  {
    name: "evolve_read",
    description:
      "Read a file from the beta/ worktree during an active evolution. Use this to understand existing code before modifying it.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "File path relative to repo root (e.g. 'src/agent/agent.ts')",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "evolve_write",
    description:
      "Write a file in the beta/ worktree during an active evolution. Creates parent directories as needed. For source code changes to src/, TypeScript files, start.sh, or migrations.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "File path relative to repo root (e.g. 'src/evolution/new-feature.ts')",
        },
        content: {
          type: "string",
          description: "Content to write to the file",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "evolve_bash",
    description:
      "Execute a shell command in the beta/ worktree context during an active evolution. Use for running typecheck, inspecting state, etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute (cwd is beta/)",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default 30000, max 60000)",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "evolve_propose",
    description:
      "Finalize the current evolution: runs typecheck, commits all changes, pushes branch, and creates a GitHub PR. Fails if typecheck doesn't pass.",
    input_schema: {
      type: "object" as const,
      properties: {
        summary: {
          type: "string",
          description: "Short description for the PR title and commit message",
        },
      },
      required: ["summary"],
    },
  },
  {
    name: "evolve_suggest",
    description:
      "Record an idea for a potential improvement. Use this when you encounter a limitation you could fix by modifying your own code. Does NOT start an evolution — just records the idea for later review.",
    input_schema: {
      type: "object" as const,
      properties: {
        what: {
          type: "string",
          description: "What capability is missing or what could be improved",
        },
        why: {
          type: "string",
          description: "Context for why this improvement would be useful",
        },
      },
      required: ["what", "why"],
    },
  },
];

// ---------------------------------------------------------------------------
// Path safety for worktree
// ---------------------------------------------------------------------------

function safeWorktreePath(relativePath: string): string | null {
  const betaDir = getBetaDir();
  const resolved = path.resolve(betaDir, relativePath);
  if (!resolved.startsWith(betaDir + "/") && resolved !== betaDir) {
    return null; // Path traversal attempt
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Context for tracking the triggering channel
// ---------------------------------------------------------------------------

let _currentChannelId: string | undefined;
let _currentUserId: string | undefined;

export function setEvolutionContext(channelId?: string, userId?: string): void {
  _currentChannelId = channelId;
  _currentUserId = userId;
}

// ---------------------------------------------------------------------------
// Tool handler
// ---------------------------------------------------------------------------

export async function handleEvolutionTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  try {
    switch (name) {
      case "evolve_start": {
        const reason = input.reason as string;
        const evolution = await startEvolution({
          reason,
          triggeredBy: _currentUserId ?? "unknown",
          channelId: _currentChannelId,
        });
        return JSON.stringify({
          success: true,
          evolution_id: evolution.id,
          branch: evolution.branch,
          message: `Evolution started. Make changes using evolve_write/evolve_read/evolve_bash, then call evolve_propose to submit the PR.`,
        });
      }

      case "evolve_read": {
        const active = getActiveEvolution();
        if (!active) {
          return JSON.stringify({ error: "No active evolution. Call evolve_start first." });
        }

        const filePath = input.path as string;
        const absPath = safeWorktreePath(filePath);
        if (!absPath) {
          return JSON.stringify({ error: "Invalid path — must be within the repository" });
        }

        if (!fs.existsSync(absPath)) {
          return JSON.stringify({ error: `File not found: ${filePath}` });
        }

        const stat = fs.statSync(absPath);
        if (stat.isDirectory()) {
          return JSON.stringify({ error: `"${filePath}" is a directory` });
        }
        if (stat.size > 256 * 1024) {
          return JSON.stringify({ error: `File too large: ${stat.size} bytes (max 256KB)` });
        }

        const content = fs.readFileSync(absPath, "utf-8");
        return JSON.stringify({ path: filePath, content });
      }

      case "evolve_write": {
        const active = getActiveEvolution();
        if (!active) {
          return JSON.stringify({ error: "No active evolution. Call evolve_start first." });
        }

        const filePath = input.path as string;
        const content = input.content as string;
        const absPath = safeWorktreePath(filePath);
        if (!absPath) {
          return JSON.stringify({ error: "Invalid path — must be within the repository" });
        }

        const dir = path.dirname(absPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(absPath, content, "utf-8");
        return JSON.stringify({ success: true, path: filePath });
      }

      case "evolve_bash": {
        const active = getActiveEvolution();
        if (!active) {
          return JSON.stringify({ error: "No active evolution. Call evolve_start first." });
        }

        const command = input.command as string;
        const timeout = Math.min(
          (input.timeout as number) || BASH_TIMEOUT,
          60_000,
        );

        try {
          const { stdout, stderr } = await execFileAsync(
            "/bin/bash",
            ["-c", command],
            { cwd: getBetaDir(), timeout, maxBuffer: 1024 * 1024 },
          );

          const out = stdout.length > MAX_OUTPUT
            ? stdout.slice(0, MAX_OUTPUT) + "\n... (truncated)"
            : stdout;
          const err = stderr.length > MAX_OUTPUT
            ? stderr.slice(0, MAX_OUTPUT) + "\n... (truncated)"
            : stderr;

          return JSON.stringify({ exit_code: 0, stdout: out, stderr: err || undefined });
        } catch (execErr: any) {
          return JSON.stringify({
            exit_code: execErr.code ?? 1,
            stdout: (execErr.stdout || "").slice(0, MAX_OUTPUT),
            stderr: (execErr.stderr || execErr.message || "").slice(0, MAX_OUTPUT),
          });
        }
      }

      case "evolve_propose": {
        const active = getActiveEvolution();
        if (!active) {
          return JSON.stringify({ error: "No active evolution. Call evolve_start first." });
        }

        const summary = input.summary as string;
        const result = await finalizeEvolution({
          id: active.id,
          summary,
          channelId: _currentChannelId,
        });

        return JSON.stringify({
          success: true,
          pr_url: result.prUrl,
          pr_number: result.prNumber,
          message: `PR created: ${result.prUrl}`,
        });
      }

      case "evolve_suggest": {
        const what = input.what as string;
        const why = input.why as string;
        const evolution = recordSuggestion({
          what,
          why,
          triggeredBy: _currentUserId ?? "unknown",
        });

        return JSON.stringify({
          success: true,
          idea_id: evolution.id,
          message: "Suggestion recorded. It can be reviewed and implemented later.",
        });
      }

      default:
        return JSON.stringify({ error: `Unknown evolution tool: ${name}` });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[evolution] Tool "${name}" failed:`, msg);
    return JSON.stringify({ error: msg });
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/evolution/tools.ts
git commit -m "feat(evolution): add 6 agent-facing evolution tools"
```

---

### Task 5: Wire Evolution Tools into the Agent

**Files:**
- Modify: `src/agent/agent.ts`

- [ ] **Step 1: Add import for evolution tools**

At the top of `src/agent/agent.ts`, after the existing imports (line 6), add:

```typescript
import { evolutionTools, handleEvolutionTool, setEvolutionContext } from "../evolution/tools.js";
```

- [ ] **Step 2: Register evolution tools in allTools array**

Change the `allTools` declaration (lines 61-66) from:

```typescript
const allTools: Anthropic.Messages.Tool[] = [
  ...memoryTools,
  ...discordTools,
  ...skillTools,
  ...dangerousTools,
] as Anthropic.Messages.Tool[];
```

to:

```typescript
const allTools: Anthropic.Messages.Tool[] = [
  ...memoryTools,
  ...discordTools,
  ...skillTools,
  ...dangerousTools,
  ...evolutionTools,
] as Anthropic.Messages.Tool[];
```

- [ ] **Step 3: Add evolution instructions to system prompt**

Add a new constant after `MEMORY_RECALL_INSTRUCTIONS` (after line 55):

```typescript
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
```

Then in `buildSystemPrompt()`, add it after the memory recall instructions (after line 99):

```typescript
  // 3.5 Evolution instructions
  parts.push(EVOLUTION_INSTRUCTIONS);
```

- [ ] **Step 4: Add evolution tool dispatch to executeTool()**

In the `executeTool()` function (around line 153-178), add a new block before the final `return` statement for unknown tools:

```typescript
  // Evolution tools
  if (
    name === "evolve_start" ||
    name === "evolve_read" ||
    name === "evolve_write" ||
    name === "evolve_bash" ||
    name === "evolve_propose" ||
    name === "evolve_suggest"
  ) {
    return await handleEvolutionTool(name, input);
  }
```

- [ ] **Step 5: Set evolution context before processing a message**

In `processMessage()`, right after the system prompt is built (after line 199), add:

```typescript
  // Set evolution context so tools know who triggered and where
  setEvolutionContext(opts.context.channelName, opts.context.userId);
```

Wait — `channelName` is not the channel ID. We need the channel ID for Discord notifications. Looking at the `processMessage` opts, it doesn't include `channelId`. We need to thread this through. Actually, looking at the existing code, the context has `channelName` but not `channelId`. The session has `channelId` via `opts.sessionId` → db lookup. But let's keep it simple: the evolution tools already accept `channelId` from the Discord tool calls (the agent can use `send_message` channel_id). For now, just set the userId:

```typescript
  // Set evolution context so tools know the triggering user
  setEvolutionContext(undefined, opts.context.userId);
```

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/agent/agent.ts
git commit -m "feat(evolution): wire evolution tools into agent"
```

---

### Task 6: Gateway API Routes for Evolutions

**Files:**
- Modify: `src/gateway/api.ts`

- [ ] **Step 1: Add imports**

At the top of `src/gateway/api.ts`, add after the existing imports (around line 14):

```typescript
import {
  listEvolutions,
  getEvolution,
  getIdeas,
  updateEvolution,
} from "../evolution/log.js";
```

- [ ] **Step 2: Add evolution routes**

In `createApiRouter()`, add the following routes before the "Bot control" section (before line 519):

```typescript
  // =========================================================================
  // Evolutions
  // =========================================================================

  router.get("/evolutions", (req: Request, res: Response) => {
    try {
      const status = req.query.status as string | undefined;
      const evolutions = status
        ? listEvolutions({ status: status as any })
        : listEvolutions();
      res.json({ evolutions });
    } catch (err) {
      log("Error in GET /evolutions:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  router.get("/evolutions/:id", (req: Request, res: Response) => {
    try {
      const id = param(req, "id");
      const evolution = getEvolution(id);
      if (!evolution) {
        res.status(404).json({ error: "Evolution not found" });
        return;
      }
      res.json(evolution);
    } catch (err) {
      log("Error in GET /evolutions/:id:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  router.post("/evolutions/:id/dismiss", (req: Request, res: Response) => {
    try {
      const id = param(req, "id");
      const evolution = getEvolution(id);
      if (!evolution) {
        res.status(404).json({ error: "Evolution not found" });
        return;
      }
      if (evolution.status !== "idea") {
        res.status(400).json({ error: "Can only dismiss ideas" });
        return;
      }
      updateEvolution(id, { status: "rejected" });
      res.json({ ok: true });
    } catch (err) {
      log("Error in POST /evolutions/:id/dismiss:", err);
      res.status(500).json({ error: String(err) });
    }
  });
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/gateway/api.ts
git commit -m "feat(evolution): add evolution API routes"
```

---

### Task 7: Wire Evolution into Startup (index.ts) & Update .gitignore

**Files:**
- Modify: `src/index.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Add imports to index.ts**

At the top of `src/index.ts`, add after the existing imports (around line 14):

```typescript
import { syncDeployedEvolutions, setEvolutionSendToDiscord, checkGhCli } from "./evolution/engine.js";
import { setHealthDiscordClient, setServicesReady } from "./evolution/health.js";
```

- [ ] **Step 2: Add evolution initialization to startup**

In the `main()` function, after skills initialization (after line 72) and before cron service start, add:

```typescript
  // 3.7 Check gh CLI availability
  const ghAvailable = await checkGhCli();
  if (!ghAvailable) {
    console.warn("[discordclaw] WARNING: gh CLI not authenticated — evolution PRs will fail");
  }
```

After the Discord client is ready and cron is wired (after line 96), add:

```typescript
  // Wire evolution → Discord delivery
  setEvolutionSendToDiscord(async (channelId, text) => {
    const channel: any = await client.channels.fetch(channelId);
    if (!channel?.send) {
      console.error(`[evolution] Cannot send to channel ${channelId}`);
      return;
    }
    await channel.send(text);
  });

  // Set health check references
  setHealthDiscordClient(client);
```

After the gateway starts (after line 107), add:

```typescript
  // Mark services as ready for health check
  setServicesReady(true);

  // Sync deployed evolutions (check if any PRs were merged since last run)
  try {
    const deployed = await syncDeployedEvolutions();
    if (deployed > 0) {
      console.log(`[discordclaw] ${deployed} evolution(s) marked as deployed`);
    }
  } catch (err) {
    console.error("[discordclaw] Failed to sync evolutions:", err);
  }
```

- [ ] **Step 3: Add evolution count to startup summary**

In the startup summary section (around line 126), add after the skills line:

```typescript
  console.log(`[discordclaw] gh CLI: ${ghAvailable ? "ready" : "NOT AVAILABLE"}`);
```

- [ ] **Step 4: Update .gitignore**

Add these lines to `.gitignore`:

```
beta/
data/.migrations/
migrations/*.done
```

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/index.ts .gitignore
git commit -m "feat(evolution): wire evolution into startup sequence"
```

---

### Task 8: Startup Script & Migrations Directory

**Files:**
- Create: `start.sh`
- Create: `migrations/001-add-evolution-table.sh`

- [ ] **Step 1: Create `start.sh`**

```bash
#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Discordclaw startup script — idempotent, with auto-rollback
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Load .env if present (for DISCORD_WEBHOOK_URL)
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

PREVIOUS_HEAD=$(git rev-parse HEAD)
DISCORD_WEBHOOK_URL="${DISCORD_WEBHOOK_URL:-}"

# ---------------------------------------------------------------------------
# Notification helper (best-effort, never blocks)
# ---------------------------------------------------------------------------
notify() {
  if [ -n "$DISCORD_WEBHOOK_URL" ]; then
    curl -sf -X POST "$DISCORD_WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -d "{\"content\":\"$1\"}" > /dev/null 2>&1 || true
  fi
}

# ---------------------------------------------------------------------------
# 1. Pull latest
# ---------------------------------------------------------------------------
echo "[start] Pulling latest from origin/main..."
if ! git pull origin main; then
  notify "❌ discordclaw: git pull failed on $(hostname)"
  echo "[start] ERROR: git pull failed"
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Install deps if lockfile changed
# ---------------------------------------------------------------------------
if git diff --name-only "$PREVIOUS_HEAD" HEAD 2>/dev/null | grep -q "package-lock.json"; then
  echo "[start] package-lock.json changed, running npm ci..."
  npm ci
fi

# ---------------------------------------------------------------------------
# 3. Run migrations (idempotent — each tracks its own completion)
# ---------------------------------------------------------------------------
MIGRATION_DIR="$SCRIPT_DIR/migrations"
MARKER_DIR="$SCRIPT_DIR/data/.migrations"
mkdir -p "$MARKER_DIR"

if [ -d "$MIGRATION_DIR" ]; then
  for f in "$MIGRATION_DIR"/*.sh; do
    [ -f "$f" ] || continue
    MIGRATION_NAME=$(basename "$f" .sh)
    MARKER="$MARKER_DIR/$MIGRATION_NAME.done"

    if [ ! -f "$MARKER" ]; then
      echo "[start] Running migration: $MIGRATION_NAME..."
      if bash "$f"; then
        date -Iseconds > "$MARKER"
        echo "[start] Migration $MIGRATION_NAME completed"
      else
        notify "❌ discordclaw: migration $MIGRATION_NAME failed. Bot NOT started."
        echo "[start] ERROR: migration $MIGRATION_NAME failed"
        exit 1
      fi
    fi
  done
fi

# ---------------------------------------------------------------------------
# 4. Build
# ---------------------------------------------------------------------------
echo "[start] Building..."
npm run build

# ---------------------------------------------------------------------------
# 5. Start bot
# ---------------------------------------------------------------------------
echo "[start] Starting bot..."
tsx src/index.ts &
BOT_PID=$!

# ---------------------------------------------------------------------------
# 6. Health check (30s timeout)
# ---------------------------------------------------------------------------
HEALTHY=false
GATEWAY_PORT="${GATEWAY_PORT:-3000}"

echo "[start] Waiting for health check on port $GATEWAY_PORT..."
for i in $(seq 1 30); do
  if curl -sf "http://localhost:$GATEWAY_PORT/api/health" > /dev/null 2>&1; then
    HEALTHY=true
    break
  fi
  sleep 1
done

# ---------------------------------------------------------------------------
# 7. Result
# ---------------------------------------------------------------------------
if [ "$HEALTHY" = true ]; then
  CURRENT_COMMIT=$(git log --oneline -1)
  echo "[start] Bot is healthy! ($CURRENT_COMMIT)"
  notify "✅ discordclaw started: $CURRENT_COMMIT"
  wait $BOT_PID
else
  echo "[start] Health check FAILED — rolling back..."
  kill $BOT_PID 2>/dev/null || true
  wait $BOT_PID 2>/dev/null || true

  FAILED_COMMIT=$(git log --oneline -1)
  notify "⚠️ discordclaw health check failed after $FAILED_COMMIT. Rolling back to ${PREVIOUS_HEAD:0:7}..."

  git reset --hard "$PREVIOUS_HEAD"
  echo "[start] Rolled back to $PREVIOUS_HEAD, re-running start.sh..."
  exec bash "$0"
fi
```

- [ ] **Step 2: Make start.sh executable**

```bash
chmod +x start.sh
```

- [ ] **Step 3: Create `migrations/001-add-evolution-table.sh`**

```bash
#!/bin/bash
set -euo pipefail
# Migration: 001-add-evolution-table
# Idempotent: uses IF NOT EXISTS
# Note: The table is also created by initDb() in src/db/index.ts.
# This migration exists as a template for future bot-created migrations.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DB_PATH="$SCRIPT_DIR/../data/discordclaw.db"

sqlite3 "$DB_PATH" <<'SQL'
CREATE TABLE IF NOT EXISTS evolutions (
  id TEXT PRIMARY KEY,
  triggered_by TEXT,
  trigger_message TEXT,
  branch TEXT,
  pr_url TEXT,
  pr_number INTEGER,
  status TEXT NOT NULL DEFAULT 'idea',
  changes_summary TEXT,
  files_changed TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  proposed_at INTEGER,
  merged_at INTEGER,
  deployed_at INTEGER
);
SQL

echo "Evolution table ready."
```

- [ ] **Step 4: Make migration executable**

```bash
chmod +x migrations/001-add-evolution-table.sh
```

- [ ] **Step 5: Commit**

```bash
git add start.sh migrations/
git commit -m "feat(evolution): add idempotent startup script and migrations"
```

---

### Task 9: Dashboard UI — Evolution Page

**Files:**
- Create: `src/gateway/ui/pages/Evolution.tsx`
- Modify: `src/gateway/ui/App.tsx`

- [ ] **Step 1: Create `src/gateway/ui/pages/Evolution.tsx`**

```tsx
import React, { useState, useEffect } from "react";
import { apiFetch, relativeTime, C, S } from "../App";

interface EvolutionRecord {
  id: string;
  triggeredBy: string | null;
  triggerMessage: string | null;
  branch: string | null;
  prUrl: string | null;
  prNumber: number | null;
  status: string;
  changesSummary: string | null;
  filesChanged: string[] | null;
  createdAt: number;
  proposedAt: number | null;
  deployedAt: number | null;
}

const statusColors: Record<string, string> = {
  idea: C.warning,
  proposing: C.accent,
  proposed: "#3498db",
  deployed: C.success,
  rolled_back: C.error,
  cancelled: C.textDim,
  rejected: C.textDim,
};

export default function Evolution() {
  const [evolutions, setEvolutions] = useState<EvolutionRecord[]>([]);
  const [filter, setFilter] = useState<string>("");
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const url = filter ? `/api/evolutions?status=${filter}` : "/api/evolutions";
      const data = await apiFetch<{ evolutions: EvolutionRecord[] }>(url);
      setEvolutions(data.evolutions);
      setError("");
    } catch (err: any) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, [filter]);

  const dismiss = async (id: string) => {
    try {
      await apiFetch(`/api/evolutions/${id}/dismiss`, { method: "POST" });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const filters = ["", "idea", "proposing", "proposed", "deployed", "cancelled", "rejected"];

  return (
    <div>
      <h2 style={S.h2}>Evolution</h2>

      {error && (
        <div style={{ ...S.card, background: C.error + "22", color: C.error, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {/* Filter bar */}
      <div style={{ marginBottom: 16, display: "flex", gap: 6, flexWrap: "wrap" }}>
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              ...S.btnSmall,
              background: filter === f ? C.accent : C.primary,
            }}
          >
            {f || "All"}
          </button>
        ))}
      </div>

      {/* Stats */}
      <div style={{ ...S.card, display: "flex", gap: 24, flexWrap: "wrap" }}>
        {["idea", "proposing", "proposed", "deployed"].map((s) => {
          const count = evolutions.filter((e) => e.status === s).length;
          return (
            <div key={s} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: statusColors[s] }}>{count}</div>
              <div style={{ fontSize: 12, color: C.textDim, textTransform: "uppercase" }}>{s}</div>
            </div>
          );
        })}
      </div>

      {/* Table */}
      <div style={S.card}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Status</th>
              <th style={S.th}>Summary</th>
              <th style={S.th}>Branch</th>
              <th style={S.th}>PR</th>
              <th style={S.th}>Created</th>
              <th style={S.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {evolutions.length === 0 && (
              <tr>
                <td style={{ ...S.td, color: C.textDim }} colSpan={6}>
                  No evolutions found
                </td>
              </tr>
            )}
            {evolutions.map((evo) => (
              <tr key={evo.id}>
                <td style={S.td}>
                  <span style={S.badge(statusColors[evo.status] || C.textDim)}>
                    {evo.status}
                  </span>
                </td>
                <td style={{ ...S.td, maxWidth: 300 }}>
                  {evo.changesSummary || evo.triggerMessage?.slice(0, 80) || "—"}
                </td>
                <td style={{ ...S.td, fontFamily: "monospace", fontSize: 12 }}>
                  {evo.branch?.replace("evolve/", "") || "—"}
                </td>
                <td style={S.td}>
                  {evo.prUrl ? (
                    <a
                      href={evo.prUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "#3498db", textDecoration: "none" }}
                    >
                      #{evo.prNumber}
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td style={{ ...S.td, color: C.textDim, fontSize: 12 }}>
                  {relativeTime(evo.createdAt)}
                </td>
                <td style={S.td}>
                  {evo.status === "idea" && (
                    <button style={S.btnDanger} onClick={() => dismiss(evo.id)}>
                      Dismiss
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add Evolution page to App.tsx**

In `src/gateway/ui/App.tsx`, add the import (after line 8):

```typescript
import Evolution from "./pages/Evolution";
```

Then in the `pages` map (lines 182-190), add the evolution entry after `skills`:

```typescript
const pages: Record<string, { label: string; component: React.FC }> = {
  status: { label: "Status", component: Status },
  sessions: { label: "Sessions", component: Sessions },
  channels: { label: "Channels", component: Channels },
  config: { label: "Config", component: Config },
  cron: { label: "Cron", component: Cron },
  skills: { label: "Skills", component: Skills },
  evolution: { label: "Evolution", component: Evolution },
  logs: { label: "Logs", component: Logs },
};
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Build the UI**

Run: `npm run build:ui`
Expected: Build succeeds, outputs to `dist/ui/`

- [ ] **Step 5: Commit**

```bash
git add src/gateway/ui/pages/Evolution.tsx src/gateway/ui/App.tsx
git commit -m "feat(evolution): add evolution dashboard page"
```

---

### Task 10: Verify Complete Integration

**Files:** (none — verification only)

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: PASS with zero errors

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: PASS — TypeScript compiles and Vite builds the dashboard

- [ ] **Step 3: Verify file structure**

Run: `find src/evolution -type f | sort`

Expected output:
```
src/evolution/engine.ts
src/evolution/health.ts
src/evolution/log.ts
src/evolution/tools.ts
```

- [ ] **Step 4: Verify migration exists**

Run: `ls -la migrations/`

Expected: `001-add-evolution-table.sh` with executable permission

- [ ] **Step 5: Verify start.sh is executable**

Run: `ls -la start.sh`

Expected: `start.sh` with executable permission

- [ ] **Step 6: Verify .gitignore has new entries**

Run: `grep -E "beta/|migrations" .gitignore`

Expected: Shows `beta/` and `data/.migrations/` entries

- [ ] **Step 7: Final commit (if any fixes were needed)**

```bash
git add -A
git status
# Only commit if there are changes
git commit -m "fix(evolution): integration fixes from verification"
```
