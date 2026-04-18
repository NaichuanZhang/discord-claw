import React, { useState, useEffect } from "react";
import { apiFetch, relativeTime, C, S } from "../shared";

interface EvolutionRecord {
  id: string;
  triggeredBy: string | null;
  triggerMessage: string | null;
  branch: string | null;
  prUrl: string | null;
  prNumber: number | null;
  status: string;
  changesSummary: string | null;
  filesChanged: string[] | null;
  createdAt: number;
  proposedAt: number | null;
  deployedAt: number | null;
}

interface SandboxCIStatus {
  enabled: boolean;
  apiKeyConfigured: boolean;
  apiUrl: string;
}

const statusColors: Record<string, string> = {
  idea: C.warning,
  proposing: C.accent,
  proposed: "#3498db",
  deployed: C.success,
  rolled_back: C.error,
  cancelled: C.textDim,
  rejected: C.textDim,
};

// ── Sandbox CI Config Card ───────────────────────────────────────────

function SandboxCICard() {
  const [status, setStatus] = useState<SandboxCIStatus | null>(null);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const data = await apiFetch<SandboxCIStatus>("/api/evolutions/sandbox-ci");
      setStatus(data);
      setError("");
    } catch (err: any) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggle = async () => {
    if (!status) return;
    setToggling(true);
    try {
      const data = await apiFetch<SandboxCIStatus>("/api/evolutions/sandbox-ci", {
        method: "PUT",
        body: JSON.stringify({ enabled: !status.enabled }),
      });
      setStatus(data);
      setError("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setToggling(false);
    }
  };

  if (!status) {
    return (
      <div style={S.card}>
        <div style={{ color: C.textDim, fontSize: 13 }}>Loading sandbox CI config...</div>
      </div>
    );
  }

  const canEnable = status.apiKeyConfigured;

  return (
    <div style={S.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ ...S.h3, marginBottom: 0 }}>Sandbox CI</h3>
        <span style={S.badge(status.enabled ? C.success : C.textDim)}>
          {status.enabled ? "Enabled" : "Disabled"}
        </span>
      </div>

      {error && (
        <div style={{ color: C.error, fontSize: 13, marginBottom: 8 }}>
          {error}
        </div>
      )}

      <div style={{ fontSize: 13, color: C.textDim, marginBottom: 12, lineHeight: 1.6 }}>
        When enabled, evolution PRs are validated in an ephemeral{" "}
        <a
          href="https://www.daytona.io"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#3498db", textDecoration: "none" }}
        >
          Daytona
        </a>{" "}
        sandbox — clean install, typecheck, and tests in full isolation.
        Falls back to local validation when disabled or if sandbox infra is unavailable.
      </div>

      {/* Status indicators */}
      <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <span style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: status.apiKeyConfigured ? C.success : C.error,
            display: "inline-block",
          }} />
          <span style={{ color: status.apiKeyConfigured ? C.text : C.textDim }}>
            API Key {status.apiKeyConfigured ? "configured" : "not set"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <span style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: status.enabled ? C.success : C.textDim,
            display: "inline-block",
          }} />
          <span style={{ color: C.text }}>
            Validation: {status.enabled ? "☁️ Sandbox" : "🖥️ Local"}
          </span>
        </div>
        {status.apiKeyConfigured && (
          <div style={{ fontSize: 12, color: C.textDim, fontFamily: "monospace" }}>
            {status.apiUrl}
          </div>
        )}
      </div>

      {/* Toggle button */}
      <button
        onClick={toggle}
        disabled={toggling || !canEnable}
        style={{
          ...S.btn,
          background: status.enabled ? C.error + "cc" : C.success,
          color: "#fff",
          opacity: toggling || !canEnable ? 0.5 : 1,
          cursor: toggling || !canEnable ? "not-allowed" : "pointer",
        }}
      >
        {toggling
          ? "Updating..."
          : status.enabled
            ? "Disable Sandbox CI"
            : "Enable Sandbox CI"}
      </button>

      {!canEnable && (
        <div style={{ color: C.warning, fontSize: 12, marginTop: 8 }}>
          Set <code style={{ background: C.bg, padding: "1px 4px", borderRadius: 3 }}>DAYTONA_API_KEY</code> in your environment to enable sandbox CI.
        </div>
      )}
    </div>
  );
}

// ── Evolution Page ───────────────────────────────────────────────────

export default function Evolution() {
  const [evolutions, setEvolutions] = useState<EvolutionRecord[]>([]);
  const [filter, setFilter] = useState<string>("");
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const url = filter ? `/api/evolutions?status=${filter}` : "/api/evolutions";
      const data = await apiFetch<{ evolutions: EvolutionRecord[] }>(url);
      setEvolutions(data.evolutions);
      setError("");
    } catch (err: any) {
      setError(err.message);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, [filter]);

  const dismiss = async (id: string) => {
    try {
      await apiFetch(`/api/evolutions/${id}/dismiss`, { method: "POST" });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const filters = ["", "idea", "proposing", "proposed", "deployed", "cancelled", "rejected"];

  return (
    <div>
      <h2 style={S.h2}>Evolution</h2>

      {/* Sandbox CI Config */}
      <SandboxCICard />

      {error && (
        <div style={{ ...S.card, background: C.error + "22", color: C.error, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {/* Filter bar */}
      <div style={{ marginBottom: 16, display: "flex", gap: 6, flexWrap: "wrap" }}>
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              ...S.btnSmall,
              background: filter === f ? C.accent : C.primary,
            }}
          >
            {f || "All"}
          </button>
        ))}
      </div>

      {/* Stats */}
      <div style={{ ...S.card, display: "flex", gap: 24, flexWrap: "wrap" }}>
        {["idea", "proposing", "proposed", "deployed"].map((s) => {
          const count = evolutions.filter((e) => e.status === s).length;
          return (
            <div key={s} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: statusColors[s] }}>{count}</div>
              <div style={{ fontSize: 12, color: C.textDim, textTransform: "uppercase" }}>{s}</div>
            </div>
          );
        })}
      </div>

      {/* Table */}
      <div style={S.card}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Status</th>
              <th style={S.th}>Summary</th>
              <th style={S.th}>Branch</th>
              <th style={S.th}>PR</th>
              <th style={S.th}>Created</th>
              <th style={S.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {evolutions.length === 0 && (
              <tr>
                <td style={{ ...S.td, color: C.textDim }} colSpan={6}>
                  No evolutions found
                </td>
              </tr>
            )}
            {evolutions.map((evo) => (
              <tr key={evo.id}>
                <td style={S.td}>
                  <span style={S.badge(statusColors[evo.status] || C.textDim)}>
                    {evo.status}
                  </span>
                </td>
                <td style={{ ...S.td, maxWidth: 300 }}>
                  {evo.changesSummary || evo.triggerMessage?.slice(0, 80) || "—"}
                </td>
                <td style={{ ...S.td, fontFamily: "monospace", fontSize: 12 }}>
                  {evo.branch?.replace("evolve/", "") || "—"}
                </td>
                <td style={S.td}>
                  {evo.prUrl ? (
                    <a
                      href={evo.prUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "#3498db", textDecoration: "none" }}
                    >
                      #{evo.prNumber}
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td style={{ ...S.td, color: C.textDim, fontSize: 12 }}>
                  {relativeTime(evo.createdAt)}
                </td>
                <td style={S.td}>
                  {evo.status === "idea" && (
                    <button style={S.btnDanger} onClick={() => dismiss(evo.id)}>
                      Dismiss
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
