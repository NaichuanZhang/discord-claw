import React, { useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { RideData, CoachMessage, ZoneInfo } from "./types";
import { HR_ZONES, POWER_ZONES } from "./constants";
import { formatTime, getHRZone, getPowerZone } from "./helpers";

// ═══════════════════════════════════════════════════════════════════════
// Metric Card (glass morphism + animated counter)
// ═══════════════════════════════════════════════════════════════════════

function MetricCard({
  label,
  value,
  unit,
  color,
  size = "normal",
  subtext,
  icon,
}: {
  label: string;
  value: string | number;
  unit: string;
  color: string;
  size?: "normal" | "large" | "hero";
  subtext?: string;
  icon?: string;
}) {
  const fontSize = size === "hero" ? 52 : size === "large" ? 38 : 28;
  const padding = size === "hero" ? "20px 28px" : size === "large" ? "14px 20px" : "10px 14px";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      style={{
        background: "rgba(8, 12, 30, 0.75)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderRadius: 16,
        padding,
        border: `1px solid ${color}22`,
        boxShadow: `0 4px 30px ${color}11, inset 0 1px 0 rgba(255,255,255,0.05)`,
        minWidth: size === "hero" ? 180 : size === "large" ? 140 : 100,
        textAlign: "center",
        position: "relative" as const,
        overflow: "hidden",
      }}
    >
      {/* Glow accent line at top */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: "15%",
          right: "15%",
          height: 2,
          background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
          opacity: 0.6,
        }}
      />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, marginBottom: 4 }}>
        {icon && <span style={{ fontSize: 12 }}>{icon}</span>}
        <span
          style={{
            fontSize: 9,
            color: "#6a7a9a",
            textTransform: "uppercase",
            letterSpacing: 2,
            fontWeight: 600,
          }}
        >
          {label}
        </span>
      </div>
      <motion.div
        key={String(value)}
        initial={{ opacity: 0.5, y: -5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        style={{
          fontSize,
          fontWeight: 900,
          color,
          lineHeight: 1,
          fontFamily: "'SF Mono', 'Fira Code', monospace",
          textShadow: `0 0 20px ${color}44`,
        }}
      >
        {value}
      </motion.div>
      <div style={{ fontSize: 10, color: "#5a6a8a", marginTop: 3, fontWeight: 500 }}>{unit}</div>
      {subtext && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          style={{
            fontSize: 9,
            color: color + "cc",
            marginTop: 4,
            fontWeight: 600,
            letterSpacing: 0.5,
          }}
        >
          {subtext}
        </motion.div>
      )}
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Zone Progress Bar
// ═══════════════════════════════════════════════════════════════════════

function ZoneBar({ label, value, zones }: { label: string; value: number; zones: ZoneInfo[] }) {
  const currentZone = (() => {
    for (let i = zones.length - 1; i >= 0; i--) {
      if (value >= zones[i].min) return zones[i];
    }
    return zones[0];
  })();

  const maxVal = zones[zones.length - 1].min * 1.2;
  const fillPct = Math.min(100, (value / maxVal) * 100);

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ fontSize: 9, color: "#6a7a9a", textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 600 }}>
          {label}
        </span>
        <motion.span
          key={currentZone.zone}
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          style={{ fontSize: 9, color: currentZone.color, fontWeight: 700 }}
        >
          Z{currentZone.zone} · {currentZone.name}
        </motion.span>
      </div>
      <div
        style={{
          height: 6,
          background: "rgba(255,255,255,0.04)",
          borderRadius: 3,
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div style={{ position: "absolute", inset: 0, display: "flex" }}>
          {zones.map((z, i) => {
            const nextMin = zones[i + 1]?.min ?? maxVal;
            const width = ((nextMin - z.min) / maxVal) * 100;
            return (
              <div
                key={z.zone}
                style={{
                  width: `${width}%`,
                  background: z.color + "08",
                  borderRight: `1px solid ${z.color}15`,
                }}
              />
            );
          })}
        </div>
        <motion.div
          animate={{ width: `${fillPct}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          style={{
            height: "100%",
            background: `linear-gradient(90deg, ${currentZone.color}66, ${currentZone.color})`,
            borderRadius: 3,
            position: "relative",
            zIndex: 1,
            boxShadow: `0 0 12px ${currentZone.color}44`,
          }}
        />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Mini Chart (sparkline)
// ═══════════════════════════════════════════════════════════════════════

function MiniChart({
  data,
  color,
  height = 60,
  filled = true,
}: {
  data: number[];
  color: string;
  height?: number;
  filled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length < 2) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const min = Math.min(...data) - 5;
    const max = Math.max(...data) + 5;
    const range = max - min || 1;

    // Filled area
    if (filled) {
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, color + "44");
      grad.addColorStop(1, color + "00");
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let i = 0; i < data.length; i++) {
        const x = (i / (data.length - 1)) * W;
        const y = H - ((data[i] - min) / range) * (H - 4);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // Line
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = (i / (data.length - 1)) * W;
      const y = H - ((data[i] - min) / range) * (H - 4);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Endpoint glow
    const lastX = W;
    const lastY = H - ((data[data.length - 1] - min) / range) * (H - 4);
    ctx.beginPath();
    ctx.arc(lastX - 1, lastY, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(lastX - 1, lastY, 6, 0, Math.PI * 2);
    ctx.fillStyle = color + "33";
    ctx.fill();
  }, [data, color, height, filled]);

  return (
    <canvas
      ref={canvasRef}
      width={400}
      height={height}
      style={{ width: "100%", height, borderRadius: 8, display: "block" }}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Heart Rate Ring (circular gauge)
// ═══════════════════════════════════════════════════════════════════════

function HeartRateRing({ hr, maxHR = 200 }: { hr: number; maxHR?: number }) {
  const zone = getHRZone(hr);
  const pct = Math.min(1, hr / maxHR);
  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const strokeDash = circumference * pct;

  return (
    <div style={{ position: "relative", width: 80, height: 80 }}>
      <svg width={80} height={80} style={{ transform: "rotate(-90deg)" }}>
        {/* Background circle */}
        <circle cx={40} cy={40} r={radius} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={4} />
        {/* Progress arc */}
        <motion.circle
          cx={40}
          cy={40}
          r={radius}
          fill="none"
          stroke={zone.color}
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={circumference}
          animate={{ strokeDashoffset: circumference - strokeDash }}
          transition={{ duration: 0.5 }}
          style={{ filter: `drop-shadow(0 0 6px ${zone.color}66)` }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={{ fontSize: 8, color: "#6a7a9a" }}>❤️</span>
        <span
          style={{
            fontSize: 18,
            fontWeight: 900,
            color: zone.color,
            fontFamily: "monospace",
            lineHeight: 1,
          }}
        >
          {hr}
        </span>
        <span style={{ fontSize: 7, color: "#5a6a8a" }}>bpm</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Coach Messages Panel
// ═══════════════════════════════════════════════════════════════════════

function CoachPanel({ messages, riding }: { messages: CoachMessage[]; riding: boolean }) {
  const typeConfig: Record<string, { bg: string; border: string; icon: string }> = {
    info: { bg: "rgba(74, 158, 255, 0.08)", border: "#4a9eff", icon: "ℹ️" },
    warning: { bg: "rgba(243, 156, 18, 0.08)", border: "#f39c12", icon: "⚠️" },
    motivation: { bg: "rgba(46, 204, 113, 0.08)", border: "#2ecc71", icon: "🔥" },
    zone: { bg: "rgba(155, 89, 182, 0.08)", border: "#9b59b6", icon: "🎯" },
  };

  return (
    <div
      style={{
        background: "rgba(8, 12, 30, 0.85)",
        backdropFilter: "blur(20px)",
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.06)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        maxHeight: "100%",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.04)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 14 }}>🗣️</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#c0d0e0", letterSpacing: 1.5 }}>AI COACH</span>
        <motion.div
          animate={{
            scale: riding ? [1, 1.3, 1] : 1,
            opacity: riding ? [1, 0.5, 1] : 0.3,
          }}
          transition={{ duration: 2, repeat: Infinity }}
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: riding ? "#2ecc71" : "#555",
            marginLeft: "auto",
          }}
        />
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "6px 10px" }}>
        <AnimatePresence mode="popLayout">
          {messages.map((msg, i) => {
            const cfg = typeConfig[msg.type] || typeConfig.info;
            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, x: 30, height: 0 }}
                animate={{ opacity: Math.max(0.3, 1 - i * 0.15), x: 0, height: "auto" }}
                exit={{ opacity: 0, x: -20, height: 0 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                style={{
                  padding: "8px 10px",
                  marginBottom: 6,
                  borderRadius: 10,
                  background: cfg.bg,
                  borderLeft: `3px solid ${cfg.border}`,
                }}
              >
                <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 12, lineHeight: 1.4 }}>{cfg.icon}</span>
                  <div>
                    <div style={{ fontSize: 11, color: "#c0d0e0", lineHeight: 1.5 }}>{msg.text}</div>
                    <div style={{ fontSize: 8, color: "#4a5a7a", marginTop: 3 }}>
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", color: "#3a4a5a", fontSize: 11, marginTop: 30, lineHeight: 1.8 }}>
            Coach messages will<br />appear here during<br />your ride.
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Main HUD Export
// ═══════════════════════════════════════════════════════════════════════

interface HUDProps {
  data: RideData | null;
  history: RideData[];
  messages: CoachMessage[];
  riding: boolean;
  onStop: () => void;
  onStart: () => void;
}

export default function HUD({ data, history, messages, riding, onStop, onStart }: HUDProps) {
  const hrZone = data ? getHRZone(data.heartRate) : HR_ZONES[0];
  const powerZone = data ? getPowerZone(data.power) : POWER_ZONES[0];

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        display: "flex",
        flexDirection: "column",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {/* ── Top Bar ── */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 20px",
          pointerEvents: "auto",
          background: "linear-gradient(180deg, rgba(8,12,30,0.8) 0%, transparent 100%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 20, fontWeight: 900, color: "#e74c3c", letterSpacing: 1 }}>⚡ RIDE</span>
          {data && (
            <span
              style={{
                fontSize: 13,
                color: "#8a9aba",
                fontFamily: "monospace",
                background: "rgba(255,255,255,0.05)",
                padding: "3px 10px",
                borderRadius: 6,
              }}
            >
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
              color: "#8a9aba",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 11,
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            ← Dashboard
          </a>
          <button
            onClick={riding ? onStop : onStart}
            style={{
              padding: "6px 20px",
              background: riding
                ? "linear-gradient(135deg, #e74c3c, #c0392b)"
                : "linear-gradient(135deg, #2ecc71, #27ae60)",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 1.5,
              boxShadow: riding ? "0 2px 15px rgba(231,76,60,0.3)" : "0 2px 15px rgba(46,204,113,0.3)",
            }}
          >
            {riding ? "■ STOP" : "▶ START"}
          </button>
        </div>
      </div>

      {/* ── Main metrics overlay ── */}
      <div style={{ flex: 1, display: "flex", position: "relative" }}>
        {/* Left column: primary metrics */}
        <div
          style={{
            position: "absolute",
            top: 10,
            left: 20,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            pointerEvents: "auto",
          }}
        >
          <MetricCard
            label="Speed"
            value={data?.speed.toFixed(1) ?? "0.0"}
            unit="km/h"
            color="#4af"
            size="hero"
            icon="🏎"
          />
          <MetricCard
            label="Power"
            value={data?.power ?? 0}
            unit="watts"
            color={powerZone.color}
            size="large"
            subtext={`Z${powerZone.zone} ${powerZone.name}`}
            icon="⚡"
          />
          <MetricCard
            label="Cadence"
            value={data?.cadence ?? 0}
            unit="rpm"
            color="#9b59b6"
            icon="🔄"
          />
        </div>

        {/* Right column: HR ring + coach */}
        <div
          style={{
            position: "absolute",
            top: 10,
            right: 20,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            width: 240,
            pointerEvents: "auto",
            maxHeight: "calc(100% - 20px)",
          }}
        >
          {/* HR Ring */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: "rgba(8,12,30,0.75)",
              backdropFilter: "blur(20px)",
              borderRadius: 16,
              padding: "10px 14px",
              border: `1px solid ${hrZone.color}22`,
            }}
          >
            <HeartRateRing hr={data?.heartRate ?? 0} />
            <div>
              <div style={{ fontSize: 9, color: "#6a7a9a", letterSpacing: 1.5, fontWeight: 600 }}>HEART RATE</div>
              <div style={{ fontSize: 10, color: hrZone.color, fontWeight: 700, marginTop: 2 }}>
                Z{hrZone.zone} · {hrZone.name}
              </div>
            </div>
          </div>

          {/* Coach panel */}
          <CoachPanel messages={messages} riding={riding} />
        </div>

        {/* Bottom center: secondary metrics & graphs */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            pointerEvents: "auto",
            background: "linear-gradient(0deg, rgba(8,12,30,0.9) 0%, rgba(8,12,30,0.6) 70%, transparent 100%)",
            padding: "30px 20px 14px",
          }}
        >
          <div style={{ display: "flex", gap: 16, alignItems: "flex-end" }}>
            {/* Small stats */}
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <MetricCard label="Distance" value={data?.distance.toFixed(2) ?? "0.00"} unit="km" color="#2ecc71" icon="📍" />
              <MetricCard label="Elevation" value={data?.elevation.toFixed(0) ?? "0"} unit="m" color="#e67e22" icon="⛰" />
              <MetricCard
                label="Gradient"
                value={`${(data?.gradient ?? 0) > 0 ? "+" : ""}${(data?.gradient ?? 0).toFixed(1)}`}
                unit="%"
                color={data && data.gradient > 3 ? "#e74c3c" : data && data.gradient < -3 ? "#4af" : "#2ecc71"}
                icon="📐"
              />
              <MetricCard label="Calories" value={data?.calories ?? 0} unit="kcal" color="#f39c12" icon="🔥" />
            </div>

            {/* Charts */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <ZoneBar label="Heart Rate" value={data?.heartRate ?? 0} zones={HR_ZONES} />
                  <ZoneBar label="Power" value={data?.power ?? 0} zones={POWER_ZONES} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 8, color: "#5a6a7a", letterSpacing: 1.5, marginBottom: 2, fontWeight: 600 }}>
                    ELEVATION
                  </div>
                  <MiniChart data={history.map((h) => h.elevation)} color="#e67e22" height={45} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 8, color: "#5a6a7a", letterSpacing: 1.5, marginBottom: 2, fontWeight: 600 }}>
                    POWER
                  </div>
                  <MiniChart data={history.map((h) => h.power)} color="#e74c3c" height={45} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 8, color: "#5a6a7a", letterSpacing: 1.5, marginBottom: 2, fontWeight: 600 }}>
                    HEART RATE
                  </div>
                  <MiniChart data={history.map((h) => h.heartRate)} color="#e74c3c" height={45} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
