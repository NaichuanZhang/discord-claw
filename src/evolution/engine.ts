// ---------------------------------------------------------------------------
// Evolution Engine — worktree lifecycle, git operations, PR creation
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, symlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_ROOT, BETA_DIR } from "../shared/paths.js";
import { triggerRestart } from "../restart.js";
import {
  createEvolution,
  getActiveEvolution,
  getEvolution,
  listEvolutions,
  updateEvolution,
  type Evolution,
} from "./log.js";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT = 30_000;
const GH_TIMEOUT = 30_000;

/** Max retries for transient merge states (e.g. CI still running) */
const MERGE_CHECK_MAX_RETRIES = 5;
/** Delay between merge-readiness retries (10 seconds) */
const MERGE_CHECK_RETRY_DELAY_MS = 10_000;

// Channel where deployment notifications are posted as threads
const DEPLOY_NOTIFY_CHANNEL_ID = "1493291137908216080";

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

export async function gh(
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
// Discord notification callbacks
// ---------------------------------------------------------------------------

let _sendToDiscord: ((channelId: string, text: string) => Promise<void>) | null =
  null;

let _createDiscordThread:
  | ((channelId: string, name: string, message: string) => Promise<void>)
  | null = null;

export function setEvolutionSendToDiscord(
  fn: (channelId: string, text: string) => Promise<void>,
): void {
  _sendToDiscord = fn;
}

export function setEvolutionCreateThread(
  fn: (channelId: string, name: string, message: string) => Promise<void>,
): void {
  _createDiscordThread = fn;
}

// ---------------------------------------------------------------------------
// Merge readiness check
// ---------------------------------------------------------------------------

interface MergeReadiness {
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN" | string;
  mergeStateStatus: "CLEAN" | "BLOCKED" | "BEHIND" | "DIRTY" | "HAS_HOOKS" | "UNKNOWN" | "UNSTABLE" | string;
  state: "OPEN" | "CLOSED" | "MERGED" | string;
}

/**
 * Check if a PR is ready to merge. Returns the merge state or throws
 * a descriptive error for permanent failures (conflicts, closed, etc.).
 * For transient states (CI pending), retries with backoff.
 */
async function waitForMergeReady(prNumber: number): Promise<void> {
  for (let attempt = 1; attempt <= MERGE_CHECK_MAX_RETRIES; attempt++) {
    log(`Checking mergeability for PR #${prNumber} (attempt ${attempt}/${MERGE_CHECK_MAX_RETRIES})...`);

    const { stdout } = await gh([
      "pr",
      "view",
      String(prNumber),
      "--json",
      "mergeable,mergeStateStatus,state",
    ]);

    let status: MergeReadiness;
    try {
      status = JSON.parse(stdout) as MergeReadiness;
    } catch {
      log(`Failed to parse PR status JSON: ${stdout.slice(0, 200)}`);
      throw new Error(`Could not parse PR #${prNumber} merge status`);
    }

    log(`PR #${prNumber} status: state=${status.state}, mergeable=${status.mergeable}, mergeState=${status.mergeStateStatus}`);

    // PR already merged or closed — permanent states
    if (status.state === "MERGED") {
      throw new Error(`PR #${prNumber} has already been merged.`);
    }
    if (status.state === "CLOSED") {
      throw new Error(`PR #${prNumber} is closed. Reopen it first.`);
    }

    // Merge conflicts — permanent, needs manual resolution
    if (status.mergeable === "CONFLICTING") {
      throw new Error(
        `PR #${prNumber} has merge conflicts. Resolve the conflicts and try again.`,
      );
    }

    // Clean and mergeable — good to go!
    if (status.mergeable === "MERGEABLE" && status.mergeStateStatus === "CLEAN") {
      log(`PR #${prNumber} is ready to merge`);
      return;
    }

    // BEHIND means branch is out of date with base — we can still merge with squash
    if (status.mergeable === "MERGEABLE" && status.mergeStateStatus === "BEHIND") {
      log(`PR #${prNumber} is behind base branch but mergeable — proceeding`);
      return;
    }

    // HAS_HOOKS means pre-merge hooks exist but it's mergeable
    if (status.mergeable === "MERGEABLE" && status.mergeStateStatus === "HAS_HOOKS") {
      log(`PR #${prNumber} has merge hooks but is mergeable — proceeding`);
      return;
    }

    // UNSTABLE means some checks failed but it's technically mergeable
    if (status.mergeable === "MERGEABLE" && status.mergeStateStatus === "UNSTABLE") {
      log(`PR #${prNumber} has failing checks but is mergeable — proceeding with caution`);
      return;
    }

    // BLOCKED typically means CI is still running or required reviews pending
    // UNKNOWN means GitHub hasn't computed mergeability yet
    // These are transient — retry
    const isTransient =
      status.mergeStateStatus === "BLOCKED" ||
      status.mergeable === "UNKNOWN" ||
      status.mergeStateStatus === "UNKNOWN";

    if (isTransient && attempt < MERGE_CHECK_MAX_RETRIES) {
      log(`PR #${prNumber} not yet mergeable (transient state) — retrying in ${MERGE_CHECK_RETRY_DELAY_MS / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, MERGE_CHECK_RETRY_DELAY_MS));
      continue;
    }

    // Exhausted retries or unexpected state
    if (status.mergeStateStatus === "BLOCKED") {
      throw new Error(
        `PR #${prNumber} is blocked from merging. This usually means required status checks haven't passed or required reviews are missing. Check the PR on GitHub for details.`,
      );
    }

    throw new Error(
      `PR #${prNumber} is not mergeable (mergeable=${status.mergeable}, mergeState=${status.mergeStateStatus}). Check the PR on GitHub for details.`,
    );
  }
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
  if (
    worktreeNodeModules !== mainNodeModules &&
    !existsSync(worktreeNodeModules) &&
    existsSync(mainNodeModules)
  ) {
    symlinkSync(mainNodeModules, worktreeNodeModules);
  }

  log(`Evolution ${evolution.id} started on ${branch}`);
  return evolution;
}

/**
 * Finalize an evolution: typecheck, run tests, commit, push, create PR.
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

  // 2. Run integration tests in worktree
  log("Running integration tests in worktree...");
  try {
    await execFileAsync("npx", ["vitest", "run"], {
      cwd: BETA_DIR,
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    });
  } catch (err: any) {
    const output = (err.stdout || "") + "\n" + (err.stderr || "");
    throw new Error(`Integration tests failed in worktree:\n${output.slice(0, 4000)}`);
  }

  // 3. Stage and commit all changes
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

  // 4. Push branch
  log(`Pushing branch ${evolution.branch}...`);
  await git(["push", "-u", "origin", evolution.branch!], { cwd: BETA_DIR });

  // 5. Create PR via gh CLI
  log("Creating PR...");
  const migrationFiles = filesChanged.filter((f) => f.startsWith("migrations/"));
  const prBody = [
    `## Evolution: ${opts.summary}`,
    "",
    `**Triggered by:** <@${evolution.triggeredBy}>`,
    `**Reason:** ${evolution.triggerMessage}`,
    "",
    "### Changes",
    ...filesChanged.map((f) => `- \`${f}\``),
    "",
    "### Migrations",
    migrationFiles.length > 0
      ? migrationFiles.map((f) => `- \`${f}\``).join("\n")
      : "None",
    "",
    "### Quality Gates",
    "- ✅ TypeScript typecheck passed",
    "- ✅ Integration tests passed",
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

  // 6. Update evolution record
  updateEvolution(opts.id, {
    status: "proposed",
    prUrl,
    prNumber,
    changesSummary: opts.summary,
    filesChanged,
    proposedAt: Date.now(),
  });

  // 7. Clean up worktree
  log("Cleaning up worktree...");
  await git(["worktree", "remove", "beta", "--force"]);

  // 8. Notify Discord
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
 * Merge a proposed evolution PR and trigger a restart to deploy it.
 * Checks PR mergeability first and retries for transient states (CI pending).
 */
export async function mergeEvolution(opts: {
  id: string;
  channelId?: string;
}): Promise<void> {
  const evolution = getEvolution(opts.id);
  if (!evolution) {
    throw new Error(`Evolution not found: ${opts.id}`);
  }
  if (evolution.status !== "proposed") {
    throw new Error(`Evolution ${opts.id} is not in "proposed" status (current: ${evolution.status})`);
  }
  if (!evolution.prNumber) {
    throw new Error(`Evolution ${opts.id} has no PR number`);
  }

  // Pre-check: wait for PR to be in a mergeable state
  await waitForMergeReady(evolution.prNumber);

  log(`Merging PR #${evolution.prNumber} for evolution ${opts.id}...`);
  await gh(["pr", "merge", String(evolution.prNumber), "--squash", "--delete-branch"]);

  updateEvolution(opts.id, {
    status: "deployed",
    deployedAt: Date.now(),
  });

  log(`Evolution ${opts.id} merged — triggering restart`);

  if (_sendToDiscord && opts.channelId) {
    try {
      await _sendToDiscord(
        opts.channelId,
        `PR #${evolution.prNumber} merged. Restarting to deploy...`,
      );
    } catch (err) {
      log("Failed to send Discord notification:", err);
    }
  }

  // Post deployment notification as a thread in the deploy channel
  if (_createDiscordThread) {
    try {
      const summary = evolution.changesSummary || `PR #${evolution.prNumber}`;
      const threadName = summary.slice(0, 100);
      const filesChanged = evolution.filesChanged ?? [];
      const threadBody = [
        `✅ **Deployed** — PR #${evolution.prNumber}`,
        "",
        `**Summary:** ${summary}`,
        `**Triggered by:** <@${evolution.triggeredBy}>`,
        `**Files changed:** ${filesChanged.length}`,
        ...(filesChanged.length > 0
          ? ["", ...filesChanged.map((f) => `- \`${f}\``)]
          : []),
        "",
        evolution.prUrl ? `🔗 ${evolution.prUrl}` : "",
      ]
        .filter((line) => line !== undefined)
        .join("\n");

      await _createDiscordThread(
        DEPLOY_NOTIFY_CHANNEL_ID,
        threadName,
        threadBody,
      );
      log(`Deployment thread created in ${DEPLOY_NOTIFY_CHANNEL_ID}`);
    } catch (err) {
      log("Failed to create deployment notification thread:", err);
    }
  }

  triggerRestart();
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
