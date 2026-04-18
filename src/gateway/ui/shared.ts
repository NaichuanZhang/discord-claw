import React from "react";

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
