import React, { useState, useEffect } from "react";
import { apiFetch, C, S } from "../App";

interface ChannelConfig {
  id: string;
  guildId?: string;
  guildName?: string;
  name?: string;
  enabled: boolean;
  systemPrompt?: string;
  settings?: Record<string, any>;
}

export default function Channels() {
  const [channels, setChannels] = useState<ChannelConfig[]>([]);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editEnabled, setEditEnabled] = useState(false);
  const [editPrompt, setEditPrompt] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => {
    apiFetch<{ channels: ChannelConfig[] }>("/api/channels")
      .then((d) => {
        setChannels(d.channels);
        setError("");
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, []);

  const startEdit = (ch: ChannelConfig) => {
    if (editingId === ch.id) {
      setEditingId(null);
      return;
    }
    setEditingId(ch.id);
    setEditEnabled(ch.enabled);
    setEditPrompt(ch.systemPrompt || "");
  };

  const save = (id: string) => {
    setSaving(true);
    apiFetch(`/api/channels/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        enabled: editEnabled,
        systemPrompt: editPrompt,
      }),
    })
      .then(() => {
        setSaving(false);
        setEditingId(null);
        load();
      })
      .catch((e) => {
        setSaving(false);
        setError(e.message);
      });
  };

  return (
    <div>
      <h2 style={S.h2}>Channels</h2>

      {error && (
        <div style={{ ...S.card, color: C.error, fontSize: 13 }}>{error}</div>
      )}

      <div style={S.card}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Channel</th>
              <th style={S.th}>Guild</th>
              <th style={S.th}>Enabled</th>
              <th style={S.th}>System Prompt</th>
              <th style={S.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((ch) => (
              <React.Fragment key={ch.id}>
                <tr>
                  <td style={{ ...S.td, fontFamily: "monospace", fontSize: 12 }}>
                    {ch.name ? (
                      <span>
                        <span style={{ color: C.textDim }}>#</span>
                        {ch.name}
                        <span style={{ color: C.textDim, fontSize: 10, marginLeft: 6 }}>
                          {ch.id}
                        </span>
                      </span>
                    ) : (
                      ch.id
                    )}
                  </td>
                  <td style={S.td}>{ch.guildName || ch.guildId || "-"}</td>
                  <td style={S.td}>
                    <span style={S.badge(ch.enabled ? C.success : C.textDim)}>
                      {ch.enabled ? "on" : "off"}
                    </span>
                  </td>
                  <td
                    style={{
                      ...S.td,
                      maxWidth: 300,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: C.textDim,
                      fontSize: 12,
                    }}
                  >
                    {ch.systemPrompt
                      ? ch.systemPrompt.slice(0, 80) +
                        (ch.systemPrompt.length > 80 ? "..." : "")
                      : "-"}
                  </td>
                  <td style={S.td}>
                    <button
                      style={S.btnSmall}
                      onClick={() => startEdit(ch)}
                    >
                      {editingId === ch.id ? "Cancel" : "Edit"}
                    </button>
                  </td>
                </tr>

                {editingId === ch.id && (
                  <tr>
                    <td
                      colSpan={5}
                      style={{
                        padding: 16,
                        background: C.bg,
                        borderBottom: `1px solid ${C.border}`,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 12,
                          maxWidth: 600,
                        }}
                      >
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            cursor: "pointer",
                            fontSize: 13,
                          }}
                        >
                          <span
                            onClick={() => setEditEnabled(!editEnabled)}
                            style={{
                              display: "inline-block",
                              width: 36,
                              height: 20,
                              borderRadius: 10,
                              background: editEnabled ? C.success : C.border,
                              position: "relative",
                              transition: "background 0.2s",
                              cursor: "pointer",
                            }}
                          >
                            <span
                              style={{
                                position: "absolute",
                                top: 2,
                                left: editEnabled ? 18 : 2,
                                width: 16,
                                height: 16,
                                borderRadius: "50%",
                                background: "#fff",
                                transition: "left 0.2s",
                              }}
                            />
                          </span>
                          Enabled
                        </label>

                        <div>
                          <div
                            style={{
                              fontSize: 12,
                              color: C.textDim,
                              marginBottom: 4,
                            }}
                          >
                            System Prompt
                          </div>
                          <textarea
                            value={editPrompt}
                            onChange={(e) => setEditPrompt(e.target.value)}
                            rows={8}
                            style={S.textarea}
                          />
                        </div>

                        <div>
                          <button
                            style={{
                              ...S.btnSuccess,
                              opacity: saving ? 0.6 : 1,
                            }}
                            disabled={saving}
                            onClick={() => save(ch.id)}
                          >
                            {saving ? "Saving..." : "Save"}
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {channels.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  style={{ ...S.td, color: C.textDim, textAlign: "center" }}
                >
                  No channels configured
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
