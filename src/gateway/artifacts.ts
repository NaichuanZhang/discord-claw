// ---------------------------------------------------------------------------
// Gateway artifact routes — portal page + file downloads
// ---------------------------------------------------------------------------

import { Router, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import {
  getSessionArtifacts,
  getArtifact,
  getArtifactDownloadUrl,
  getArtifactPortalUrl,
  formatFileSize,
  type Artifact,
} from "../artifacts/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract a route param as a plain string. */
function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

/** Format a timestamp to a readable date string. */
function formatDate(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** MIME type to icon emoji mapping. */
function getFileIcon(mimeType: string | null, filename: string): string {
  if (!mimeType) {
    // Guess from extension
    if (filename.match(/\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i)) return "🖼️";
    if (filename.match(/\.pdf$/i)) return "📕";
    if (filename.match(/\.(html?|css)$/i)) return "🌐";
    if (filename.match(/\.(js|ts|py|rb|go|rs|java|c|cpp|sh)$/i)) return "💻";
    return "📄";
  }
  if (mimeType.startsWith("image/")) return "🖼️";
  if (mimeType === "application/pdf") return "📕";
  if (mimeType.startsWith("text/html")) return "🌐";
  if (mimeType.startsWith("text/")) return "📝";
  if (mimeType.startsWith("audio/")) return "🎵";
  if (mimeType.startsWith("video/")) return "🎬";
  return "📄";
}

// ---------------------------------------------------------------------------
// HTML Portal page generator
// ---------------------------------------------------------------------------

function renderPortalHtml(sessionId: string, artifacts: Artifact[]): string {
  const inputArtifacts = artifacts.filter((a) => a.direction === "input");
  const outputArtifacts = artifacts.filter((a) => a.direction === "output");

  const totalSize = artifacts.reduce((sum, a) => sum + (a.sizeBytes || 0), 0);
  const createdAt = artifacts.length > 0 ? Math.min(...artifacts.map((a) => a.createdAt)) : Date.now();

  function renderArtifactRow(a: Artifact): string {
    const icon = getFileIcon(a.mimeType, a.filename);
    const size = a.sizeBytes ? formatFileSize(a.sizeBytes) : "—";
    const downloadUrl = getArtifactDownloadUrl(a.sessionId, a.id);
    const date = formatDate(a.createdAt);

    return `
      <tr>
        <td class="icon">${icon}</td>
        <td class="filename">
          <a href="${downloadUrl}" title="Download ${a.filename}">${escapeHtml(a.filename)}</a>
          ${a.mimeType ? `<span class="mime">${escapeHtml(a.mimeType)}</span>` : ""}
        </td>
        <td class="size">${size}</td>
        <td class="date">${date}</td>
        <td class="actions">
          <a href="${downloadUrl}" class="btn">⬇ Download</a>
        </td>
      </tr>`;
  }

  function renderSection(title: string, emoji: string, items: Artifact[]): string {
    if (items.length === 0) return "";
    return `
      <h2>${emoji} ${title}</h2>
      <table>
        <thead>
          <tr>
            <th></th>
            <th>File</th>
            <th>Size</th>
            <th>Date</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${items.map(renderArtifactRow).join("\n")}
        </tbody>
      </table>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Artifacts — Session ${sessionId.slice(0, 8)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0d1117;
      color: #c9d1d9;
      padding: 2rem;
      max-width: 900px;
      margin: 0 auto;
    }
    h1 {
      color: #f0f6fc;
      margin-bottom: 0.5rem;
      font-size: 1.5rem;
    }
    .meta {
      color: #8b949e;
      font-size: 0.875rem;
      margin-bottom: 2rem;
    }
    h2 {
      color: #f0f6fc;
      font-size: 1.1rem;
      margin: 1.5rem 0 0.75rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid #21262d;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 1.5rem;
    }
    thead th {
      text-align: left;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #8b949e;
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid #21262d;
    }
    tbody tr {
      border-bottom: 1px solid #161b22;
    }
    tbody tr:hover {
      background: #161b22;
    }
    td {
      padding: 0.75rem;
      vertical-align: middle;
    }
    .icon { width: 2rem; text-align: center; font-size: 1.25rem; }
    .filename a {
      color: #58a6ff;
      text-decoration: none;
      font-weight: 500;
    }
    .filename a:hover { text-decoration: underline; }
    .mime {
      display: block;
      font-size: 0.75rem;
      color: #8b949e;
      margin-top: 0.125rem;
    }
    .size, .date { color: #8b949e; font-size: 0.875rem; white-space: nowrap; }
    .actions { text-align: right; }
    .btn {
      display: inline-block;
      padding: 0.375rem 0.75rem;
      font-size: 0.8125rem;
      color: #c9d1d9;
      background: #21262d;
      border: 1px solid #30363d;
      border-radius: 6px;
      text-decoration: none;
      cursor: pointer;
    }
    .btn:hover { background: #30363d; border-color: #8b949e; }
    .empty {
      text-align: center;
      color: #8b949e;
      padding: 3rem;
      font-style: italic;
    }
    @media (max-width: 600px) {
      body { padding: 1rem; }
      .date { display: none; }
      .mime { display: none; }
    }
  </style>
</head>
<body>
  <h1>📎 Artifact Portal</h1>
  <p class="meta">
    Session <code>${escapeHtml(sessionId.slice(0, 8))}…</code>
    · ${artifacts.length} file${artifacts.length !== 1 ? "s" : ""}
    · ${formatFileSize(totalSize)} total
    · Created ${formatDate(createdAt)}
  </p>

  ${artifacts.length === 0 ? '<p class="empty">No artifacts in this session yet.</p>' : ""}
  ${renderSection("Inputs", "📥", inputArtifacts)}
  ${renderSection("Outputs", "📤", outputArtifacts)}
</body>
</html>`;
}

/** Escape HTML special characters. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function createArtifactRouter(): Router {
  const router = Router();

  // ── JSON API: list artifacts for a session ──
  router.get("/api/artifacts/:sessionId", (req: Request, res: Response) => {
    try {
      const sessionId = param(req, "sessionId");
      const artifacts = getSessionArtifacts(sessionId);

      res.json({
        sessionId,
        portalUrl: getArtifactPortalUrl(sessionId),
        count: artifacts.length,
        artifacts: artifacts.map((a) => ({
          id: a.id,
          direction: a.direction,
          filename: a.filename,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          size: a.sizeBytes ? formatFileSize(a.sizeBytes) : null,
          discordUrl: a.discordUrl,
          downloadUrl: getArtifactDownloadUrl(a.sessionId, a.id),
          createdAt: a.createdAt,
        })),
      });
    } catch (err) {
      console.error("[gateway] Error in GET /api/artifacts/:sessionId:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  // ── JSON API: single artifact metadata ──
  router.get("/api/artifacts/:sessionId/:artifactId", (req: Request, res: Response) => {
    try {
      const artifactId = param(req, "artifactId");
      const artifact = getArtifact(artifactId);

      if (!artifact) {
        res.status(404).json({ error: "Artifact not found" });
        return;
      }

      res.json({
        id: artifact.id,
        sessionId: artifact.sessionId,
        direction: artifact.direction,
        filename: artifact.filename,
        mimeType: artifact.mimeType,
        sizeBytes: artifact.sizeBytes,
        size: artifact.sizeBytes ? formatFileSize(artifact.sizeBytes) : null,
        discordUrl: artifact.discordUrl,
        downloadUrl: getArtifactDownloadUrl(artifact.sessionId, artifact.id),
        metadata: artifact.metadata,
        createdAt: artifact.createdAt,
      });
    } catch (err) {
      console.error("[gateway] Error in GET /api/artifacts/:sessionId/:artifactId:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  // ── File download ──
  router.get("/artifacts/:sessionId/:artifactId/download", (req: Request, res: Response) => {
    try {
      const artifactId = param(req, "artifactId");
      const artifact = getArtifact(artifactId);

      if (!artifact) {
        res.status(404).json({ error: "Artifact not found" });
        return;
      }

      if (!existsSync(artifact.diskPath)) {
        res.status(404).json({ error: "Artifact file not found on disk" });
        return;
      }

      // Set content type if known
      if (artifact.mimeType) {
        res.setHeader("Content-Type", artifact.mimeType);
      }

      // Set content disposition for download
      const filename = basename(artifact.filename);
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

      res.sendFile(artifact.diskPath);
    } catch (err) {
      console.error("[gateway] Error in artifact download:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  // ── HTML Portal page ──
  router.get("/artifacts/:sessionId", (req: Request, res: Response) => {
    try {
      const sessionId = param(req, "sessionId");
      const artifacts = getSessionArtifacts(sessionId);
      const html = renderPortalHtml(sessionId, artifacts);
      res.setHeader("Content-Type", "text/html");
      res.send(html);
    } catch (err) {
      console.error("[gateway] Error in artifact portal:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
