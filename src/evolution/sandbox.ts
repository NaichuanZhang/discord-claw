// ---------------------------------------------------------------------------
// Daytona Sandbox CI — ephemeral sandbox for evolution validation
// ---------------------------------------------------------------------------
// Spins up a Daytona sandbox, clones the evolution branch, installs deps,
// runs typecheck + tests, and tears down. True isolated CI without GitHub Actions.
// ---------------------------------------------------------------------------

import { Daytona, Image } from "@daytona/sdk";
import { getConfig } from "../db/index.js";

const SANDBOX_TIMEOUT = 300; // 5 min to create sandbox
const COMMAND_TIMEOUT = 180; // 3 min per command
const REPO_URL = "https://github.com/NaichuanZhang/discord-claw.git";
const WORK_DIR = "/home/daytona/repo";

function log(...args: unknown[]): void {
  console.log("[sandbox-ci]", ...args);
}

// ---------------------------------------------------------------------------
// Sandbox image — Node 22 + git, cached by Daytona for 24h
// ---------------------------------------------------------------------------

function buildNodeImage(): Image {
  return Image.base("node:22-slim").runCommands(
    "apt-get update && apt-get install -y git python3 make g++ --no-install-recommends && rm -rf /var/lib/apt/lists/*",
    "corepack enable",
  );
}

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

