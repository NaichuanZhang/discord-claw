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

const statusColors: Record<string, string> = {
  idea: C.warning,
  proposing: C.accent,
  proposed: "#3498db",
  deployed: C.success,
  rolled_back: C.error,
  cancelled: C.textDim,
  rejected: C.textDim,
};

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
