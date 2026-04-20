import React, { useState, useEffect, useRef, useCallback } from "react";
import type { RideData, CoachMessage } from "./types";
import { COACH_MESSAGES } from "./constants";
import { createMockRideGenerator } from "./mockGenerator";
import StartScreen from "./StartScreen";
import HUD from "./HUD";
import Scene3D from "./Scene3D";

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
  const autoStarted = useRef(false);

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

  // Auto-start support via URL param: ?autostart=1
  useEffect(() => {
    if (autoStarted.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("autostart") === "1") {
      autoStarted.current = true;
      startRide();
    }
  }, [startRide]);

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
      {/* Canvas Scene (background) */}
      <div style={{ position: "absolute", inset: 0 }}>
        <Scene3D
          speed={data?.speed ?? 0}
          cadence={data?.cadence ?? 80}
          gradient={data?.gradient ?? 0}
          elevation={data?.elevation ?? 150}
          power={data?.power ?? 0}
          elapsedTime={data?.elapsedTime ?? 0}
        />
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