export interface SandboxValidationResult {
  success: boolean;
  typecheckPassed: boolean;
  testsPassed: boolean;
  typecheckOutput: string;
  testsOutput: string;
  sandboxId?: string;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Main: run validation in a Daytona sandbox
// ---------------------------------------------------------------------------

export async function runSandboxValidation(opts: {
  branch: string;
  onLog?: (line: string) => void;
}): Promise<SandboxValidationResult> {
  const startTime = Date.now();
  const emit = opts.onLog ?? ((_: string) => {});

  // Check for required env vars
  const apiKey = process.env.DAYTONA_API_KEY;
  if (!apiKey) {
    throw new Error(
      "DAYTONA_API_KEY not set — cannot run sandbox CI. Falling back to local validation.",
    );
  }

  const apiUrl = process.env.DAYTONA_API_URL || "https://app.daytona.io/api";

  const daytona = new Daytona({ apiKey, apiUrl });
  let sandboxId: string | undefined;

  try {
    // 1. Create sandbox with Node.js image
    emit("🏗️ Creating Daytona sandbox...");
    log("Creating sandbox with Node 22 image...");

    const image = buildNodeImage();
    const sandbox = await daytona.create(
      { image },
      {
        timeout: SANDBOX_TIMEOUT,
        onSnapshotCreateLogs: (chunk: string) => {
          const trimmed = chunk.trim();
          if (trimmed) log(`[snapshot] ${trimmed}`);
        },
      },
    );
    sandboxId = sandbox.id;
    emit(`✅ Sandbox created: \`${sandboxId}\``);
    log(`Sandbox created: ${sandboxId}`);

    // 2. Clone the repo at the specific branch
    emit(`📥 Cloning branch \`${opts.branch}\`...`);
    log(`Cloning ${REPO_URL} branch ${opts.branch}...`);

    const cloneResult = await sandbox.process.executeCommand(
      `git clone --depth 1 --branch "${opts.branch}" "${REPO_URL}" "${WORK_DIR}"`,
      undefined,
      undefined,
      COMMAND_TIMEOUT,
    );
    if (cloneResult.exitCode !== 0) {
      throw new Error(
        `Git clone failed (exit ${cloneResult.exitCode}): ${cloneResult.result}`,
      );
    }
    emit("✅ Repo cloned");

    // 3. Install dependencies
    emit("📦 Installing dependencies...");
    log("Running npm ci...");

    const installResult = await sandbox.process.executeCommand(
      "npm ci --ignore-scripts",
      WORK_DIR,
      undefined,
      COMMAND_TIMEOUT,
    );
    if (installResult.exitCode !== 0) {
      throw new Error(
        `npm ci failed (exit ${installResult.exitCode}): ${installResult.result}`,
      );
    }
    emit("✅ Dependencies installed");

    // Run node-gyp rebuild for native deps that need it
    const rebuildResult = await sandbox.process.executeCommand(
      "npm rebuild 2>&1 || true",
      WORK_DIR,
      undefined,
      COMMAND_TIMEOUT,
    );
    log(`npm rebuild: exit ${rebuildResult.exitCode}`);

    // 4. Run typecheck
    emit("🔍 Running typecheck...");
    log("Running npx tsc --noEmit...");

    const typecheckResult = await sandbox.process.executeCommand(
      "npx tsc --noEmit 2>&1",
      WORK_DIR,
      undefined,
      COMMAND_TIMEOUT,
    );
    const typecheckPassed = typecheckResult.exitCode === 0;
    const typecheckOutput = typecheckResult.result || "";

    if (typecheckPassed) {
      emit("✅ Typecheck passed");
    } else {
      emit("❌ Typecheck failed");
    }
    log(
      `Typecheck: ${typecheckPassed ? "PASSED" : "FAILED"} (exit ${typecheckResult.exitCode})`,
    );

    // 5. Run tests
    emit("🧪 Running tests...");
    log("Running npx vitest run...");

    const testsResult = await sandbox.process.executeCommand(
      "npx vitest run 2>&1",
      WORK_DIR,
      undefined,
      COMMAND_TIMEOUT,
    );
    const testsPassed = testsResult.exitCode === 0;
    const testsOutput = testsResult.result || "";

    if (testsPassed) {
      emit("✅ Tests passed");
    } else {
      emit("❌ Tests failed");
    }
    log(
      `Tests: ${testsPassed ? "PASSED" : "FAILED"} (exit ${testsResult.exitCode})`,
    );

    const durationMs = Date.now() - startTime;
    const success = typecheckPassed && testsPassed;

    emit(
      success
        ? `🎉 All checks passed in ${Math.round(durationMs / 1000)}s`
        : `💥 Validation failed after ${Math.round(durationMs / 1000)}s`,
    );

    return {
      success,
      typecheckPassed,
      testsPassed,
      typecheckOutput: typecheckOutput.slice(0, 4000),
      testsOutput: testsOutput.slice(0, 4000),
      sandboxId,
      durationMs,
    };
  } finally {
    // Always clean up the sandbox
    if (sandboxId) {
      try {
        emit("🧹 Cleaning up sandbox...");
        log(`Deleting sandbox ${sandboxId}...`);
        const sbx = await daytona.get(sandboxId);
        await daytona.delete(sbx);
        log(`Sandbox ${sandboxId} deleted`);
      } catch (err) {
        log(`Failed to delete sandbox ${sandboxId}:`, err);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Check if Daytona sandbox CI is available and enabled
// ---------------------------------------------------------------------------

/**
 * Returns true if sandbox CI should be used for evolution validation.
 * Requires both:
 *   1. DAYTONA_API_KEY env var is set (credentials available)
 *   2. The "sandbox_ci_enabled" config flag is set to "true" in the DB
 *      (defaults to "true" if not explicitly set — opt-out model)
 */
export function isSandboxCIAvailable(): boolean {
  if (!process.env.DAYTONA_API_KEY) return false;
  const enabled = getConfig("sandbox_ci_enabled");
  // Default to enabled if the key has not been set yet
  return enabled !== "false";
}

/**
 * Returns the sandbox CI configuration status for the UI.
 */
export function getSandboxCIStatus(): {
  enabled: boolean;
  apiKeyConfigured: boolean;
  apiUrl: string;
} {
  const apiKeyConfigured = !!process.env.DAYTONA_API_KEY;
  const enabledFlag = getConfig("sandbox_ci_enabled");
  // Default to enabled when not explicitly set
  const enabled = apiKeyConfigured && enabledFlag !== "false";
  const apiUrl = process.env.DAYTONA_API_URL || "https://app.daytona.io/api";

  return { enabled, apiKeyConfigured, apiUrl };
}
