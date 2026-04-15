#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// Discordclaw Watchdog Daemon
//
// Manages the bot process lifecycle: spawning, health monitoring, crash
// recovery (with evolution rollback), and Discord crash notifications.
//
// ZERO imports from the main bot codebase — a broken evolution can't break
// the daemon.
// ---------------------------------------------------------------------------

import { spawn, execSync, type ChildProcess } from "node:child_process";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { writeFileSync, unlinkSync, existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

const EXIT_GRACEFUL = 0;
const EXIT_DEPLOY_RESTART = 100;

const HEALTH_GRACE_MS = 30_000; // Wait before first health check
const HEALTH_INTERVAL_MS = 60_000; // Check every 60s
const HEALTH_MAX_FAILURES = 3; // Kill after 3 consecutive failures
const HEALTH_TIMEOUT_MS = 5_000; // Per-request timeout

const LOG_BUFFER_SIZE = 100; // Rolling buffer line count
const CRASH_WINDOW_MS = 5 * 60_000; // 5 min sliding window for backoff
const BACKOFF_DELAYS = [0, 10_000, 30_000, 60_000]; // Escalating delays (ms)
const MAX_RAPID_CRASHES = 5; // Enter cooldown after this many
const COOLDOWN_MS = 5 * 60_000; // 5 min cooldown
const STABLE_RESET_MS = 5 * 60_000; // Reset crash counter after 5 min stable

const EVOLUTION_COMMIT_PATTERN = /^[a-f0-9]+ feat\(evolution\):/;
const EVOLUTION_RECENCY_MS = 30 * 60_000; // 30 min

const PID_FILE = resolve(ROOT, "data/daemon.pid");

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

function loadEnv(): void {
  const envPath = resolve(ROOT, ".env");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq);
    let val = trimmed.slice(eq + 1);
    // Strip surrounding quotes
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

loadEnv();

const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT || "3000", 10);
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let botProcess: ChildProcess | null = null;
let logBuffer: string[] = [];
let healthTimer: ReturnType<typeof setInterval> | null = null;
let healthFailures = 0;
let botHealthy = false;
let botStartedAt = 0;
let stableTimer: ReturnType<typeof setTimeout> | null = null;
let shuttingDown = false;

// Crash tracking for backoff
const crashTimestamps: number[] = [];

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg: string): void {
  console.log(`[daemon] ${msg}`);
}

function logError(msg: string): void {
  console.error(`[daemon] ${msg}`);
}

// ---------------------------------------------------------------------------
// Discord Webhook
// ---------------------------------------------------------------------------

function notifyDiscord(message: string): void {
  if (!WEBHOOK_URL) return;

  try {
    const url = new URL(WEBHOOK_URL);
    const payload = JSON.stringify({ content: message });

    const req = httpsRequest(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      () => {},
    );
    req.on("error", () => {}); // Best-effort, never crash
    req.write(payload);
    req.end();
  } catch {
    // Silently ignore webhook errors
  }
}

// ---------------------------------------------------------------------------
// Log Buffer
// ---------------------------------------------------------------------------

function appendToBuffer(line: string): void {
  logBuffer.push(line);
  if (logBuffer.length > LOG_BUFFER_SIZE) {
    logBuffer = logBuffer.slice(-LOG_BUFFER_SIZE);
  }
}

function getBufferTail(n: number): string {
  return logBuffer.slice(-n).join("\n");
}

// ---------------------------------------------------------------------------
// Health Check
// ---------------------------------------------------------------------------

function checkHealth(): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), HEALTH_TIMEOUT_MS);

    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        port: GATEWAY_PORT,
        path: "/api/health",
        method: "GET",
        timeout: HEALTH_TIMEOUT_MS,
      },
      (res) => {
        clearTimeout(timeout);
        resolve(res.statusCode === 200);
        res.resume(); // Drain response
      },
    );

    req.on("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });
    req.on("timeout", () => {
      req.destroy();
      clearTimeout(timeout);
      resolve(false);
    });
    req.end();
  });
}

function startHealthMonitor(): void {
  stopHealthMonitor();

  // Grace period before first check
  setTimeout(() => {
    healthTimer = setInterval(async () => {
      if (shuttingDown || !botProcess) return;

      const healthy = await checkHealth();

      if (healthy) {
        if (healthFailures > 0) {
          log(`Health restored (was failing for ${healthFailures} checks)`);
        }
        healthFailures = 0;
        if (!botHealthy) {
          botHealthy = true;
          log("Bot is healthy");
        }
      } else {
        healthFailures++;
        log(`Health check failed (${healthFailures}/${HEALTH_MAX_FAILURES})`);

        if (healthFailures >= HEALTH_MAX_FAILURES) {
          logError(
            "Health check failed too many times — killing bot for restart",
          );
          healthFailures = 0;
          botHealthy = false;
          killBot("SIGKILL");
          // The exit handler will trigger restart
        }
      }
    }, HEALTH_INTERVAL_MS);
  }, HEALTH_GRACE_MS);
}

