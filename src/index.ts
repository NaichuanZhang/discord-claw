import "dotenv/config";

import { execSync, spawn } from "node:child_process";
import { initDb } from "./db/index.js";
import { initSoul, stopSoulWatcher } from "./soul/soul.js";
import { initMemory, stopMemoryWatcher } from "./memory/memory.js";
import { CronService } from "./cron/service.js";
import { SkillService } from "./skills/service.js";
import { processAgentTurn } from "./agent/agent.js";
import { createClient, startBot, stopBot } from "./bot/client.js";
import { setCommandsSkillService } from "./bot/commands.js";
import { startGateway } from "./gateway/server.js";
import { cleanExpiredSessions } from "./agent/sessions.js";
import { setRestartHandler } from "./restart.js";
import { syncDeployedEvolutions, setEvolutionSendToDiscord, checkGhCli } from "./evolution/engine.js";
import { setHealthDiscordClient, setServicesReady } from "./evolution/health.js";

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

function killExistingInstances(): void {
  const myPid = process.pid;
  try {
    // Find all node processes running discordclaw's index
    const out = execSync(
      `ps aux | grep -E 'tsx.*src/index\\.ts|node.*dist/index\\.js' | grep -v grep`,
      { encoding: "utf-8", timeout: 5_000 },
    ).trim();

    if (!out) return;

    for (const line of out.split("\n")) {
      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[1], 10);
      if (!pid || pid === myPid) continue;
      try {
        process.kill(pid, "SIGTERM");
        console.log(`[discordclaw] Killed existing instance (PID ${pid})`);
      } catch {
        // Process may have already exited
      }
    }
  } catch {
    // grep returns exit code 1 when no matches — that's fine
  }
}

async function main(): Promise<void> {
  console.log("[discordclaw] Starting...");

  // 0. Kill any existing discordclaw instances (only on restart, not manual start)
  if (process.env.DISCORDCLAW_RESTART === "1") {
    killExistingInstances();
    delete process.env.DISCORDCLAW_RESTART;
  }

  // 1. Initialize database
  console.log("[discordclaw] Initializing database...");
  initDb();

  // 2. Load soul + start file watcher
  console.log("[discordclaw] Loading soul...");
  await initSoul();

  // 3. Index memory files
  console.log("[discordclaw] Indexing memory...");
  await initMemory();

  // 3.5 Initialize skills
  console.log("[discordclaw] Loading skills...");
  const skillService = new SkillService();
  await skillService.init();
  setCommandsSkillService(skillService);

  // 3.7 Check gh CLI availability
  const ghAvailable = await checkGhCli();
  if (!ghAvailable) {
    console.warn("[discordclaw] WARNING: gh CLI not authenticated — evolution PRs will fail");
  }

  // 4. Start cron service
  console.log("[discordclaw] Starting cron service...");
  const cronService = new CronService();
  cronService.setExecuteAgentTurn(
    (message, model) => processAgentTurn({ message, model }),
  );
  cronService.start();

  // 5. Start Discord bot
  console.log("[discordclaw] Connecting to Discord...");
  const client = createClient();
  await startBot(client);

  // Wire cron → Discord delivery now that the client is ready
  cronService.setSendToDiscord(async (channelId, text, mentionUser) => {
    const channel: any = await client.channels.fetch(channelId);
    if (!channel?.send) {
      console.error(`[cron] Cannot send to channel ${channelId}`);
      return;
    }
    const prefix = mentionUser ? `<@${mentionUser}> ` : "";
    await channel.send(prefix + text);
  });

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

  // 6. Start gateway server
  const port = parseInt(process.env.GATEWAY_PORT || "3000", 10);
  const token = process.env.GATEWAY_TOKEN || "discordclaw";
  const gateway = startGateway({
    port,
    token,
    cronService,
    skillService,
    discordClient: client,
  });

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

  // 7. Schedule periodic session cleanup (every hour)
  const SESSION_CLEANUP_INTERVAL = 60 * 60 * 1000;
  const cleanupInterval = setInterval(() => {
    try {
      cleanExpiredSessions();
    } catch (err) {
      console.error("[discordclaw] Session cleanup error:", err);
    }
  }, SESSION_CLEANUP_INTERVAL);

  // 8. Log startup summary
  const guilds = client.guilds.cache;
  const cronJobs = cronService.list();
  console.log("[discordclaw] ========================================");
  console.log(`[discordclaw] Bot online as ${client.user?.tag}`);
  console.log(`[discordclaw] Guilds: ${guilds.size}`);
  console.log(`[discordclaw] Cron jobs: ${cronJobs.length}`);
  console.log(`[discordclaw] Skills: ${skillService.list().length}`);
  console.log(`[discordclaw] gh CLI: ${ghAvailable ? "ready" : "NOT AVAILABLE"}`);
  console.log(`[discordclaw] Gateway: http://localhost:${port}`);
  console.log("[discordclaw] ========================================");

  // ---------------------------------------------------------------------------
  // Graceful shutdown
  // ---------------------------------------------------------------------------

  async function shutdown(signal: string): Promise<void> {
    console.log(`\n[discordclaw] Received ${signal}, shutting down...`);

    // Stop periodic cleanup
    clearInterval(cleanupInterval);

    // Stop cron first (prevents new jobs from firing)
    cronService.stop();

    // Stop file watchers
    stopSoulWatcher();
    stopMemoryWatcher();
    skillService.stop();

    // Close gateway
    gateway.close();

    // Disconnect Discord
    await stopBot(client);

    console.log("[discordclaw] Shutdown complete");
    process.exit(0);
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Wire restart: graceful shutdown → spawn new process → exit
  setRestartHandler(() => {
    console.log("[discordclaw] Restart requested...");
    (async () => {
      clearInterval(cleanupInterval);
      cronService.stop();
      stopSoulWatcher();
      stopMemoryWatcher();
      skillService.stop();
      gateway.close();
      await stopBot(client);

      // Include execArgv so tsx loader hooks (--require, --import) are preserved
      const child = spawn(
        process.execPath,
        [...process.execArgv, ...process.argv.slice(1)],
        { detached: true, stdio: "inherit", env: { ...process.env, DISCORDCLAW_RESTART: "1" } },
      );
      child.unref();
      process.exit(0);
    })();
  });
}

main().catch((err) => {
  console.error("[discordclaw] Fatal error:", err);
  process.exit(1);
});
