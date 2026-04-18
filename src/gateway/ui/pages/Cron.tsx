import React, { useState, useEffect } from "react";
import { apiFetch, relativeTime, C, S } from "../App";

// ── Types (matching the real API / cron service shapes) ──────────────

interface CronSchedule {
  type: "at" | "every" | "cron";
  expression?: string;
  tz?: string;
  timestamp?: number;
  intervalMs?: number;
}

interface CronPayload {
  kind: "systemEvent" | "agentTurn";
  text?: string;
  message?: string;
  model?: string;
}

interface CronDelivery {
  channelId: string;
  mentionUser?: string;
}

interface CronJobState {
  nextRunAtMs?: number;
  lastRunAtMs?: number;
  lastRunStatus?: "ok" | "error" | "skipped";
  lastError?: string;
  consecutiveErrors?: number;
}

interface CronJob {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  deleteAfterRun?: boolean;
  schedule: CronSchedule;
  payload: CronPayload;
  delivery?: CronDelivery;
  state: CronJobState;
  createdAt: number;
  updatedAt: number;
}

interface CronRunEntry {
  jobId: string;
  startedAt: number;
  completedAt: number;
  status: "ok" | "error" | "skipped";
  result?: string;
  error?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Format a CronSchedule object into a human-readable string. */
function formatSchedule(schedule: CronSchedule): string {
  switch (schedule.type) {
    case "cron":
      return schedule.expression ?? "???";
    case "every": {
      if (!schedule.intervalMs) return "???";
      const ms = schedule.intervalMs;
      if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
      if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
      if (ms < 86_400_000) return `${+(ms / 3_600_000).toFixed(1)}h`;
      return `${+(ms / 86_400_000).toFixed(1)}d`;
    }
    case "at":
      return schedule.timestamp
        ? new Date(schedule.timestamp).toLocaleString()
        : "???";
    default:
      return JSON.stringify(schedule);
  }
}

/** Format the schedule type label. */
function scheduleTypeLabel(schedule: CronSchedule): string {
  switch (schedule.type) {
    case "cron":
      return schedule.tz ? `cron · ${schedule.tz}` : "cron";
    case "every":
      return "interval";
    case "at":
      return "one-shot";
    default:
      return schedule.type;
  }
}

// ── Create Job Form ──────────────────────────────────────────────────

function CreateJobForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scheduleType, setScheduleType] = useState("cron");
  const [schedule, setSchedule] = useState("");
  const [message, setMessage] = useState("");
  const [channelId, setChannelId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = () => {
    if (!name.trim() || !schedule.trim()) return;
    setSaving(true);
    setError("");
    apiFetch("/api/cron", {
      method: "POST",
      body: JSON.stringify({
        name: name.trim(),
        scheduleType,
        schedule: schedule.trim(),
        message: message.trim(),
        channelId: channelId.trim() || undefined,
      }),
    })
      .then(() => {
        setSaving(false);
        setOpen(false);
        setName("");
        setSchedule("");
        setMessage("");
        setChannelId("");
        onCreated();
      })
      .catch((e) => {
        setSaving(false);
        setError(e.message);
      });
  };

  if (!open) {
    return (
      <button style={S.btn} onClick={() => setOpen(true)}>
        + New Job
      </button>
    );
  }

  return (
    <div
      style={{
        ...S.card,
        border: `1px solid ${C.border}`,
      }}
    >
      <h3 style={S.h3}>New Cron Job</h3>
      {error && (
        <div style={{ color: C.error, fontSize: 13, marginBottom: 8 }}>
          {error}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <div>
          <div style={{ fontSize: 12, color: C.textDim, marginBottom: 3 }}>
            Name
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="daily-summary"
            style={{ ...S.input, width: "100%" }}
          />
        </div>
        <div>
          <div style={{ fontSize: 12, color: C.textDim, marginBottom: 3 }}>
            Schedule Type
          </div>
          <select
            value={scheduleType}
            onChange={(e) => setScheduleType(e.target.value)}
            style={{
              ...S.input,
              width: "100%",
              cursor: "pointer",
            }}
          >
            <option value="cron">Cron Expression</option>
            <option value="every">Every (interval)</option>
            <option value="at">At (specific time)</option>
          </select>
        </div>
        <div>
          <div style={{ fontSize: 12, color: C.textDim, marginBottom: 3 }}>
            Schedule
          </div>
          <input
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder={
              scheduleType === "cron"
                ? "0 9 * * *"
                : scheduleType === "every"
                  ? "30m"
                  : "09:00"
            }
            style={{ ...S.input, width: "100%" }}
          />
        </div>
        <div>
          <div style={{ fontSize: 12, color: C.textDim, marginBottom: 3 }}>
            Channel ID (optional)
          </div>
          <input
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            placeholder="123456789"
            style={{ ...S.input, width: "100%" }}
          />
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: C.textDim, marginBottom: 3 }}>
          Message / Payload
        </div>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          placeholder="Message content or JSON payload"
          style={S.textarea}
        />
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          style={{ ...S.btnSuccess, opacity: saving ? 0.6 : 1 }}
          disabled={saving}
          onClick={submit}
        >
          {saving ? "Creating..." : "Create"}
        </button>
        <button
          style={S.btn}
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Job Row ──────────────────────────────────────────────────────────

function JobRow({
  job,
  onRefresh,
}: {
  job: CronJob;
  onRefresh: () => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [runs, setRuns] = useState<CronRunEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const toggleEnabled = () => {
    apiFetch(`/api/cron/${job.id}`, {
      method: "PUT",
      body: JSON.stringify({ enabled: !job.enabled }),
    })
      .then(() => onRefresh())
      .catch((e) => setError(e.message));
  };

  const runNow = () => {
    apiFetch(`/api/cron/${job.id}/run`, { method: "POST" })
      .then(() => onRefresh())
      .catch((e) => setError(e.message));
  };

  const deleteJob = () => {
    if (!confirm(`Delete job "${job.name}"?`)) return;
    apiFetch(`/api/cron/${job.id}`, { method: "DELETE" })
      .then(() => onRefresh())
      .catch((e) => setError(e.message));
  };

  const toggleHistory = () => {
    if (showHistory) {
      setShowHistory(false);
      return;
    }
    setShowHistory(true);
    setLoading(true);
    apiFetch<{ runs: CronRunEntry[] }>(`/api/cron/${job.id}/runs`)
      .then((d) => {
        setRuns(d.runs);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  };

  const lastStatus = job.state?.lastRunStatus;
  const statusColor =
    lastStatus === "ok"
      ? C.success
      : lastStatus === "error"
        ? C.error
        : C.textDim;

  return (
    <>
      <tr>
        <td style={S.td}>
          <div style={{ fontWeight: 500 }}>{job.name}</div>
          {job.description && (
            <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>
              {job.description}
            </div>
          )}
        </td>
        <td style={{ ...S.td, fontFamily: "monospace", fontSize: 12 }}>
          {formatSchedule(job.schedule)}
          <span style={{ color: C.textDim, marginLeft: 6 }}>
            ({scheduleTypeLabel(job.schedule)})
          </span>
        </td>
        <td style={{ ...S.td, color: C.textDim, fontSize: 12 }}>
          {job.state?.nextRunAtMs
            ? relativeTime(new Date(job.state.nextRunAtMs).toISOString())
            : "-"}
        </td>
        <td style={S.td}>
          {lastStatus ? (
            <span style={S.badge(statusColor)}>{lastStatus}</span>
          ) : (
            <span style={{ color: C.textDim, fontSize: 12 }}>-</span>
          )}
        </td>
        <td style={S.td}>
          <span
            onClick={toggleEnabled}
            style={{
              display: "inline-block",
              width: 36,
              height: 20,
              borderRadius: 10,
              background: job.enabled ? C.success : C.border,
              position: "relative",
              cursor: "pointer",
              transition: "background 0.2s",
              verticalAlign: "middle",
            }}
          >
            <span
              style={{
                position: "absolute",
                top: 2,
                left: job.enabled ? 18 : 2,
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: "#fff",
                transition: "left 0.2s",
              }}
            />
          </span>
        </td>
        <td style={S.td}>
          <div style={{ display: "flex", gap: 4 }}>
            <button style={S.btnSmall} onClick={runNow}>
              Run
            </button>
            <button style={S.btnSmall} onClick={toggleHistory}>
              {showHistory ? "Hide" : "History"}
            </button>
            <button style={S.btnDanger} onClick={deleteJob}>
              Delete
            </button>
          </div>
        </td>
      </tr>

      {error && (
        <tr>
          <td colSpan={6} style={{ ...S.td, color: C.error, fontSize: 12 }}>
            {error}
          </td>
        </tr>
      )}

      {showHistory && (
        <tr>
          <td
            colSpan={6}
            style={{
              padding: 12,
              background: C.bg,
              borderBottom: `1px solid ${C.border}`,
            }}
          >
            {loading ? (
              <div style={{ color: C.textDim, fontSize: 13 }}>Loading...</div>
            ) : runs.length === 0 ? (
              <div style={{ color: C.textDim, fontSize: 13 }}>
                No run history
              </div>
            ) : (
              <table style={{ ...S.table, fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={S.th}>Started</th>
                    <th style={S.th}>Duration</th>
                    <th style={S.th}>Status</th>
                    <th style={S.th}>Result / Error</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r, i) => (
                    <tr key={i}>
                      <td style={{ ...S.td, color: C.textDim }}>
                        {new Date(r.startedAt).toLocaleString()}
                        <span style={{ marginLeft: 6, fontSize: 11 }}>
                          ({relativeTime(new Date(r.startedAt).toISOString())})
                        </span>
                      </td>
                      <td style={{ ...S.td, color: C.textDim, fontSize: 11 }}>
                        {r.completedAt && r.startedAt
                          ? `${((r.completedAt - r.startedAt) / 1000).toFixed(1)}s`
                          : "-"}
                      </td>
                      <td style={S.td}>
                        <span
                          style={S.badge(
                            r.status === "ok"
                              ? C.success
                              : r.status === "error"
                                ? C.error
                                : C.textDim,
                          )}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td
                        style={{
                          ...S.td,
                          fontFamily: "monospace",
                          fontSize: 11,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          maxWidth: 400,
                          color: r.error ? C.error : C.textDim,
                        }}
                      >
                        {r.error || r.result || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ── Cron Page ────────────────────────────────────────────────────────

export default function Cron() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [error, setError] = useState("");

  const load = () => {
    apiFetch<{ jobs: CronJob[] }>("/api/cron")
      .then((d) => {
        setJobs(d.jobs);
        setError("");
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <h2 style={{ ...S.h2, marginBottom: 0 }}>Cron Jobs</h2>
        <CreateJobForm onCreated={load} />
      </div>

      {error && (
        <div style={{ ...S.card, color: C.error, fontSize: 13 }}>{error}</div>
      )}

      <div style={S.card}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Name</th>
              <th style={S.th}>Schedule</th>
              <th style={S.th}>Next Run</th>
              <th style={S.th}>Last Status</th>
              <th style={S.th}>Enabled</th>
              <th style={S.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <JobRow key={j.id} job={j} onRefresh={load} />
            ))}
            {jobs.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  style={{ ...S.td, color: C.textDim, textAlign: "center" }}
                >
                  No cron jobs
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
