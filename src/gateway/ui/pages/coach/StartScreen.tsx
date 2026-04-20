import React from "react";
import { motion } from "framer-motion";

// ═══════════════════════════════════════════════════════════════════════
// Cinematic Start Screen
// ═══════════════════════════════════════════════════════════════════════

export default function StartScreen({ onStart }: { onStart: () => void }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "radial-gradient(ellipse at 50% 30%, #0f1a2e 0%, #080c1a 50%, #050812 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif",
        overflow: "hidden",
      }}
    >
      {/* Animated grid background */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `
            linear-gradient(rgba(231,76,60,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(231,76,60,0.03) 1px, transparent 1px)
          `,
          backgroundSize: "40px 40px",
          animation: "gridMove 20s linear infinite",
        }}
      />

      {/* Pulse rings */}
      {[...Array(6)].map((_, i) => (
        <motion.div
          key={i}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{
            scale: [1, 1.15, 1],
            opacity: [0.05 + i * 0.015, 0.08 + i * 0.02, 0.05 + i * 0.015],
          }}
          transition={{
            duration: 3 + i * 0.7,
            repeat: Infinity,
            ease: "easeInOut",
            delay: i * 0.3,
          }}
          style={{
            position: "absolute",
            borderRadius: "50%",
            border: `1px solid rgba(231, 76, 60, ${0.08 + i * 0.02})`,
            width: 200 + i * 130,
            height: 200 + i * 130,
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
          }}
        />
      ))}

      {/* Floating particles */}
      {[...Array(20)].map((_, i) => (
        <motion.div
          key={`p${i}`}
          animate={{
            y: [0, -20, 0],
            x: [0, Math.sin(i) * 10, 0],
            opacity: [0.1, 0.4, 0.1],
          }}
          transition={{
            duration: 3 + Math.random() * 4,
            repeat: Infinity,
            delay: Math.random() * 5,
          }}
          style={{
            position: "absolute",
            width: 2 + Math.random() * 3,
            height: 2 + Math.random() * 3,
            borderRadius: "50%",
            background: i % 3 === 0 ? "#e74c3c" : i % 3 === 1 ? "#4a9eff" : "#fff",
            left: `${10 + Math.random() * 80}%`,
            top: `${10 + Math.random() * 80}%`,
          }}
        />
      ))}

      {/* Content */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, ease: "easeOut" }}
        style={{ textAlign: "center", zIndex: 1 }}
      >
        <motion.div
          initial={{ opacity: 0, letterSpacing: 20 }}
          animate={{ opacity: 1, letterSpacing: 8 }}
          transition={{ duration: 1.5, ease: "easeOut" }}
          style={{
            fontSize: 12,
            color: "#e74c3c",
            textTransform: "uppercase",
            marginBottom: 8,
            fontWeight: 600,
          }}
        >
          Cycling Voice Coach
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.3, ease: "easeOut" }}
          style={{
            fontSize: 80,
            fontWeight: 900,
            background: "linear-gradient(135deg, #e74c3c 0%, #f39c12 50%, #e74c3c 100%)",
            backgroundSize: "200% 200%",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            marginBottom: 16,
            letterSpacing: -3,
            lineHeight: 1,
            animation: "shimmer 3s ease-in-out infinite",
          }}
        >
          RIDE
        </motion.h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.8 }}
          style={{
            color: "#5a6a8a",
            fontSize: 15,
            marginBottom: 48,
            maxWidth: 420,
            textAlign: "center",
            lineHeight: 1.7,
            fontWeight: 400,
          }}
        >
          Immersive 3D cycling visualization with real-time metrics,
          AI coaching, and zone training. Push your limits.
        </motion.p>

        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9, duration: 0.6 }}
          whileHover={{ scale: 1.05, boxShadow: "0 8px 50px rgba(231, 76, 60, 0.5)" }}
          whileTap={{ scale: 0.98 }}
          onClick={onStart}
          style={{
            padding: "18px 72px",
            fontSize: 16,
            fontWeight: 700,
            color: "#fff",
            background: "linear-gradient(135deg, #e74c3c, #c0392b)",
            border: "none",
            borderRadius: 50,
            cursor: "pointer",
            letterSpacing: 4,
            textTransform: "uppercase",
            boxShadow: "0 4px 30px rgba(231, 76, 60, 0.4)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <span style={{ position: "relative", zIndex: 1 }}>Start Ride</span>
        </motion.button>

        {/* Feature icons */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2, duration: 0.8 }}
          style={{
            marginTop: 56,
            display: "flex",
            gap: 44,
            color: "#3a4a6a",
            fontSize: 12,
            justifyContent: "center",
          }}
        >
          {[
            { icon: "🚴", label: "3D World" },
            { icon: "⚡", label: "Live Metrics" },
            { icon: "🎯", label: "Zone Training" },
            { icon: "🗣️", label: "AI Coach" },
            { icon: "📊", label: "Analytics" },
          ].map((f, i) => (
            <motion.div
              key={f.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.4 + i * 0.1 }}
              style={{ textAlign: "center" }}
            >
              <div style={{ fontSize: 24, marginBottom: 6 }}>{f.icon}</div>
              <div style={{ fontWeight: 500 }}>{f.label}</div>
            </motion.div>
          ))}
        </motion.div>
      </motion.div>

      {/* CSS animations */}
      <style>{`
        @keyframes gridMove {
          0% { transform: translate(0, 0); }
          100% { transform: translate(40px, 40px); }
        }
        @keyframes shimmer {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
      `}</style>
    </div>
  );
}
