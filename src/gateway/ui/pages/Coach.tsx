import React, { useState, useEffect, useRef, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════

interface RideData {
  timestamp: number;
  speed: number;        // km/h
  power: number;        // watts
  heartRate: number;    // bpm
  cadence: number;      // rpm
  distance: number;     // km
  elevation: number;    // m
  gradient: number;     // %
  calories: number;
  elapsedTime: number;  // seconds
  latitude: number;
  longitude: number;
}

interface CoachMessage {
  id: number;
  text: string;
  type: "info" | "warning" | "motivation" | "zone";
  timestamp: number;
}

interface ZoneInfo {
  zone: number;
  name: string;
  color: string;
  min: number;
  max: number;
}

// ═══════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════

const HR_ZONES: ZoneInfo[] = [
  { zone: 1, name: "Recovery",  color: "#4a9eff", min: 0,   max: 120 },
  { zone: 2, name: "Endurance", color: "#2ecc71", min: 120, max: 140 },
  { zone: 3, name: "Tempo",     color: "#f1c40f", min: 140, max: 155 },
  { zone: 4, name: "Threshold", color: "#e67e22", min: 155, max: 170 },
  { zone: 5, name: "VO2 Max",   color: "#e74c3c", min: 170, max: 999 },
];

const POWER_ZONES: ZoneInfo[] = [
  { zone: 1, name: "Active Recovery", color: "#4a9eff", min: 0,   max: 130 },
  { zone: 2, name: "Endurance",       color: "#2ecc71", min: 130, max: 180 },
  { zone: 3, name: "Tempo",           color: "#f1c40f", min: 180, max: 220 },
  { zone: 4, name: "Threshold",       color: "#e67e22", min: 220, max: 260 },
  { zone: 5, name: "VO2 Max",         color: "#e74c3c", min: 260, max: 300 },
  { zone: 6, name: "Anaerobic",       color: "#9b59b6", min: 300, max: 999 },
];

const COACH_MESSAGES = [
  { text: "Great cadence! Keep that smooth pedal stroke.", type: "motivation" as const },
  { text: "Heart rate climbing — consider easing off a bit.", type: "warning" as const },
  { text: "You're in the sweet spot. Hold this power!", type: "motivation" as const },
  { text: "Climb ahead! Shift down and spin through it.", type: "info" as const },
  { text: "Power zone 4 — you're pushing hard! Great effort.", type: "zone" as const },
  { text: "Hydration reminder: take a sip!", type: "info" as const },
  { text: "Cadence dropping — try to keep above 80 RPM.", type: "warning" as const },
  { text: "Downhill section coming. Recover and breathe.", type: "info" as const },
  { text: "You're crushing it! Personal best pace!", type: "motivation" as const },
  { text: "Entering Zone 3 — sustainable tempo effort.", type: "zone" as const },
  { text: "30 seconds of high power — let's go!", type: "motivation" as const },
  { text: "Great recovery! Heart rate coming down nicely.", type: "info" as const },
];

// ═══════════════════════════════════════════════════════════════════════
// Mock data generator — simulates realistic cycling
// ═══════════════════════════════════════════════════════════════════════

function createMockRideGenerator() {
  let elapsed = 0;
  let distance = 0;
  let calories = 0;
  let baseElevation = 150;
  let elevationPhase = Math.random() * Math.PI * 2;
  let basePower = 180;
  let baseHR = 135;
  let baseCadence = 85;
  let baseSpeed = 28;
  // Simulated lat/lng (cycling around a loop)
  let angle = 0;
  const centerLat = 37.42;
  const centerLng = -122.08;

  return (): RideData => {
    elapsed += 1;
    elevationPhase += 0.02;

    // Simulate terrain changes
    const gradient = Math.sin(elevationPhase) * 6 + Math.sin(elevationPhase * 0.3) * 3;
    baseElevation += gradient * 0.1;

    // Power varies with gradient
    const gradientPowerBoost = Math.max(0, gradient) * 15;
    const power = basePower + gradientPowerBoost + (Math.random() - 0.5) * 40;

    // Speed inversely related to gradient
    const speedGradientEffect = -gradient * 1.5;
    const speed = Math.max(5, baseSpeed + speedGradientEffect + (Math.random() - 0.5) * 4);

    // HR responds slowly to power
    const targetHR = baseHR + (power - basePower) * 0.15;
    baseHR += (targetHR - baseHR) * 0.05;
    const heartRate = baseHR + (Math.random() - 0.5) * 5;

    // Cadence
    const cadence = baseCadence + (Math.random() - 0.5) * 10 - Math.max(0, gradient) * 2;

    distance += speed / 3600; // km per second
    calories += power * 0.001; // rough approximation

    // Move around a loop
    angle += 0.001;
    const lat = centerLat + Math.sin(angle) * 0.02;
    const lng = centerLng + Math.cos(angle) * 0.03;

    // Occasionally shift base values (interval training feel)
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
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Helper: format time
// ═══════════════════════════════════════════════════════════════════════

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function getHRZone(hr: number): ZoneInfo {
  for (let i = HR_ZONES.length - 1; i >= 0; i--) {
    if (hr >= HR_ZONES[i].min) return HR_ZONES[i];
  }
  return HR_ZONES[0];
}

function getPowerZone(watts: number): ZoneInfo {
  for (let i = POWER_ZONES.length - 1; i >= 0; i--) {
    if (watts >= POWER_ZONES[i].min) return POWER_ZONES[i];
  }
  return POWER_ZONES[0];
}

// ═══════════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════════

// ── 3D Road Canvas ──────────────────────────────────────────────────

function RoadCanvas({
  gradient,
  speed,
  elevation,
  elapsed,
}: {
  gradient: number;
  speed: number;
  elevation: number;
  elapsed: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const offsetRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let running = true;

    const draw = () => {
      if (!running) return;
      const W = canvas.width;
      const H = canvas.height;

      // Road scroll speed based on actual speed
      offsetRef.current += speed * 0.03;

      // ── Sky gradient (time-of-day feel) ──
      const skyGrad = ctx.createLinearGradient(0, 0, 0, H * 0.55);
      const timeOfDay = (Math.sin(elapsed * 0.001) + 1) / 2;
      const r = Math.round(15 + timeOfDay * 20);
      const g = Math.round(20 + timeOfDay * 30);
      const b = Math.round(60 + timeOfDay * 40);
      skyGrad.addColorStop(0, `rgb(${r}, ${g}, ${b})`);
      skyGrad.addColorStop(0.7, `rgb(${r + 25}, ${g + 30}, ${b + 20})`);
      skyGrad.addColorStop(1, `rgb(${r + 40}, ${g + 50}, ${b + 10})`);
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, W, H * 0.55);

      // ── Stars ──
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      for (let i = 0; i < 30; i++) {
        const sx = (i * 137.5 + 50) % W;
        const sy = (i * 73.1 + 20) % (H * 0.35);
        const size = 1 + (i % 3) * 0.5;
        ctx.beginPath();
        ctx.arc(sx, sy, size, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── Mountains ──
      const horizonY = H * 0.55;
      const tilt = gradient * 2;

      // Far mountains
      ctx.fillStyle = "rgba(30, 40, 80, 0.8)";
      ctx.beginPath();
      ctx.moveTo(0, horizonY);
      for (let x = 0; x <= W; x += 4) {
        const mh = Math.sin(x * 0.008 + 1) * 40 + Math.sin(x * 0.015) * 25 + 60;
        ctx.lineTo(x, horizonY - mh + tilt * (x / W - 0.5));
      }
      ctx.lineTo(W, horizonY);
      ctx.closePath();
      ctx.fill();

      // Near mountains
      ctx.fillStyle = "rgba(20, 30, 60, 0.9)";
      ctx.beginPath();
      ctx.moveTo(0, horizonY);
      for (let x = 0; x <= W; x += 4) {
        const mh = Math.sin(x * 0.012 + 3) * 30 + Math.sin(x * 0.022 + 1) * 20 + 35;
        ctx.lineTo(x, horizonY - mh + tilt * (x / W - 0.5) * 0.5);
      }
      ctx.lineTo(W, horizonY);
      ctx.closePath();
      ctx.fill();

      // ── Ground ──
      const groundGrad = ctx.createLinearGradient(0, horizonY, 0, H);
      groundGrad.addColorStop(0, "#1a2a15");
      groundGrad.addColorStop(0.3, "#1e3318");
      groundGrad.addColorStop(1, "#0d1a0a");
      ctx.fillStyle = groundGrad;
      ctx.fillRect(0, horizonY, W, H);

      // ── Road (perspective) ──
      const roadVanishX = W / 2;
      const roadVanishY = horizonY - tilt * 5;
      const roadBottomWidth = W * 0.5;

      // Road surface
      const roadGrad = ctx.createLinearGradient(0, roadVanishY, 0, H);
      roadGrad.addColorStop(0, "#333");
      roadGrad.addColorStop(0.3, "#3a3a3a");
      roadGrad.addColorStop(1, "#2a2a2a");

      ctx.fillStyle = roadGrad;
      ctx.beginPath();
      ctx.moveTo(roadVanishX - 2, roadVanishY);
      ctx.lineTo(roadVanishX + 2, roadVanishY);
      ctx.lineTo(W / 2 + roadBottomWidth / 2, H);
      ctx.lineTo(W / 2 - roadBottomWidth / 2, H);
      ctx.closePath();
      ctx.fill();

      // Road edges (white lines)
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(roadVanishX - 2, roadVanishY);
      ctx.lineTo(W / 2 - roadBottomWidth / 2, H);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(roadVanishX + 2, roadVanishY);
      ctx.lineTo(W / 2 + roadBottomWidth / 2, H);
      ctx.stroke();

      // Center dashes (animated)
      const numDashes = 20;
      for (let i = 0; i < numDashes; i++) {
        const t = ((i / numDashes + (offsetRef.current * 0.01) % 1) % 1);
        const t3 = t * t * t; // cubic for perspective
        const dashY = roadVanishY + (H - roadVanishY) * t3;
        const dashX = roadVanishX;

        const dashWidth = 2 + t3 * 30;
        const dashHeight = 1 + t3 * 12;
        const alpha = 0.2 + t3 * 0.6;

        if (i % 2 === 0) {
          ctx.fillStyle = `rgba(255, 200, 50, ${alpha})`;
          ctx.fillRect(
            dashX - dashWidth / 2,
            dashY - dashHeight / 2,
            dashWidth,
            dashHeight,
          );
        }
      }

      // ── Trees along roadside ──
      for (let i = 0; i < 12; i++) {
        const t = ((i / 12 + (offsetRef.current * 0.005) % 1) % 1);
        const t2 = t * t;
        const treeY = roadVanishY + (H - roadVanishY) * t2;
        const spread = 4 + t2 * (roadBottomWidth * 0.55);
        const side = i % 2 === 0 ? -1 : 1;
        const treeX = W / 2 + side * spread;
        const treeSize = 2 + t2 * 20;
        const alpha = t2 * 0.8;

        // Trunk
        ctx.fillStyle = `rgba(60, 40, 20, ${alpha})`;
        ctx.fillRect(treeX - treeSize * 0.1, treeY - treeSize * 1.5, treeSize * 0.2, treeSize * 1.5);

        // Foliage
        ctx.fillStyle = `rgba(30, ${80 + i * 5}, 30, ${alpha})`;
        ctx.beginPath();
        ctx.arc(treeX, treeY - treeSize * 1.8, treeSize * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── Rider silhouette (fixed position, bottom center) ──
      const riderX = W / 2;
      const riderY = H * 0.78;
      const riderScale = 1.0;
      const bobble = Math.sin(elapsed * 0.3) * 2;

      // Bike frame
      ctx.strokeStyle = "#666";
      ctx.lineWidth = 3;
      // Wheels
      ctx.beginPath();
      ctx.arc(riderX - 25 * riderScale, riderY + 15 + bobble, 18 * riderScale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(riderX + 25 * riderScale, riderY + 15 + bobble, 18 * riderScale, 0, Math.PI * 2);
      ctx.stroke();

      // Spokes (animated)
      const spokeAngle = elapsed * 0.2 * (speed / 20);
      for (let w = 0; w < 2; w++) {
        const wx = riderX + (w === 0 ? -25 : 25) * riderScale;
        const wy = riderY + 15 + bobble;
        ctx.strokeStyle = "rgba(150,150,150,0.3)";
        ctx.lineWidth = 1;
        for (let s = 0; s < 6; s++) {
          const a = spokeAngle + (s * Math.PI) / 3;
          ctx.beginPath();
          ctx.moveTo(wx, wy);
          ctx.lineTo(wx + Math.cos(a) * 16 * riderScale, wy + Math.sin(a) * 16 * riderScale);
          ctx.stroke();
        }
      }

      // Frame
      ctx.strokeStyle = "#e74c3c";
      ctx.lineWidth = 3;
      ctx.beginPath();
      // chainstay to seat tube
      ctx.moveTo(riderX - 25 * riderScale, riderY + 15 + bobble);
      ctx.lineTo(riderX - 5 * riderScale, riderY - 10 + bobble);
      // seat tube
      ctx.lineTo(riderX - 5 * riderScale, riderY - 25 + bobble);
      ctx.stroke();
      ctx.beginPath();
      // top tube
      ctx.moveTo(riderX - 5 * riderScale, riderY - 10 + bobble);
      ctx.lineTo(riderX + 15 * riderScale, riderY - 10 + bobble);
      // down tube
      ctx.moveTo(riderX - 5 * riderScale, riderY - 10 + bobble);
      ctx.lineTo(riderX + 25 * riderScale, riderY + 15 + bobble);
      // fork
      ctx.moveTo(riderX + 15 * riderScale, riderY - 10 + bobble);
      ctx.lineTo(riderX + 25 * riderScale, riderY + 15 + bobble);
      ctx.stroke();

      // Handlebars
      ctx.strokeStyle = "#888";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(riderX + 12 * riderScale, riderY - 14 + bobble);
      ctx.lineTo(riderX + 20 * riderScale, riderY - 18 + bobble);
      ctx.stroke();

      // Rider body
      const legCycle = Math.sin(elapsed * 0.3);

      // Body
      ctx.fillStyle = "#2980b9";
      ctx.beginPath();
      ctx.ellipse(riderX + 3, riderY - 30 + bobble, 8, 14, -0.2, 0, Math.PI * 2);
      ctx.fill();

      // Head
      ctx.fillStyle = "#f5d5a0";
      ctx.beginPath();
      ctx.arc(riderX + 10, riderY - 48 + bobble, 7, 0, Math.PI * 2);
      ctx.fill();

      // Helmet
      ctx.fillStyle = "#e74c3c";
      ctx.beginPath();
      ctx.ellipse(riderX + 10, riderY - 52 + bobble, 9, 5, -0.1, Math.PI, Math.PI * 2);
      ctx.fill();

      // Legs (animated pedaling)
      ctx.strokeStyle = "#1a1a1a";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      // Left leg
      ctx.beginPath();
      ctx.moveTo(riderX - 3, riderY - 18 + bobble);
      ctx.lineTo(riderX - 10 + legCycle * 8, riderY + 5 + bobble + legCycle * 5);
      ctx.lineTo(riderX - 25 * riderScale + legCycle * 5, riderY + 15 + bobble);
      ctx.stroke();
      // Right leg
      ctx.beginPath();
      ctx.moveTo(riderX - 3, riderY - 18 + bobble);
      ctx.lineTo(riderX - 10 - legCycle * 8, riderY + 5 + bobble - legCycle * 5);
      ctx.lineTo(riderX - 25 * riderScale - legCycle * 5, riderY + 15 + bobble);
      ctx.stroke();

      // Arms
      ctx.strokeStyle = "#f5d5a0";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(riderX + 5, riderY - 38 + bobble);
      ctx.lineTo(riderX + 15, riderY - 18 + bobble);
      ctx.stroke();

      // ── Elevation label ──
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.font = "12px monospace";
      ctx.fillText(`${elevation.toFixed(0)}m`, W - 60, 25);
      ctx.fillText(`${gradient > 0 ? "+" : ""}${gradient.toFixed(1)}%`, W - 60, 42);

      animRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      running = false;
      cancelAnimationFrame(animRef.current);
    };
  }, [gradient, speed, elevation, elapsed]);

  return (
    <canvas
      ref={canvasRef}
      width={900}
      height={400}
      style={{
        width: "100%",
        height: "100%",
        borderRadius: 12,
        display: "block",
      }}
    />
  );
}

// ── Metric Card ─────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  unit,
  color,
  size = "normal",
  subtext,
}: {
  label: string;
  value: string | number;
  unit: string;
  color: string;
  size?: "normal" | "large";
  subtext?: string;
}) {
  return (
    <div
      style={{
        background: "rgba(20, 25, 50, 0.85)",
        borderRadius: 12,
        padding: size === "large" ? "16px 20px" : "12px 16px",
        backdropFilter: "blur(10px)",
        border: `1px solid ${color}33`,
        minWidth: size === "large" ? 140 : 110,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 10, color: "#8a8a9a", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: size === "large" ? 36 : 28, fontWeight: 800, color, lineHeight: 1, fontFamily: "monospace" }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: "#6a6a7a", marginTop: 2 }}>{unit}</div>
      {subtext && <div style={{ fontSize: 10, color: color + "aa", marginTop: 4 }}>{subtext}</div>}
    </div>
  );
}

// ── Zone Bar ────────────────────────────────────────────────────────

function ZoneBar({
  label,
  value,
  zones,
}: {
  label: string;
  value: number;
  zones: ZoneInfo[];
}) {
  const currentZone = (() => {
    for (let i = zones.length - 1; i >= 0; i--) {
      if (value >= zones[i].min) return zones[i];
    }
    return zones[0];
  })();

  const maxVal = zones[zones.length - 1].min * 1.2;
  const fillPct = Math.min(100, (value / maxVal) * 100);

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: "#8a8a9a", textTransform: "uppercase", letterSpacing: 1 }}>{label}</span>
        <span style={{ fontSize: 11, color: currentZone.color, fontWeight: 700 }}>
          Z{currentZone.zone} · {currentZone.name}
        </span>
      </div>
      <div style={{ height: 8, background: "rgba(255,255,255,0.08)", borderRadius: 4, overflow: "hidden", position: "relative" }}>
        {/* Zone segments */}
        <div style={{ position: "absolute", inset: 0, display: "flex" }}>
          {zones.map((z, i) => {
            const nextMin = zones[i + 1]?.min ?? maxVal;
            const width = ((nextMin - z.min) / maxVal) * 100;
            return (
              <div
                key={z.zone}
                style={{
                  width: `${width}%`,
                  background: z.color + "15",
                  borderRight: `1px solid ${z.color}30`,
                }}
              />
            );
          })}
        </div>
        {/* Fill */}
        <div
          style={{
            height: "100%",
            width: `${fillPct}%`,
            background: `linear-gradient(90deg, ${currentZone.color}88, ${currentZone.color})`,
            borderRadius: 4,
            transition: "width 0.5s ease, background 0.5s ease",
            position: "relative",
            zIndex: 1,
          }}
        />
      </div>
    </div>
  );
}

