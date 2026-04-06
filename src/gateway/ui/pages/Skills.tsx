import React, { useState, useEffect } from "react";
import { apiFetch, relativeTime, C, S } from "../App";

interface SkillSummary {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  userInvocable: boolean;
  disableModelInvocation: boolean;
  source: { type: string; url?: string };
  installedAt: number;
  updatedAt: number;
}

// ── Install Skill Form ──────────────────────────────────────────────

function InstallSkillForm({ onInstalled }: { onInstalled: () => void }) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<"upload" | "github">("upload");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = () => {
    if (source === "upload" && !content.trim()) return;
    if (source === "github" && !url.trim()) return;
    setSaving(true);
    setError("");
    apiFetch("/api/skills", {
      method: "POST",
      body: JSON.stringify({
        source,
        ...(source === "upload" ? { content: content.trim() } : {}),
        ...(source === "github" ? { url: url.trim() } : {}),
        ...(name.trim() ? { name: name.trim() } : {}),
      }),
    })
      .then(() => {
        setSaving(false);
        setOpen(false);
        setContent("");
        setUrl("");
        setName("");
        onInstalled();
      })
      .catch((e) => {
        setSaving(false);
        setError(e.message);
      });
  };

  if (!open) {
    return (
      <button style={S.btn} onClick={() => setOpen(true)}>
        + Install Skill
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
      <h3 style={S.h3}>Install Skill</h3>
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
            Source
          </div>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as "upload" | "github")}
            style={{
              ...S.input,
              width: "100%",
              cursor: "pointer",
            }}
          >
            <option value="upload">Upload</option>
            <option value="github">GitHub</option>
          </select>
        </div>
        <div>
          <div style={{ fontSize: 12, color: C.textDim, marginBottom: 3 }}>
            Name (optional)
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-skill"
            style={{ ...S.input, width: "100%" }}
          />
        </div>
      </div>

      {source === "github" && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: C.textDim, marginBottom: 3 }}>
            GitHub URL
          </div>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/user/repo"
            style={{ ...S.input, width: "100%" }}
          />
        </div>
      )}

      {source === "upload" && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: C.textDim, marginBottom: 3 }}>
            SKILL.md Content
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            placeholder="Paste SKILL.md content..."
            style={S.textarea}
          />
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          style={{ ...S.btnSuccess, opacity: saving ? 0.6 : 1 }}
          disabled={saving}
          onClick={submit}
        >
          {saving ? "Installing..." : "Install"}
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

// ── Skill Row ───────────────────────────────────────────────────────

