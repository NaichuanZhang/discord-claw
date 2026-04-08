import "dotenv/config";

import { spawn } from "node:child_process";
import path from "node:path";
import { initDb } from "./db/index.js";
import { initSoul, stopSoulWatcher } from "./soul/soul.js";
import { initMemory, stopMemoryWatcher } from "./memory/memory.js";
import { CronService } from "./cron/service.js";
import { SkillService } from "./skills/service.js";
import { processAgentTurn } from "./agent/agent.js";
import { createClient, startBot, stopBot } from "./bot/client.js";
import { setCommandsSkillService, setCommandsCronService } from "./bot/commands.js";
import { startGateway } from "./gateway/server.js";
import { cleanExpiredSessions } from "./agent/sessions.js";
import { setRestartHandler } from "./restart.js";
import { syncDeployedEvolutions, setEvolutionSendToDiscord, checkGhCli } from "./evolution/engine.js";
import { setHealthDiscordClient, setServicesReady } from "./evolution/health.js";
import {
  startReflectionDaemon,
  stopReflectionDaemon,
  setReflectionSendToDiscord,
  setReflectionChannelId,
} from "./reflection/daemon.js";

// Admin user ID for DM fallback delivery
const ADMIN_USER_ID = "152801068663832576";

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("[discordclaw] Starting...");

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
  setCommandsCronService(cronService);

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

  // Wire cron → admin DM fallback
  try {
    const adminUser = await client.users.fetch(ADMIN_USER_ID);
    const dmChannel = await adminUser.createDM();
    cronService.setAdminDmChannelId(dmChannel.id);
    console.log(`[discordclaw] Admin DM fallback channel: ${dmChannel.id}`);
  } catch (err) {
    console.warn("[discordclaw] Could not set up admin DM fallback for cron:", err);
  }

  // Wire evolution → Discord delivery
  setEvolutionSendToDiscord(async (channelId, text) => {
    const channel: any = await client.channels.fetch(channelId);
    if (!channel?.send) {
      console.error(`[evolution] Cannot send to channel ${channelId}`);
      return;
    }
    await channel.send(text);
  });

  // Wire reflection daemon → Discord delivery
  const reflectionChannelId = process.env.REFLECTION_CHANNEL_ID;
  if (reflectionChannelId) {
    setReflectionChannelId(reflectionChannelId);
    setReflectionSendToDiscord(async (channelId, text) => {
      const channel: any = await client.channels.fetch(channelId);
      if (!channel?.send) {
        console.error(`[reflection] Cannot send to channel ${channelId}`);
        return;
      }
      await channel.send(text);
    });
  }

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

  // 8. Start reflection daemon (self-evolution feedback loop)
  console.log("[discordclaw] Starting reflection daemon...");
  startReflectionDaemon();

  // 9. Log startup summary
  const guilds = client.guilds.cache;
  const cronJobs = cronService.list();
  console.log("[discordclaw] ========================================");
  console.log(`[discordclaw] Bot online as ${client.user?.tag}`);
  console.log(`[discordclaw] Guilds: ${guilds.size}`);
  console.log(`[discordclaw] Cron jobs: ${cronJobs.length}`);
  console.log(`[discordclaw] Skills: ${skillService.list().length}`);
  console.log(`[discordclaw] gh CLI: ${ghAvailable ? "ready" : "NOT AVAILABLE"}`);
  console.log(`[discordclaw] Reflection: ${reflectionChannelId ? `→ #${reflectionChannelId}` : "no channel (ideas only)"}`);
  console.log(`[discordclaw] Gateway: http://localhost:${port}`);
  console.log("[discordclaw] ========================================");

  // ---------------------------------------------------------------------------
  // Graceful shutdown
  // ---------------------------------------------------------------------------

  async function shutdown(signal: string): Promise<void> {
    console.log(`\n[discordclaw] Received ${signal}, shutting down...`);

    // Stop periodic cleanup
    clearInterval(cleanupInterval);

    // Stop reflection daemon
    stopReflectionDaemon();

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

  // Wire restart: graceful shutdown → exec start.sh (full deploy pipeline)
  setRestartHandler(() => {
    console.log("[discordclaw] Restart requested — handing off to start.sh...");
    (async () => {
      clearInterval(cleanupInterval);
      stopReflectionDaemon();
      cronService.stop();
      stopSoulWatcher();
      stopMemoryWatcher();
      skillService.stop();
      gateway.close();
      await stopBot(client);

      // Resolve the repo root directory (where start.sh lives)
      const repoRoot = path.resolve(import.meta.dirname ?? ".", "..");
      const startScript = path.join(repoRoot, "start.sh");

      // Spawn start.sh detached — it will handle git pull, build, and launching a new instance
      // start.sh also kills any remaining instances before starting fresh
      const child = spawn("bash", [startScript], {
        detached: true,
        stdio: "inherit",
        cwd: repoRoot,
      });
      child.unref();
      process.exit(0);
    })();
  });
}

main().catch((err) => {
  console.error("[discordclaw] Fatal error:", err);
  process.exit(1);
});