function stopHealthMonitor(): void {
  if (healthTimer) {
    clearInterval(healthTimer);
    healthTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Evolution Crash Detection
// ---------------------------------------------------------------------------

function isEvolutionRelatedCrash(): {
  isEvolution: boolean;
  commitMessage: string;
} {
  try {
    // Get the most recent commit
    const logOutput = execSync("git log -1 --format=%H%n%ct%n%s", {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();

    const [_hash, timestampStr, subject] = logOutput.split("\n");
    const commitTime = parseInt(timestampStr, 10) * 1000;
    const age = Date.now() - commitTime;

    const fullLine = `x ${subject}`; // Prefix to match the pattern
    const isRecent = age < EVOLUTION_RECENCY_MS;
    const isEvolutionCommit = EVOLUTION_COMMIT_PATTERN.test(fullLine);

    return {
      isEvolution: isRecent && isEvolutionCommit,
      commitMessage: subject,
    };
  } catch {
    return { isEvolution: false, commitMessage: "" };
  }
}

function rollbackEvolution(commitMessage: string): boolean {
  try {
    log(`Rolling back evolution: ${commitMessage}`);

    // Revert the HEAD commit (creates a revert commit for traceability)
    execSync("git revert HEAD --no-edit", {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 30_000,
    });

    // Rebuild
    log("Rebuilding after rollback...");
    execSync("npm run build", {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 120_000,
      stdio: "inherit",
    });

    log("Rollback and rebuild complete");
    return true;
  } catch (err) {
    logError(`Rollback failed: ${err}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Deploy Pipeline
// ---------------------------------------------------------------------------

function runDeploy(): boolean {
  try {
    log("Running deployment pipeline...");
    execSync("bash deploy.sh", {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 300_000, // 5 min timeout
      stdio: "inherit",
    });
    log("Deployment complete");
    return true;
  } catch (err) {
    logError(`Deployment failed: ${err}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Crash Backoff
// ---------------------------------------------------------------------------

function getBackoffDelay(): number {
  const now = Date.now();
  // Prune old timestamps
  while (crashTimestamps.length > 0 && now - crashTimestamps[0] > CRASH_WINDOW_MS) {
    crashTimestamps.shift();
  }

  const count = crashTimestamps.length;

  if (count >= MAX_RAPID_CRASHES) {
    return COOLDOWN_MS;
  }

  return BACKOFF_DELAYS[Math.min(count, BACKOFF_DELAYS.length - 1)];
}

function recordCrash(): void {
  crashTimestamps.push(Date.now());
}

function resetCrashCounter(): void {
  crashTimestamps.length = 0;
}

function startStableTimer(): void {
  clearStableTimer();
  stableTimer = setTimeout(() => {
    if (crashTimestamps.length > 0) {
      log("Bot stable for 5 minutes — resetting crash counter");
      resetCrashCounter();
    }
  }, STABLE_RESET_MS);
}

function clearStableTimer(): void {
  if (stableTimer) {
    clearTimeout(stableTimer);
    stableTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Uptime Formatting
// ---------------------------------------------------------------------------

function formatUptime(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hrs = Math.floor(min / 60);

  if (hrs > 0) return `${hrs}h ${min % 60}m`;
  if (min > 0) return `${min}m ${sec % 60}s`;
  return `${sec}s`;
}

// ---------------------------------------------------------------------------
// Bot Process Management
// ---------------------------------------------------------------------------

function spawnBot(): void {
  if (botProcess) {
    logError("Attempted to spawn bot while one is already running");
    return;
  }

  log("Spawning bot...");
  logBuffer = [];
  healthFailures = 0;
  botHealthy = false;
  botStartedAt = Date.now();

  const child = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  botProcess = child;

  child.stdout?.on("data", (data: Buffer) => {
    const text = data.toString();
    process.stdout.write(text); // Forward to daemon stdout
    for (const line of text.split("\n").filter(Boolean)) {
      appendToBuffer(line);
    }
  });

  child.stderr?.on("data", (data: Buffer) => {
    const text = data.toString();
    process.stderr.write(text); // Forward to daemon stderr
    for (const line of text.split("\n").filter(Boolean)) {
      appendToBuffer(`[stderr] ${line}`);
    }
  });

  child.on("exit", (code, signal) => {
    const uptime = Date.now() - botStartedAt;
    botProcess = null;
    stopHealthMonitor();
    clearStableTimer();

    if (shuttingDown) {
      log(`Bot exited (code=${code}, signal=${signal}) — daemon shutting down`);
      return;
    }

    log(
      `Bot exited (code=${code}, signal=${signal}, uptime=${formatUptime(uptime)})`,
    );

    handleBotExit(code, signal, uptime);
  });

  startHealthMonitor();
  startStableTimer();
}

async function handleBotExit(
  code: number | null,
  signal: string | null,
  uptime: number,
): Promise<void> {
  const exitCode = code ?? (signal ? 128 : 1);

  // Graceful shutdown
  if (exitCode === EXIT_GRACEFUL) {
    log("Bot shut down gracefully — daemon exiting");
    cleanup();
    process.exit(0);
  }

  // Deploy restart
  if (exitCode === EXIT_DEPLOY_RESTART) {
    log("Bot requested deploy restart (exit 100)");
    notifyDiscord(
      `🔄 discordclaw: Deploy restart requested. Running deployment pipeline...`,
    );

    const success = runDeploy();
    if (!success) {
      notifyDiscord(
        `❌ discordclaw: Deployment pipeline failed! Restarting with current code...`,
      );
    }

    spawnBot();
    return;
  }

  // Crash — analyze and recover
  recordCrash();
  const backoff = getBackoffDelay();
  const { isEvolution, commitMessage } = isEvolutionRelatedCrash();

  if (isEvolution) {
    // Evolution-related crash
    const uptimeStr = formatUptime(uptime);
    notifyDiscord(
      [
        `⚠️ **discordclaw: Evolution rollback triggered**`,
        `Exit code: ${exitCode}`,
        `Uptime: ${uptimeStr}`,
        `Reverting: \`${commitMessage}\``,
        "",
        "```",
        getBufferTail(30),
        "```",
      ].join("\n"),
    );

    const rolled = rollbackEvolution(commitMessage);
    if (rolled) {
      notifyDiscord(`✅ Rollback complete — restarting bot...`);
    } else {
      notifyDiscord(
        `❌ Rollback failed! Attempting restart with current code...`,
      );
    }

    spawnBot();
    return;
  }

  // Regular crash
  const uptimeStr = formatUptime(uptime);
  const recentCrashes = crashTimestamps.length;
  const isEscalation = recentCrashes >= MAX_RAPID_CRASHES;

  const lines = [
    `🔴 **discordclaw crashed**`,
    `Exit code: ${exitCode}${signal ? ` (${signal})` : ""}`,
    `Uptime: ${uptimeStr}`,
    `Recent crashes: ${recentCrashes} in last 5m`,
  ];

  if (isEscalation) {
    lines.push(
      `🚨 **ESCALATION**: ${recentCrashes} rapid crashes — entering ${COOLDOWN_MS / 60_000}min cooldown`,
    );
  } else if (backoff > 0) {
    lines.push(`Restarting in ${backoff / 1000}s...`);
  } else {
    lines.push(`Restarting immediately...`);
  }

  lines.push("", "```", getBufferTail(50), "```");

  notifyDiscord(lines.join("\n"));

  if (backoff > 0) {
    log(`Waiting ${backoff / 1000}s before restart (backoff)...`);
    await sleep(backoff);
  }

  // Check if we got a shutdown signal during backoff
  if (!shuttingDown) {
    spawnBot();
  }
}

function killBot(signal: NodeJS.Signals = "SIGTERM"): void {
  if (botProcess && !botProcess.killed) {
    log(`Sending ${signal} to bot (PID ${botProcess.pid})`);
    botProcess.kill(signal);
  }
}

// ---------------------------------------------------------------------------
// PID File
// ---------------------------------------------------------------------------

function writePidFile(): void {
  try {
    writeFileSync(PID_FILE, String(process.pid), "utf-8");
  } catch {
    logError("Could not write PID file");
  }
}

function removePidFile(): void {
  try {
    if (existsSync(PID_FILE)) {
      unlinkSync(PID_FILE);
    }
  } catch {
    // Ignore
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

function cleanup(): void {
  stopHealthMonitor();
  clearStableTimer();
  removePidFile();
}

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;

  log(`Received ${signal} — shutting down`);

  if (botProcess && !botProcess.killed) {
    log("Forwarding SIGTERM to bot...");
    botProcess.kill("SIGTERM");

    // Give bot 10s to shut down gracefully, then force kill
    const forceTimer = setTimeout(() => {
      if (botProcess && !botProcess.killed) {
        logError("Bot did not exit in 10s — force killing");
        botProcess.kill("SIGKILL");
      }
    }, 10_000);

    botProcess.on("exit", () => {
      clearTimeout(forceTimer);
      cleanup();
      process.exit(0);
    });
  } else {
    cleanup();
    process.exit(0);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  log("Discordclaw watchdog daemon starting");
  log(`Root: ${ROOT}`);
  log(`Gateway port: ${GATEWAY_PORT}`);
  log(`Webhook configured: ${WEBHOOK_URL ? "yes" : "no"}`);

  writePidFile();

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  spawnBot();
}

main();
