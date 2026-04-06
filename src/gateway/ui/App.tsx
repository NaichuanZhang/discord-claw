import React, { useState, useEffect } from "react";
import Status from "./pages/Status";
import Sessions from "./pages/Sessions";
import Channels from "./pages/Channels";
import Config from "./pages/Config";
import Cron from "./pages/Cron";
import Skills from "./pages/Skills";
import Logs from "./pages/Logs";

// ── Helpers ──────────────────────────────────────────────────────────

export async function apiFetch<T = any>(
  path: string,
  opts: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    ...(opts.headers as Record<string, string>),
  };
  if (opts.body && typeof opts.body === "string") {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

export function relativeTime(iso: string | number): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "just now";
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || parts.length === 0) parts.push(`${s}s`);
  return parts.join(" ");
}

// ── Color palette ────────────────────────────────────────────────────

export const C = {
  bg: "#1a1a2e",
  surface: "#16213e",
  primary: "#0f3460",
  text: "#e0e0e0",
  textDim: "#8a8a9a",
  accent: "#533483",
  success: "#2ecc71",
  error: "#e74c3c",
  warning: "#f39c12",
  border: "#2a2a4a",
} as const;

// ── Shared styles ────────────────────────────────────────────────────

export const S = {
  btn: {
    padding: "6px 14px",
    background: C.primary,
    color: C.text,
    border: "none",
    borderRadius: 4,
    cursor: "pointer",
    fontSize: 13,
  } as React.CSSProperties,
  btnSmall: {
    padding: "3px 10px",
    background: C.primary,
    color: C.text,
    border: "none",
    borderRadius: 3,
    cursor: "pointer",
    fontSize: 12,
  } as React.CSSProperties,
  btnDanger: {
    padding: "3px 10px",
    background: C.error,
    color: "#fff",
    border: "none",
    borderRadius: 3,
    cursor: "pointer",
    fontSize: 12,
  } as React.CSSProperties,
  btnSuccess: {
    padding: "6px 14px",
    background: C.success,
    color: "#fff",
    border: "none",
    borderRadius: 4,
    cursor: "pointer",
    fontSize: 13,
  } as React.CSSProperties,
  input: {
    padding: "6px 10px",
    background: C.bg,
    color: C.text,
    border: `1px solid ${C.border}`,
    borderRadius: 4,
    fontSize: 13,
    outline: "none",
  } as React.CSSProperties,
  textarea: {
    padding: "8px 10px",
    background: C.bg,
    color: C.text,
    border: `1px solid ${C.border}`,
    borderRadius: 4,
    fontSize: 13,
    fontFamily: "monospace",
    outline: "none",
    resize: "vertical" as const,
    width: "100%",
  } as React.CSSProperties,
  card: {
    background: C.surface,
    borderRadius: 6,
    padding: 16,
    marginBottom: 16,
  } as React.CSSProperties,
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: 13,
  } as React.CSSProperties,
  th: {
    textAlign: "left" as const,
    padding: "8px 12px",
    borderBottom: `1px solid ${C.border}`,
    color: C.textDim,
    fontWeight: 600,
    fontSize: 12,
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
  } as React.CSSProperties,
  td: {
    padding: "8px 12px",
    borderBottom: `1px solid ${C.border}`,
  } as React.CSSProperties,
  h2: {
    fontSize: 18,
    fontWeight: 600,
    marginBottom: 12,
    color: C.text,
  } as React.CSSProperties,
  h3: {
    fontSize: 15,
    fontWeight: 600,
    marginBottom: 8,
    color: C.text,
  } as React.CSSProperties,
  badge: (color: string): React.CSSProperties => ({
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 10,
    fontSize: 11,
    fontWeight: 600,
    background: color + "22",
    color,
  }),
};

// ── Pages map ────────────────────────────────────────────────────────

const pages: Record<string, { label: string; component: React.FC }> = {
  status: { label: "Status", component: Status },
  sessions: { label: "Sessions", component: Sessions },
  channels: { label: "Channels", component: Channels },
  config: { label: "Config", component: Config },
  cron: { label: "Cron", component: Cron },
  skills: { label: "Skills", component: Skills },
  logs: { label: "Logs", component: Logs },
};

function getHash(): string {
  const h = window.location.hash.replace("#", "").toLowerCase();
  return h && pages[h] ? h : "status";
}

// ── App ──────────────────────────────────────────────────────────────

export default function App() {
  const [page, setPage] = useState(getHash);

  useEffect(() => {
    const onHash = () => setPage(getHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const PageComponent = pages[page].component;

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* Sidebar */}
      <nav
        style={{
          width: 200,
          minWidth: 200,
          background: C.surface,
          borderRight: `1px solid ${C.border}`,
          display: "flex",
          flexDirection: "column",
          padding: "16px 0",
        }}
      >
        <div
          style={{
            padding: "0 16px 16px",
            borderBottom: `1px solid ${C.border}`,
            marginBottom: 8,
          }}
        >
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: "0.5px",
              marginBottom: 12,
              color: C.text,
            }}
          >
            discordclaw
          </div>
        </div>

        {Object.entries(pages).map(([key, { label }]) => (
          <a
            key={key}
            href={`#${key}`}
            style={{
              display: "block",
              padding: "8px 16px",
              color: page === key ? C.text : C.textDim,
              textDecoration: "none",
              fontSize: 14,
              background: page === key ? C.primary + "44" : "transparent",
              borderLeft:
                page === key
                  ? `3px solid ${C.accent}`
                  : "3px solid transparent",
              transition: "all 0.15s",
            }}
          >
            {label}
          </a>
        ))}
      </nav>

      {/* Main content */}
      <main
        style={{
          flex: 1,
          padding: 24,
          overflowY: "auto",
          maxHeight: "100vh",
        }}
      >
        <PageComponent />
      </main>
    </div>
  );
}
