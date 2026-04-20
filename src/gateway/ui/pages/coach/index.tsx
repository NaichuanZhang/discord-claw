import React, { useState, useEffect, useRef, useCallback, Suspense } from "react";
import type { RideData, CoachMessage } from "./types";
import { COACH_MESSAGES } from "./constants";
import { createMockRideGenerator } from "./mockGenerator";
import StartScreen from "./StartScreen";
import HUD from "./HUD";

// Lazy load the 3D scene (heavy — Three.js bundle)
const Scene3D = React.lazy(() => import("./Scene3D"));

// ═══════════════════════════════════════════════════════════════════════
// Loading screen for 3D scene
// ═══════════════════════════════════════════════════════════════════════

function SceneLoader() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "radial-gradient(ellipse at center, #0f1a2e, #050812)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          border: "3px solid rgba(231,76,60,0.2)",
          borderTopColor: "#e74c3c",
          borderRadius: "50%",
          animation: "spin 1s linear infinite",
        }}
      />
      <div style={{ color: "#5a6a8a", fontSize: 12, letterSpacing: 2 }}>LOADING 3D WORLD</div>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Main Coach Component
// ═══════════════════════════════════════════════════════════════════════

export default function Coach() {
  const [riding, setRiding] = useState(false);
  const [data, setData] = useState<RideData | null>(null);
  const [history, setHistory] = useState<RideData[]>([]);
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const generatorRef = useRef<ReturnType<typeof createMockRideGenerator> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const msgIdRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);

  const addCoachMessage = useCallback((text: string, type: CoachMessage["type"]) => {
    const msg: CoachMessage = { id: ++msgIdRef.current, text, type, timestamp: Date.now() };
    setMessages((prev) => [msg, ...prev].slice(0, 10));
  }, []);

  // Connect to WebSocket
  const connectWS = useCallback(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}/ws/coach`);
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "ride_data") {
          const rd = msg.data as RideData;
          setData(rd);
          setHistory((prev) => [...prev.slice(-300), rd]);
        } else if (msg.type === "coach_message") {
          addCoachMessage(msg.text, msg.messageType);
        }
      } catch { /* ignore */ }
    };

    ws.onclose = () => { wsRef.current = null; };
    return ws;
  }, [addCoachMessage]);

  const startRide = useCallback(() => {
    setRiding(true);
    setHistory([]);
    setMessages([]);
    addCoachMessage("Let's ride! Starting with an easy warmup spin.", "info");

    try { connectWS(); } catch { /* ignore */ }

    const gen = createMockRideGenerator();
    generatorRef.current = gen;

    let tickCount = 0;
    intervalRef.current = setInterval(() => {
      const rd = gen();
      setData(rd);
      setHistory((prev) => [...prev.slice(-300), rd]);
      tickCount++;

      if (tickCount % (12 + Math.floor(Math.random() * 12)) === 0) {
        const cm = COACH_MESSAGES[Math.floor(Math.random() * COACH_MESSAGES.length)];
        addCoachMessage(cm.text, cm.type);
      }
    }, 1000);
  }, [addCoachMessage, connectWS]);

  const stopRide = useCallback(() => {
    setRiding(false);
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    addCoachMessage("Ride complete! Incredible effort 💪🔥", "motivation");
  }, [addCoachMessage]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  // ── Pre-ride: show start screen ──
  if (!riding && !data) {
    return <StartScreen onStart={startRide} />;
  }

  // ── Active ride ──
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        zIndex: 1000,
        overflow: "hidden",
      }}
    >
      {/* 3D Scene (background) */}
      <div style={{ position: "absolute", inset: 0 }}>
        <Suspense fallback={<SceneLoader />}>
          <Scene3D
            speed={data?.speed ?? 0}
            cadence={data?.cadence ?? 80}
            gradient={data?.gradient ?? 0}
            elevation={data?.elevation ?? 150}
            power={data?.power ?? 0}
            elapsedTime={data?.elapsedTime ?? 0}
          />
        </Suspense>
      </div>

      {/* HUD Overlay */}
      <HUD
        data={data}
        history={history}
        messages={messages}
        riding={riding}
        onStop={stopRide}
        onStart={startRide}
      />
    </div>
  );
}
