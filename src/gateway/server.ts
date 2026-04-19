import express from "express";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { PROJECT_ROOT } from "../shared/paths.js";
import { createApiRouter } from "./api.js";
import type { CronService } from "../cron/service.js";
import type { SkillService } from "../skills/service.js";

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
// Mock cycling data generator (for /ws/coach)
// ---------------------------------------------------------------------------

function createCoachDataGenerator() {
  let elapsed = 0;
  let distance = 0;
  let calories = 0;
  let baseElevation = 150;
  let elevationPhase = Math.random() * Math.PI * 2;
  let basePower = 180;
  let baseHR = 135;
  let baseCadence = 85;
  let baseSpeed = 28;
  let angle = 0;
  const centerLat = 37.42;
  const centerLng = -122.08;

  const COACH_MESSAGES = [
    { text: "Great cadence! Keep that smooth pedal stroke.", type: "motivation" },
    { text: "Heart rate climbing — consider easing off a bit.", type: "warning" },
    { text: "You're in the sweet spot. Hold this power!", type: "motivation" },
    { text: "Climb ahead! Shift down and spin through it.", type: "info" },
    { text: "Power zone 4 — you're pushing hard! Great effort.", type: "zone" },
    { text: "Hydration reminder: take a sip!", type: "info" },
    { text: "Cadence dropping — try to keep above 80 RPM.", type: "warning" },
    { text: "Downhill section coming. Recover and breathe.", type: "info" },
    { text: "You're crushing it! Personal best pace!", type: "motivation" },
    { text: "Entering Zone 3 — sustainable tempo effort.", type: "zone" },
  ];

  return {
    tick() {
      elapsed += 1;
      elevationPhase += 0.02;

      const gradient = Math.sin(elevationPhase) * 6 + Math.sin(elevationPhase * 0.3) * 3;
      baseElevation += gradient * 0.1;

      const gradientPowerBoost = Math.max(0, gradient) * 15;
      const power = basePower + gradientPowerBoost + (Math.random() - 0.5) * 40;

      const speedGradientEffect = -gradient * 1.5;
      const speed = Math.max(5, baseSpeed + speedGradientEffect + (Math.random() - 0.5) * 4);

      const targetHR = baseHR + (power - basePower) * 0.15;
      baseHR += (targetHR - baseHR) * 0.05;
      const heartRate = baseHR + (Math.random() - 0.5) * 5;

      const cadence = baseCadence + (Math.random() - 0.5) * 10 - Math.max(0, gradient) * 2;

      distance += speed / 3600;
      calories += power * 0.001;

      angle += 0.001;
      const lat = centerLat + Math.sin(angle) * 0.02;
      const lng = centerLng + Math.cos(angle) * 0.03;

      if (Math.random() < 0.005) {
        basePower = 150 + Math.random() * 100;
        baseSpeed = 22 + Math.random() * 12;
        baseCadence = 75 + Math.random() * 20;
      }

      return {
        timestamp: Date.now(),
        speed: Math.round(speed * 10) / 10,
        power: Math.round(Math.max(0, power)),
        heartRate: Math.round(Math.max(60, heartRate)),
        cadence: Math.round(Math.max(40, cadence)),
        distance: Math.round(distance * 100) / 100,
        elevation: Math.round(baseElevation * 10) / 10,
        gradient: Math.round(gradient * 10) / 10,
        calories: Math.round(calories),
        elapsedTime: elapsed,
        latitude: lat,
        longitude: lng,
      };
    },

    getCoachMessage() {
      const msg = COACH_MESSAGES[Math.floor(Math.random() * COACH_MESSAGES.length)];
      return msg;
    },
  };
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
  const uiDistPath = join(PROJECT_ROOT, "dist", "ui");
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

  // ---------- WebSocket server: logs ----------
  const wssLogs = new WebSocketServer({ noServer: true });

  wssLogs.on("connection", (ws) => {
    wsClients.add(ws);
    console.log(`[gateway] WebSocket logs client connected, total: ${wsClients.size}`);

    ws.on("close", () => {
      wsClients.delete(ws);
      console.log(`[gateway] WebSocket logs client disconnected, total: ${wsClients.size}`);
    });

    ws.on("error", (err) => {
      console.error("[gateway] WebSocket logs error:", err.message);
      wsClients.delete(ws);
    });
  });

  // ---------- WebSocket server: coach (cycling data) ----------
  const wssCoach = new WebSocketServer({ noServer: true });

  wssCoach.on("connection", (ws) => {
    console.log("[gateway] Coach WebSocket client connected");

    const gen = createCoachDataGenerator();
    let tickCount = 0;

    const interval = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        clearInterval(interval);
        return;
      }

      const data = gen.tick();
      ws.send(JSON.stringify({ type: "ride_data", data }));
      tickCount++;

      // Send coach message every ~15-20 seconds
      if (tickCount % (15 + Math.floor(Math.random() * 10)) === 0) {
        const msg = gen.getCoachMessage();
        ws.send(JSON.stringify({
          type: "coach_message",
          text: msg.text,
          messageType: msg.type,
        }));
      }
    }, 1000);

    ws.on("close", () => {
      clearInterval(interval);
      console.log("[gateway] Coach WebSocket client disconnected");
    });

    ws.on("error", (err) => {
      clearInterval(interval);
      console.error("[gateway] Coach WebSocket error:", err.message);
    });
  });

  // ---------- HTTP upgrade handling (route WS by path) ----------
  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url ?? "/", `http://${request.headers.host}`).pathname;

    if (pathname === "/ws/logs") {
      wssLogs.handleUpgrade(request, socket, head, (ws) => {
        wssLogs.emit("connection", ws, request);
      });
    } else if (pathname === "/ws/coach") {
      wssCoach.handleUpgrade(request, socket, head, (ws) => {
        wssCoach.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
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
      wssLogs.close();
      wssCoach.close();
      server.close();
      console.log("[gateway] Shut down complete");
    },
  };
}
