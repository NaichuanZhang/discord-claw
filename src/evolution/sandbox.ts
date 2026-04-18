// ---------------------------------------------------------------------------
// Evolution Sandbox — Daytona cloud sandbox lifecycle for isolated evolution
// ---------------------------------------------------------------------------
//
// When evolution.sandbox config is set to "daytona", evolutions run inside
// ephemeral Daytona sandboxes instead of local git worktrees. This provides
// true CI isolation: typecheck, tests, and boot verification all run in the
// sandbox before the branch is pushed and a PR is created.
// ---------------------------------------------------------------------------

import { Daytona, type Sandbox, type CreateSandboxFromImageParams } from "@daytona/sdk";
import { getConfig } from "../db/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SandboxSession {
  sandboxId: string;
  sandbox: Sandbox;
  repoDir: string; // working directory inside the sandbox (e.g. /home/daytona/discord-claw)
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(...args: unknown[]): void {
  console.log("[sandbox]", ...args);
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _activeSandbox: SandboxSession | null = null;
let _daytonaClient: Daytona | null = null;

// ---------------------------------------------------------------------------
// Client management
// ---------------------------------------------------------------------------

function getDaytonaClient(): Daytona {
  if (_daytonaClient) return _daytonaClient;

  const apiKey = process.env.DAYTONA_API_KEY;
  const apiUrl = process.env.DAYTONA_API_URL || "https://app.daytona.io/api";

  if (!apiKey) {
    throw new Error(
      "DAYTONA_API_KEY not set. Add it to .env to use sandbox-based evolution.",
    );
  }

  _daytonaClient = new Daytona({ apiKey, apiUrl });
  return _daytonaClient;
}

// ---------------------------------------------------------------------------
// Configuration check
// ---------------------------------------------------------------------------

/**
 * Returns true if the evolution engine should use Daytona sandboxes
 * instead of local worktrees.
 */
export function isSandboxMode(): boolean {
  const mode = getConfig("evolution.sandbox");
  return mode === "daytona";
}

/**
 * Returns the current evolution mode as a string.
 */
export function getEvolutionMode(): "local" | "daytona" {
  return isSandboxMode() ? "daytona" : "local";
}

// ---------------------------------------------------------------------------
// Sandbox lifecycle
// ---------------------------------------------------------------------------

/**
 * Create an ephemeral Daytona sandbox, clone the repo, checkout a new branch,
 * and install dependencies.
 */
export async function createSandbox(opts: {
  branch: string;
}): Promise<SandboxSession> {
  if (_activeSandbox) {
    throw new Error(
      `Sandbox already active: ${_activeSandbox.sandboxId}. Destroy it first.`,
    );
  }

  const daytona = getDaytonaClient();

  // Get GitHub token for cloning
  const ghToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

  log(`Creating Daytona sandbox for branch ${opts.branch}...`);

  const params: CreateSandboxFromImageParams = {
    image: "node:20-bookworm",
    language: "typescript",
    resources: {
      cpu: 2,
      memory: 4,
      disk: 10,
    },
    envVars: {
      ...(ghToken ? { GH_TOKEN: ghToken } : {}),
      NODE_ENV: "development",
    },
    autoStopInterval: 15, // 15 min auto-stop
    ephemeral: true, // auto-delete when stopped
    labels: {
      purpose: "evolution",
      branch: opts.branch,
    },
  };

  const sandbox = await daytona.create(params, { timeout: 120 });
  const sandboxId = sandbox.id;
  log(`Sandbox created: ${sandboxId}`);

  // Determine working directory
  const homeDir = (await sandbox.getUserHomeDir()) || "/home/daytona";
  const repoDir = `${homeDir}/discord-claw`;

  // Install git and gh CLI
  log("Installing git and gh CLI in sandbox...");
  await sandboxExecRaw(sandbox, "apt-get update -qq && apt-get install -y -qq git gh 2>/dev/null || true", homeDir);

  // Clone the repo
  log("Cloning repository...");
  const repoUrl = ghToken
    ? `https://x-access-token:${ghToken}@github.com/NaichuanZhang/discord-claw.git`
    : "https://github.com/NaichuanZhang/discord-claw.git";

  await sandboxExecRaw(sandbox, `git clone --depth=50 ${repoUrl} ${repoDir}`, homeDir);

  // Create and checkout branch
  log(`Creating branch ${opts.branch}...`);
  await sandboxExecRaw(sandbox, `git checkout -b ${opts.branch}`, repoDir);

  // Configure git user
  await sandboxExecRaw(sandbox, 'git config user.email "bot@discordclaw.dev"', repoDir);
  await sandboxExecRaw(sandbox, 'git config user.name "discordclaw[bot]"', repoDir);

  // Install dependencies
  log("Installing npm dependencies...");
  await sandboxExecRaw(sandbox, "npm ci --prefer-offline 2>&1 || npm install 2>&1", repoDir, 180);

  _activeSandbox = { sandboxId, sandbox, repoDir };
  log(`Sandbox ${sandboxId} ready at ${repoDir}`);
  return _activeSandbox;
}

/**
 * Execute a command in the active sandbox.
 */
export async function sandboxExec(
  command: string,
  opts?: { timeout?: number },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  if (!_activeSandbox) {
    throw new Error("No active sandbox. Create one first.");
  }

  return sandboxExecRaw(
    _activeSandbox.sandbox,
    command,
    _activeSandbox.repoDir,
    opts?.timeout,
  );
}

/**
 * Internal: execute a command in a specific sandbox.
 */
async function sandboxExecRaw(
  sandbox: Sandbox,
  command: string,
  cwd: string,
  timeoutSec?: number,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const fullCmd = `cd ${cwd} && ${command}`;
  const timeout = timeoutSec ?? 60;

  try {
    const response = await sandbox.process.executeCommand(fullCmd, cwd, undefined, timeout);
    return {
      exitCode: response.exitCode ?? 0,
      stdout: response.result ?? "",
      stderr: "",
    };
  } catch (err: any) {
    // The SDK may throw on non-zero exit codes
    const message = err.message || String(err);
    return {
      exitCode: err.exitCode ?? 1,
      stdout: err.result ?? "",
      stderr: message,
    };
  }
}

/**
 * Read a file from the active sandbox.
 */
export async function sandboxReadFile(relativePath: string): Promise<string> {
  if (!_activeSandbox) {
    throw new Error("No active sandbox.");
  }

  const fullPath = `${_activeSandbox.repoDir}/${relativePath}`;
  const buffer = await _activeSandbox.sandbox.fs.downloadFile(fullPath);
  return buffer.toString("utf-8");
}

/**
 * Write a file in the active sandbox.
 */
export async function sandboxWriteFile(
  relativePath: string,
  content: string,
): Promise<void> {
  if (!_activeSandbox) {
    throw new Error("No active sandbox.");
  }

  const fullPath = `${_activeSandbox.repoDir}/${relativePath}`;

  // Ensure parent directory exists
  const parentDir = fullPath.substring(0, fullPath.lastIndexOf("/"));
  if (parentDir) {
    await sandboxExecRaw(
      _activeSandbox.sandbox,
      `mkdir -p ${parentDir}`,
      _activeSandbox.repoDir,
    );
  }

  await _activeSandbox.sandbox.fs.uploadFile(
    Buffer.from(content, "utf-8"),
    fullPath,
  );
}

/**
 * Run quality gates (typecheck + tests) in the sandbox.
 * Returns a summary object.
 */
export async function sandboxRunQualityGates(): Promise<{
  typecheck: { passed: boolean; output: string };
  tests: { passed: boolean; output: string };
}> {
  if (!_activeSandbox) {
    throw new Error("No active sandbox.");
  }

  // Typecheck
  log("Running typecheck in sandbox...");
  const tc = await sandboxExec("npx tsc --noEmit 2>&1", { timeout: 120 });
  const typecheckPassed = tc.exitCode === 0;
  log(`Typecheck ${typecheckPassed ? "passed" : "FAILED"}`);

  // Tests
  log("Running tests in sandbox...");
  const tests = await sandboxExec("npx vitest run 2>&1", { timeout: 180 });
  const testsPassed = tests.exitCode === 0;
  log(`Tests ${testsPassed ? "passed" : "FAILED"}`);

  return {
    typecheck: {
      passed: typecheckPassed,
      output: (tc.stdout + "\n" + tc.stderr).trim(),
    },
    tests: {
      passed: testsPassed,
      output: (tests.stdout + "\n" + tests.stderr).trim(),
    },
  };
}

/**
 * Commit all changes, push the branch, and return the list of changed files.
 * This runs inside the sandbox's git.
 */
export async function sandboxCommitAndPush(opts: {
  branch: string;
  summary: string;
}): Promise<{ filesChanged: string[] }> {
  if (!_activeSandbox) {
    throw new Error("No active sandbox.");
  }

  // Stage all changes
  await sandboxExec("git add -A");

  // Get list of changed files
  const diff = await sandboxExec("git diff --cached --name-only");
  const filesChanged = diff.stdout
    .split("\n")
    .filter((f) => f.trim().length > 0);

  if (filesChanged.length === 0) {
    throw new Error("No changes to commit in sandbox");
  }

  // Commit
  const commitMsg = `feat(evolution): ${opts.summary}`;
  await sandboxExec(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`);

  // Push
  log(`Pushing branch ${opts.branch} from sandbox...`);
  const pushResult = await sandboxExec(
    `git push -u origin ${opts.branch} 2>&1`,
    { timeout: 60 },
  );

  if (pushResult.exitCode !== 0) {
    throw new Error(
      `Failed to push branch: ${pushResult.stdout}\n${pushResult.stderr}`,
    );
  }

  return { filesChanged };
}

/**
 * Destroy the active sandbox.
 */
export async function destroySandbox(): Promise<void> {
  if (!_activeSandbox) {
    log("No active sandbox to destroy");
    return;
  }

  const sandboxId = _activeSandbox.sandboxId;
  log(`Destroying sandbox ${sandboxId}...`);

  try {
    const daytona = getDaytonaClient();
    await daytona.delete(_activeSandbox.sandbox);
    log(`Sandbox ${sandboxId} destroyed`);
  } catch (err) {
    log(`Warning: failed to destroy sandbox ${sandboxId}:`, err);
    // Non-fatal — ephemeral sandboxes auto-delete
  }

  _activeSandbox = null;
}

/**
 * Get the active sandbox session, if any.
 */
export function getActiveSandbox(): SandboxSession | null {
  return _activeSandbox;
}

/**
 * Check if there's an active sandbox.
 */
export function hasSandbox(): boolean {
  return _activeSandbox !== null;
}
