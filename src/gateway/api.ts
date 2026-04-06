import { Router, type Request, type Response } from "express";
import { existsSync, statSync, readdirSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getDb, getSessionMessages, setChannelConfig, setConfig } from "../db/index.js";
import { listSessions, clearSession } from "../agent/sessions.js";
import { getSoul, setSoul } from "../soul/soul.js";
import type { CronService } from "../cron/service.js";
import type { CronJobCreate, CronJobPatch } from "../cron/types.js";
import type { SkillService } from "../skills/service.js";
import { getMemoryLines } from "../memory/memory.js";
import { triggerRestart } from "../restart.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..");
const DATA_DIR = join(PROJECT_ROOT, "data");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(...args: unknown[]): void {
  console.log("[gateway]", ...args);
}

/**
 * Validate that the resolved path is within DATA_DIR (no path traversal).
 */
function safePath(relativePath: string): string | null {
  const resolved = resolve(DATA_DIR, relativePath);
  if (!resolved.startsWith(DATA_DIR + "/") && resolved !== DATA_DIR) {
    return null;
  }
  return resolved;
}

/** Extract a route param as a plain string (Express 5 types return string | string[]). */
function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function createApiRouter(opts: {
  cronService: CronService;
  skillService: SkillService;
  discordClient?: any;
}): Router {
  const { cronService, skillService, discordClient } = opts;
  const router = Router();

  // =========================================================================
  // Status
  // =========================================================================

  router.get("/status", (_req: Request, res: Response) => {
    try {
      const online = !!discordClient?.isReady();
      const guilds =
        discordClient?.guilds?.cache?.map(
          (g: any) => ({
            id: g.id,
            name: g.name,
            memberCount: g.memberCount,
            channelCount: g.channels?.cache?.size ?? 0,
          }),
        ) ?? [];

      const uptime = discordClient?.uptime ?? 0;
      const mem = process.memoryUsage();

      res.json({
        online,
        guilds,
        uptime,
        memoryUsage: {
          rss: mem.rss,
          heapUsed: mem.heapUsed,
        },
      });
    } catch (err) {
      log("Error in GET /status:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  // =========================================================================
  // Sessions
  // =========================================================================

  router.get("/sessions", (req: Request, res: Response) => {
    try {
      const guildId = req.query.guildId as string | undefined;
      const limit = parseInt(req.query.limit as string, 10) || 50;
      const offset = parseInt(req.query.offset as string, 10) || 0;

      const result = listSessions({ guildId, limit, offset });
      res.json(result);
    } catch (err) {
      log("Error in GET /sessions:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  router.get("/sessions/:id", (req: Request, res: Response) => {
    try {
      const id = param(req, "id");
      const db = getDb();
      const row = db
        .prepare("SELECT * FROM sessions WHERE id = ?")
        .get(id) as Record<string, unknown> | undefined;

      if (!row) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      const session = {
        id: row.id as string,
        discordKey: row.discord_key as string,
        agentSessionId: (row.agent_session_id as string) ?? undefined,
        guildId: (row.guild_id as string) ?? undefined,
        channelId: (row.channel_id as string) ?? undefined,
        userId: (row.user_id as string) ?? undefined,
        createdAt: row.created_at as number,
        lastActive: row.last_active as number,
      };

      const messages = getSessionMessages(id);

      res.json({ session, messages });
    } catch (err) {
      log("Error in GET /sessions/:id:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  router.delete("/sessions/:id", (req: Request, res: Response) => {
    try {
      const id = param(req, "id");
      clearSession(id);
      res.json({ ok: true });
    } catch (err) {
      log("Error in DELETE /sessions/:id:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  // =========================================================================
  // Channels
  // =========================================================================

  router.get("/channels", (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const rows = db
        .prepare("SELECT * FROM channel_configs ORDER BY updated_at DESC")
        .all() as Record<string, unknown>[];

      const channels = rows.map((row) => ({
        channelId: row.channel_id as string,
        guildId: (row.guild_id as string) ?? undefined,
        enabled: (row.enabled as number) === 1,
        systemPrompt: (row.system_prompt as string) ?? undefined,
        settings: JSON.parse((row.settings as string) || "{}"),
        updatedAt: row.updated_at as number,
      }));

      res.json({ channels });
    } catch (err) {
      log("Error in GET /channels:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  router.put("/channels/:id", (req: Request, res: Response) => {
    try {
      const id = param(req, "id");
      const body = req.body as {
        enabled?: boolean;
        systemPrompt?: string;
        settings?: Record<string, unknown>;
      };

      setChannelConfig(id, body);
      res.json({ ok: true });
    } catch (err) {
      log("Error in PUT /channels/:id:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  // =========================================================================
  // Config
  // =========================================================================

  router.get("/config", (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const rows = db
        .prepare("SELECT key, value FROM config")
        .all() as Array<{ key: string; value: string }>;

      const config: Record<string, string> = {};
      for (const row of rows) {
        config[row.key] = row.value;
      }

      res.json(config);
    } catch (err) {
      log("Error in GET /config:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  router.put("/config", (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, string>;

      for (const [key, value] of Object.entries(body)) {
        setConfig(key, value);
      }

      res.json({ ok: true });
    } catch (err) {
      log("Error in PUT /config:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  // =========================================================================
  // Soul
  // =========================================================================

  router.get("/soul", (_req: Request, res: Response) => {
    try {
      res.json({ content: getSoul() });
    } catch (err) {
      log("Error in GET /soul:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  router.put("/soul", async (req: Request, res: Response) => {
    try {
      const { content } = req.body as { content: string };
      if (typeof content !== "string") {
        res.status(400).json({ error: "content must be a string" });
        return;
      }
      await setSoul(content);
      res.json({ ok: true });
    } catch (err) {
      log("Error in PUT /soul:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  // =========================================================================
  // Memory
  // =========================================================================

  router.get("/memory", async (_req: Request, res: Response) => {
    try {
      const files: Array<{ path: string; size: number; mtime: number }> = [];

      // Check MEMORY.md
      const memoryFile = join(DATA_DIR, "MEMORY.md");
      if (existsSync(memoryFile)) {
        const stat = statSync(memoryFile);
        files.push({
          path: "MEMORY.md",
          size: stat.size,
          mtime: stat.mtimeMs,
        });
      }

      // Check data/memory/*.md
      const memoryDir = join(DATA_DIR, "memory");
      if (existsSync(memoryDir)) {
        const entries = readdirSync(memoryDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith(".md")) {
            const filePath = join(memoryDir, entry.name);
            const stat = statSync(filePath);
            files.push({
              path: `memory/${entry.name}`,
              size: stat.size,
              mtime: stat.mtimeMs,
            });
          }
        }
      }

      res.json({ files });
    } catch (err) {
      log("Error in GET /memory:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  router.get("/memory/:path(*)", (req: Request, res: Response) => {
    try {
      const filePath = param(req, "path");

      // Validate path is safe
      const absPath = safePath(filePath);
      if (!absPath) {
        res.status(400).json({ error: "Invalid path" });
        return;
      }

      const content = getMemoryLines(filePath);
      res.json({ path: filePath, content });
    } catch (err) {
      log("Error in GET /memory/:path:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  router.put("/memory/:path(*)", async (req: Request, res: Response) => {
    try {
      const filePath = param(req, "path");
      const { content } = req.body as { content: string };

      if (typeof content !== "string") {
        res.status(400).json({ error: "content must be a string" });
        return;
      }

      // Validate path is safe
      const absPath = safePath(filePath);
      if (!absPath) {
        res.status(400).json({ error: "Invalid path" });
        return;
      }

      // Ensure parent directory exists
      const dir = dirname(absPath);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }

      await writeFile(absPath, content, "utf-8");
      log(`Memory file written: ${filePath}`);
      res.json({ ok: true });
    } catch (err) {
      log("Error in PUT /memory/:path:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  // =========================================================================
  // Skills
  // =========================================================================

  router.get("/skills", (_req, res) => {
    try {
      const skills = skillService.list();
      res.json({ skills });
    } catch (err) {
      log("Error in GET /skills:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  router.get("/skills/:id", (req, res) => {
    try {
      const id = param(req, "id");
      const skill = skillService.get(id);
      if (!skill) { res.status(404).json({ error: "Skill not found" }); return; }
      res.json(skill);
    } catch (err) {
      log("Error in GET /skills/:id:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  router.post("/skills", async (req, res) => {
    try {
      const { source, content, url, name } = req.body as {
        source: "upload" | "github";
        content?: string;
        url?: string;
        name?: string;
      };

      let skill;
      if (source === "github") {
        if (!url) { res.status(400).json({ error: "url is required for GitHub install" }); return; }
        skill = await skillService.installFromGitHub({ url, name });
      } else if (source === "upload") {
        if (!content) { res.status(400).json({ error: "content is required for upload" }); return; }
        skill = await skillService.installFromUpload({ content, name });
      } else {
        res.status(400).json({ error: "source must be 'upload' or 'github'" });
        return;
      }

      res.status(201).json(skill);
    } catch (err) {
      log("Error in POST /skills:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  router.put("/skills/:id", async (req, res) => {
    try {
      const id = param(req, "id");
      const { enabled, content } = req.body as { enabled?: boolean; content?: string };
      const skill = await skillService.update(id, { enabled, content });
      if (!skill) { res.status(404).json({ error: "Skill not found" }); return; }
      res.json(skill);
    } catch (err) {
      log("Error in PUT /skills/:id:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  router.delete("/skills/:id", (req, res) => {
    try {
      const id = param(req, "id");
      const removed = skillService.remove(id);
      if (!removed) { res.status(404).json({ error: "Skill not found" }); return; }
      res.json({ ok: true });
    } catch (err) {
      log("Error in DELETE /skills/:id:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  // =========================================================================
  // Cron
  // =========================================================================

  router.get("/cron", (_req: Request, res: Response) => {
    try {
      const jobs = cronService.list();
      res.json({ jobs });
    } catch (err) {
      log("Error in GET /cron:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  router.post("/cron", (req: Request, res: Response) => {
    try {
      const body = req.body as CronJobCreate;
      const job = cronService.add(body);
      res.status(201).json(job);
    } catch (err) {
      log("Error in POST /cron:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  router.put("/cron/:id", (req: Request, res: Response) => {
    try {
      const id = param(req, "id");
      const body = req.body as CronJobPatch;
      const job = cronService.update(id, body);
      if (!job) {
        res.status(404).json({ error: "Cron job not found" });
        return;
      }
      res.json(job);
    } catch (err) {
      log("Error in PUT /cron/:id:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  router.delete("/cron/:id", (req: Request, res: Response) => {
    try {
      const id = param(req, "id");
      const removed = cronService.remove(id);
      if (!removed) {
        res.status(404).json({ error: "Cron job not found" });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      log("Error in DELETE /cron/:id:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  router.post("/cron/:id/run", async (req: Request, res: Response) => {
    try {
      const id = param(req, "id");
      await cronService.forceRun(id);
      res.json({ ok: true });
    } catch (err) {
      log("Error in POST /cron/:id/run:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  router.get("/cron/:id/runs", (req: Request, res: Response) => {
    try {
      const id = param(req, "id");
      const limit = parseInt(req.query.limit as string, 10) || 20;
      const runs = cronService.getRunHistory(id, limit);
      res.json({ runs });
    } catch (err) {
      log("Error in GET /cron/:id/runs:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  // =========================================================================
  // Bot control
  // =========================================================================

  router.post("/bot/restart", (_req: Request, res: Response) => {
    res.json({ message: "Restarting..." });
    triggerRestart();
  });

  return router;
}