function SkillRow({
  skill,
  onRefresh,
}: {
  skill: SkillSummary;
  onRefresh: () => void;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const [detail, setDetail] = useState<{ rawContent?: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const toggleEnabled = () => {
    apiFetch(`/api/skills/${skill.id}`, {
      method: "PUT",
      body: JSON.stringify({ enabled: !skill.enabled }),
    })
      .then(() => onRefresh())
      .catch((e) => setError(e.message));
  };

  const deleteSkill = () => {
    if (!confirm(`Delete skill "${skill.name}"?`)) return;
    apiFetch(`/api/skills/${skill.id}`, { method: "DELETE" })
      .then(() => onRefresh())
      .catch((e) => setError(e.message));
  };

  const toggleDetail = () => {
    if (showDetail) {
      setShowDetail(false);
      setEditing(false);
      return;
    }
    setShowDetail(true);
    setLoading(true);
    apiFetch<{ rawContent?: string }>(`/api/skills/${skill.id}`)
      .then((d) => {
        setDetail(d);
        setEditContent(d.rawContent || "");
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  };

  const saveEdit = () => {
    setLoading(true);
    apiFetch(`/api/skills/${skill.id}`, {
      method: "PUT",
      body: JSON.stringify({ content: editContent }),
    })
      .then(() => {
        setEditing(false);
        setLoading(false);
        onRefresh();
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  };

  const sourceType = skill.source?.type || "unknown";
  const sourceColor =
    sourceType === "github"
      ? C.success
      : sourceType === "upload"
        ? C.accent
        : C.textDim;

  return (
    <>
      <tr>
        <td style={S.td}>
          <div style={{ fontWeight: 500 }}>{skill.name}</div>
        </td>
        <td
          style={{
            ...S.td,
            fontSize: 12,
            color: C.textDim,
            maxWidth: 300,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {skill.description && skill.description.length > 80
            ? skill.description.slice(0, 80) + "..."
            : skill.description || "-"}
        </td>
        <td style={S.td}>
          <span style={S.badge(sourceColor)}>{sourceType}</span>
        </td>
        <td style={S.td}>
          <span
            onClick={toggleEnabled}
            style={{
              display: "inline-block",
              width: 36,
              height: 20,
              borderRadius: 10,
              background: skill.enabled ? C.success : C.border,
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
                left: skill.enabled ? 18 : 2,
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
            <button style={S.btnSmall} onClick={toggleDetail}>
              {showDetail ? "Hide" : "View"}
            </button>
            <button style={S.btnDanger} onClick={deleteSkill}>
              Delete
            </button>
          </div>
        </td>
      </tr>

      {error && (
        <tr>
          <td colSpan={5} style={{ ...S.td, color: C.error, fontSize: 12 }}>
            {error}
          </td>
        </tr>
      )}

      {showDetail && (
        <tr>
          <td
            colSpan={5}
            style={{
              padding: 12,
              background: C.bg,
              borderBottom: `1px solid ${C.border}`,
            }}
          >
            {loading ? (
              <div style={{ color: C.textDim, fontSize: 13 }}>Loading...</div>
            ) : (
              <div>
                {skill.source?.type === "github" && skill.source?.url && (
                  <div
                    style={{
                      fontSize: 12,
                      color: C.textDim,
                      marginBottom: 8,
                    }}
                  >
                    Source:{" "}
                    <span style={{ color: C.text }}>{skill.source.url}</span>
                  </div>
                )}
                <textarea
                  value={editing ? editContent : detail?.rawContent || ""}
                  onChange={(e) => setEditContent(e.target.value)}
                  readOnly={!editing}
                  rows={12}
                  style={{
                    ...S.textarea,
                    opacity: editing ? 1 : 0.8,
                  }}
                />
                <div
                  style={{ display: "flex", gap: 8, marginTop: 8 }}
                >
                  {!editing ? (
                    <button
                      style={S.btnSmall}
                      onClick={() => setEditing(true)}
                    >
                      Edit
                    </button>
                  ) : (
                    <>
                      <button
                        style={{
                          ...S.btnSuccess,
                          padding: "3px 10px",
                          fontSize: 12,
                          opacity: loading ? 0.6 : 1,
                        }}
                        disabled={loading}
                        onClick={saveEdit}
                      >
                        {loading ? "Saving..." : "Save"}
                      </button>
                      <button
                        style={S.btnSmall}
                        onClick={() => {
                          setEditing(false);
                          setEditContent(detail?.rawContent || "");
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ── Skills Page ─────────────────────────────────────────────────────

export default function Skills() {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [error, setError] = useState("");

  const load = () => {
    apiFetch<{ skills: SkillSummary[] }>("/api/skills")
      .then((d) => {
        setSkills(d.skills);
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
        <h2 style={{ ...S.h2, marginBottom: 0 }}>Skills</h2>
        <InstallSkillForm onInstalled={load} />
      </div>

      {error && (
        <div style={{ ...S.card, color: C.error, fontSize: 13 }}>{error}</div>
      )}

      <div style={S.card}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Name</th>
              <th style={S.th}>Description</th>
              <th style={S.th}>Source</th>
              <th style={S.th}>Enabled</th>
              <th style={S.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {skills.map((s) => (
              <SkillRow key={s.id} skill={s} onRefresh={load} />
            ))}
            {skills.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  style={{ ...S.td, color: C.textDim, textAlign: "center" }}
                >
                  No skills installed
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
