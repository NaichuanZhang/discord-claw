import express from "express";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { createApiRouter } from "./api.js";
import type { CronService } from "../cron/service.js";
import type { SkillService } from "../skills/service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// WebSocket client tracking
// ---------------------------------------------------------------------------

const wsClients = new Set<WebSocket>();

/**
 * Broadcast a JSON message to all connected WebSocket clients.
 * Used by the message handler to stream real-time logs to the dashboard.
 */
export function broadcastLog(data: { type: string; [key: string]: any }): void {
  const payload = JSON.stringify(data);
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

// ---------------------------------------------------------------------------
// Gateway server
// ---------------------------------------------------------------------------

export function startGateway(opts: {
  port: number;
  token: string;
  cronService: CronService;
  skillService: SkillService;
  discordClient?: any;
}): { close: () => void } {
  const { port, token, cronService, skillService, discordClient } = opts;

  const app = express();

  // ---------- Auth middleware for /api/* (disabled for self-hosted) ----------
  // TODO: re-enable for cloud gateway
  // app.use("/api", (req, res, next) => { ... });

  // ---------- JSON body parser ----------
  app.use(express.json());

  // ---------- API routes ----------
  const apiRouter = createApiRouter({ cronService, skillService, discordClient });
  app.use("/api", apiRouter);

  // ---------- Static files for dashboard SPA ----------
  const uiDistPath = join(__dirname, "..", "..", "dist", "ui");
  if (existsSync(uiDistPath)) {
    app.use(express.static(uiDistPath));

    // SPA fallback: serve index.html for any non-API, non-file route
    app.get("*", (_req, res) => {
      const indexPath = join(uiDistPath, "index.html");
      if (existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).json({ error: "UI not built" });
      }
    });
  }

  // ---------- HTTP server ----------
  const server = createServer(app);

  // ---------- WebSocket server ----------
  const wss = new WebSocketServer({ server, path: "/ws/logs" });

  wss.on("connection", (ws) => {
    wsClients.add(ws);
    console.log(`[gateway] WebSocket client connected, total: ${wsClients.size}`);

    ws.on("close", () => {
      wsClients.delete(ws);
      console.log(`[gateway] WebSocket client disconnected, total: ${wsClients.size}`);
    });

    ws.on("error", (err) => {
      console.error("[gateway] WebSocket error:", err.message);
      wsClients.delete(ws);
    });
  });

  // ---------- Listen ----------
  server.listen(port, () => {
    console.log(`[gateway] Server listening on port ${port}`);
  });

  // ---------- Close function ----------
  return {
    close: () => {
      console.log("[gateway] Shutting down...");
      // Close all WebSocket connections
      for (const client of wsClients) {
        client.close(1001, "Server shutting down");
      }
      wsClients.clear();
      wss.close();
      server.close();
      console.log("[gateway] Shut down complete");
    },
  };
}