// ── Elevation Profile ───────────────────────────────────────────────

function ElevationProfile({ history }: { history: RideData[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || history.length < 2) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    const elevations = history.map((h) => h.elevation);
    const minE = Math.min(...elevations) - 10;
    const maxE = Math.max(...elevations) + 10;
    const range = maxE - minE || 1;

    // Draw gradient fill
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "rgba(231, 76, 60, 0.4)");
    grad.addColorStop(0.5, "rgba(46, 204, 113, 0.2)");
    grad.addColorStop(1, "rgba(46, 204, 113, 0)");

    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let i = 0; i < history.length; i++) {
      const x = (i / (history.length - 1)) * W;
      const y = H - ((elevations[i] - minE) / range) * (H - 10);
      if (i === 0) ctx.lineTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Draw line
    ctx.beginPath();
    for (let i = 0; i < history.length; i++) {
      const x = (i / (history.length - 1)) * W;
      const y = H - ((elevations[i] - minE) / range) * (H - 10);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "#e74c3c";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Current position marker
    const lastX = W;
    const lastY = H - ((elevations[elevations.length - 1] - minE) / range) * (H - 10);
    ctx.beginPath();
    ctx.arc(lastX - 2, lastY, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#e74c3c";
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [history]);

  return (
    <canvas
      ref={canvasRef}
      width={500}
      height={80}
      style={{
        width: "100%",
        height: 80,
        borderRadius: 8,
        display: "block",
      }}
    />
  );
}

// ── Power Graph ─────────────────────────────────────────────────────

function PowerGraph({ history }: { history: RideData[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || history.length < 2) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const powers = history.map((h) => h.power);
    const maxP = Math.max(...powers, 300);

    // Zone background bands
    POWER_ZONES.forEach((z, i) => {
      const nextMin = POWER_ZONES[i + 1]?.min ?? maxP * 1.1;
      const y1 = H - (Math.min(nextMin, maxP * 1.1) / (maxP * 1.1)) * H;
      const y2 = H - (z.min / (maxP * 1.1)) * H;
      ctx.fillStyle = z.color + "08";
      ctx.fillRect(0, y1, W, y2 - y1);
    });

    // Power bars
    const barWidth = Math.max(1, W / history.length);
    for (let i = 0; i < history.length; i++) {
      const x = (i / history.length) * W;
      const barH = (powers[i] / (maxP * 1.1)) * H;
      const zone = getPowerZone(powers[i]);
      ctx.fillStyle = zone.color + "88";
      ctx.fillRect(x, H - barH, barWidth + 0.5, barH);
    }
  }, [history]);

  return (
    <canvas
      ref={canvasRef}
      width={500}
      height={80}
      style={{
        width: "100%",
        height: 80,
        borderRadius: 8,
        display: "block",
      }}
    />
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
    setMessages((prev) => [msg, ...prev].slice(0, 8));
  }, []);

  // Connect to mock WebSocket for real-time data
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
      } catch { /* ignore parse errors */ }
    };

    ws.onclose = () => {
      // If still riding, the WS closed unexpectedly — fall back to local
      wsRef.current = null;
    };

    return ws;
  }, [addCoachMessage]);

  const startRide = useCallback(() => {
    setRiding(true);
    setHistory([]);
    setMessages([]);
    addCoachMessage("Ride started! Let's warm up with an easy spin.", "info");

    // Try WebSocket first
    try {
      connectWS();
    } catch { /* ignore */ }

    // Also run local mock generator as fallback / primary source
    const gen = createMockRideGenerator();
    generatorRef.current = gen;

    let tickCount = 0;
    intervalRef.current = setInterval(() => {
      const rd = gen();
      setData(rd);
      setHistory((prev) => [...prev.slice(-300), rd]);
      tickCount++;

      // Coach messages every ~15-20 seconds
      if (tickCount % (15 + Math.floor(Math.random() * 10)) === 0) {
        const cm = COACH_MESSAGES[Math.floor(Math.random() * COACH_MESSAGES.length)];
        addCoachMessage(cm.text, cm.type);
      }
    }, 1000);
  }, [addCoachMessage, connectWS]);

  const stopRide = useCallback(() => {
    setRiding(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    addCoachMessage("Ride complete! Great work 💪", "motivation");
  }, [addCoachMessage]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const hrZone = data ? getHRZone(data.heartRate) : HR_ZONES[0];
  const powerZone = data ? getPowerZone(data.power) : POWER_ZONES[0];

  // ── Pre-ride screen ──
  if (!riding && !data) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "linear-gradient(135deg, #0a0e1a 0%, #1a1a2e 40%, #0f1923 100%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        {/* Animated background circles */}
        <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                borderRadius: "50%",
                border: `1px solid rgba(231, 76, 60, ${0.05 + i * 0.02})`,
                width: 200 + i * 150,
                height: 200 + i * 150,
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
                animation: `pulse ${3 + i * 0.5}s ease-in-out infinite`,
              }}
            />
          ))}
        </div>

        <div style={{ fontSize: 14, color: "#e74c3c", letterSpacing: 6, textTransform: "uppercase", marginBottom: 8 }}>
          Voice Coach
        </div>
        <h1
          style={{
            fontSize: 64,
            fontWeight: 900,
            background: "linear-gradient(135deg, #e74c3c, #f39c12, #e74c3c)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            marginBottom: 16,
            letterSpacing: -2,
          }}
        >
          RIDE
        </h1>
        <p style={{ color: "#6a6a8a", fontSize: 16, marginBottom: 48, maxWidth: 400, textAlign: "center", lineHeight: 1.6 }}>
          Real-time cycling metrics, AI coaching, and immersive visualization. Push your limits.
        </p>

        <button
          onClick={startRide}
          style={{
            padding: "16px 64px",
            fontSize: 18,
            fontWeight: 700,
            color: "#fff",
            background: "linear-gradient(135deg, #e74c3c, #c0392b)",
            border: "none",
            borderRadius: 50,
            cursor: "pointer",
            letterSpacing: 3,
            textTransform: "uppercase",
            boxShadow: "0 4px 30px rgba(231, 76, 60, 0.4)",
            transition: "all 0.3s ease",
          }}
          onMouseEnter={(e) => {
            (e.target as HTMLButtonElement).style.transform = "scale(1.05)";
            (e.target as HTMLButtonElement).style.boxShadow = "0 6px 40px rgba(231, 76, 60, 0.6)";
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLButtonElement).style.transform = "scale(1)";
            (e.target as HTMLButtonElement).style.boxShadow = "0 4px 30px rgba(231, 76, 60, 0.4)";
          }}
        >
          Start Ride
        </button>

        <div style={{ marginTop: 48, display: "flex", gap: 40, color: "#4a4a6a", fontSize: 13 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>🚴</div>
            <div>Live Metrics</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>🎯</div>
            <div>Zone Training</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>🗣️</div>
            <div>AI Coach</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>📊</div>
            <div>Real-time Graphs</div>
          </div>
        </div>

        {/* CSS animation */}
        <style>{`
          @keyframes pulse {
            0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.5; }
            50% { transform: translate(-50%, -50%) scale(1.05); opacity: 1; }
          }
        `}</style>
      </div>
    );
  }

  // ── Active ride / post-ride screen ──
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#0a0e1a",
        display: "flex",
        flexDirection: "column",
        zIndex: 1000,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        overflow: "hidden",
      }}
    >
      {/* ── Top bar ── */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 20px",
          background: "rgba(10, 14, 26, 0.9)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ color: "#e74c3c", fontWeight: 800, fontSize: 16, letterSpacing: 1 }}>🚴 RIDE</span>
          {data && (
            <span style={{ color: "#4a4a6a", fontSize: 13, fontFamily: "monospace" }}>
              {formatTime(data.elapsedTime)}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a
            href="#status"
            style={{
              padding: "6px 16px",
              background: "rgba(255,255,255,0.06)",
              color: "#8a8a9a",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 12,
              textDecoration: "none",
            }}
          >
            ← Dashboard
          </a>
          <button
            onClick={riding ? stopRide : startRide}
            style={{
              padding: "6px 20px",
              background: riding
                ? "linear-gradient(135deg, #e74c3c, #c0392b)"
                : "linear-gradient(135deg, #2ecc71, #27ae60)",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 1,
            }}
          >
            {riding ? "■ STOP" : "▶ START"}
          </button>
        </div>
      </div>

      {/* ── Main content ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* ── Left: 3D Road + Metrics ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", position: "relative" }}>
          {/* Road visualization */}
          <div style={{ flex: 1, position: "relative" }}>
            <RoadCanvas
              gradient={data?.gradient ?? 0}
              speed={data?.speed ?? 0}
              elevation={data?.elevation ?? 150}
              elapsed={data?.elapsedTime ?? 0}
            />

            {/* Overlay metrics on road */}
            <div
              style={{
                position: "absolute",
                top: 16,
                left: 16,
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <MetricCard
                label="Speed"
                value={data?.speed.toFixed(1) ?? "0.0"}
                unit="km/h"
                color="#4a9eff"
                size="large"
              />
              <MetricCard
                label="Power"
                value={data?.power ?? 0}
                unit="watts"
                color={powerZone.color}
                size="large"
                subtext={`Z${powerZone.zone} ${powerZone.name}`}
              />
            </div>

            <div
              style={{
                position: "absolute",
                top: 16,
                right: 16,
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <MetricCard
                label="Heart Rate"
                value={data?.heartRate ?? 0}
                unit="bpm"
                color={hrZone.color}
                subtext={`Z${hrZone.zone} ${hrZone.name}`}
              />
              <MetricCard
                label="Cadence"
                value={data?.cadence ?? 0}
                unit="rpm"
                color="#9b59b6"
              />
            </div>

            {/* Bottom overlay: distance, calories, time */}
            <div
              style={{
                position: "absolute",
                bottom: 16,
                left: 16,
                right: 16,
                display: "flex",
                gap: 10,
                justifyContent: "center",
              }}
            >
              <MetricCard label="Distance" value={data?.distance.toFixed(2) ?? "0.00"} unit="km" color="#2ecc71" />
              <MetricCard label="Calories" value={data?.calories ?? 0} unit="kcal" color="#f39c12" />
              <MetricCard label="Time" value={data ? formatTime(data.elapsedTime) : "0:00"} unit="" color="#fff" />
              <MetricCard label="Gradient" value={`${(data?.gradient ?? 0) > 0 ? "+" : ""}${(data?.gradient ?? 0).toFixed(1)}`} unit="%" color={data && data.gradient > 3 ? "#e74c3c" : data && data.gradient < -3 ? "#4a9eff" : "#2ecc71"} />
            </div>
          </div>

          {/* Zone bars + graphs */}
          <div
            style={{
              padding: "12px 20px",
              background: "rgba(15, 18, 35, 0.95)",
              borderTop: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <div style={{ display: "flex", gap: 24 }}>
              <div style={{ flex: 1 }}>
                <ZoneBar label="Heart Rate" value={data?.heartRate ?? 0} zones={HR_ZONES} />
                <ZoneBar label="Power" value={data?.power ?? 0} zones={POWER_ZONES} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: "#6a6a7a", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
                  Elevation Profile
                </div>
                <ElevationProfile history={history} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: "#6a6a7a", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
                  Power Output
                </div>
                <PowerGraph history={history} />
              </div>
            </div>
          </div>
        </div>

        {/* ── Right: Coach Messages ── */}
        <div
          style={{
            width: 280,
            background: "rgba(12, 15, 30, 0.95)",
            borderLeft: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={{ fontSize: 16 }}>🗣️</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#e0e0e0", letterSpacing: 1 }}>VOICE COACH</span>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: riding ? "#2ecc71" : "#e74c3c",
                marginLeft: "auto",
                animation: riding ? "coachPulse 2s ease-in-out infinite" : "none",
              }}
            />
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px" }}>
            {messages.map((msg, i) => {
              const typeConfig = {
                info: { bg: "rgba(74, 158, 255, 0.1)", border: "#4a9eff", icon: "ℹ️" },
                warning: { bg: "rgba(243, 156, 18, 0.1)", border: "#f39c12", icon: "⚠️" },
                motivation: { bg: "rgba(46, 204, 113, 0.1)", border: "#2ecc71", icon: "💪" },
                zone: { bg: "rgba(155, 89, 182, 0.1)", border: "#9b59b6", icon: "🎯" },
              }[msg.type];

              return (
                <div
                  key={msg.id}
                  style={{
                    padding: "10px 12px",
                    marginBottom: 8,
                    borderRadius: 8,
                    background: typeConfig.bg,
                    borderLeft: `3px solid ${typeConfig.border}`,
                    opacity: i === 0 ? 1 : Math.max(0.3, 1 - i * 0.12),
                    transition: "opacity 0.5s ease",
                  }}
                >
                  <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                    <span style={{ fontSize: 14 }}>{typeConfig.icon}</span>
                    <div>
                      <div style={{ fontSize: 12, color: "#d0d0d0", lineHeight: 1.5 }}>{msg.text}</div>
                      <div style={{ fontSize: 9, color: "#5a5a6a", marginTop: 4 }}>
                        {new Date(msg.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {messages.length === 0 && (
              <div style={{ textAlign: "center", color: "#4a4a5a", fontSize: 12, marginTop: 40 }}>
                Coach messages will appear here during your ride.
              </div>
            )}
          </div>

          {/* Ride summary (bottom of coach panel) */}
          {data && (
            <div
              style={{
                padding: "12px 16px",
                borderTop: "1px solid rgba(255,255,255,0.06)",
                background: "rgba(10, 12, 25, 0.95)",
              }}
            >
              <div style={{ fontSize: 10, color: "#5a5a6a", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
                Ride Stats
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[
                  { label: "Avg Power", value: `${history.length > 0 ? Math.round(history.reduce((a, b) => a + b.power, 0) / history.length) : 0}W` },
                  { label: "Avg HR", value: `${history.length > 0 ? Math.round(history.reduce((a, b) => a + b.heartRate, 0) / history.length) : 0}` },
                  { label: "Max Power", value: `${history.length > 0 ? Math.max(...history.map((h) => h.power)) : 0}W` },
                  { label: "Max Speed", value: `${history.length > 0 ? Math.max(...history.map((h) => h.speed)).toFixed(1) : 0}` },
                ].map((s) => (
                  <div key={s.label} style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 9, color: "#5a5a6a" }}>{s.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#b0b0c0", fontFamily: "monospace" }}>{s.value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* CSS animations */}
      <style>{`
        @keyframes coachPulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(46, 204, 113, 0.4); }
          50% { opacity: 0.7; box-shadow: 0 0 0 6px rgba(46, 204, 113, 0); }
        }
      `}</style>
    </div>
  );
}
