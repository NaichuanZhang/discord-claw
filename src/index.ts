import "dotenv/config";

import { initDb } from "./db/index.js";
import { initSoul, stopSoulWatcher } from "./soul/soul.js";
import { initMemory, stopMemoryWatcher } from "./memory/memory.js";
import { CronService } from "./cron/service.js";
import { SkillService } from "./skills/service.js";
import { processAgentTurn } from "./agent/agent.js";
import { createClient, startBot, stopBot } from "./bot/client.js";
import { startGateway } from "./gateway/server.js";
import { cleanExpiredSessions } from "./agent/sessions.js";

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
}

main().catch((err) => {
  console.error("[discordclaw] Fatal error:", err);
  process.exit(1);
});
