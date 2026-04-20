// ---------------------------------------------------------------------------
// Artifact management — persistent storage for input/output files
// ---------------------------------------------------------------------------

import { nanoid } from "nanoid";
import { existsSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { writeFile } from "node:fs/promises";
import { getDb } from "../db/index.js";
import { DATA_DIR } from "../shared/paths.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Artifact {
  id: string;
  sessionId: string;
  direction: "input" | "output";
  filename: string;
  mimeType: string | null;
  diskPath: string;
  discordUrl: string | null;
  discordMessageId: string | null;
  sizeBytes: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
}

export interface RegisterArtifactOpts {
  sessionId: string;
  direction: "input" | "output";
  filename: string;
  mimeType?: string;
  discordUrl?: string;
  discordMessageId?: string;
  sizeBytes?: number;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Root directory for all artifact files. */
const ARTIFACTS_DIR = join(DATA_DIR, "artifacts");

/** Default gateway URL (overridden by GATEWAY_PUBLIC_URL env var). */
function getGatewayBaseUrl(): string {
  return (
    process.env.GATEWAY_PUBLIC_URL ||
    `http://localhost:${process.env.GATEWAY_PORT || "3000"}`
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Ensure the artifacts directory for a session exists. */
function ensureSessionDir(sessionId: string): string {
  const dir = join(ARTIFACTS_DIR, sessionId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Map a DB row to an Artifact object. */
function rowToArtifact(row: Record<string, unknown>): Artifact {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    direction: row.direction as "input" | "output",
    filename: row.filename as string,
    mimeType: (row.mime_type as string) ?? null,
    diskPath: row.disk_path as string,
    discordUrl: (row.discord_url as string) ?? null,
    discordMessageId: (row.discord_message_id as string) ?? null,
    sizeBytes: (row.size_bytes as number) ?? null,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
    createdAt: row.created_at as number,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register an artifact from a Buffer (downloaded file content).
 * Saves the file to disk and records it in the database.
 */
export async function registerArtifactFromBuffer(
  opts: RegisterArtifactOpts,
  buffer: Buffer,
): Promise<Artifact> {
  const id = nanoid();
  const dir = ensureSessionDir(opts.sessionId);
  const safeFilename = `${opts.direction}_${id}_${opts.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const diskPath = join(dir, safeFilename);

  await writeFile(diskPath, buffer);

  const sizeBytes = opts.sizeBytes ?? buffer.length;

  getDb()
    .prepare(
      `INSERT INTO artifacts (id, session_id, direction, filename, mime_type, disk_path, discord_url, discord_message_id, size_bytes, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      opts.sessionId,
      opts.direction,
      opts.filename,
      opts.mimeType ?? null,
      diskPath,
      opts.discordUrl ?? null,
      opts.discordMessageId ?? null,
      sizeBytes,
      opts.metadata ? JSON.stringify(opts.metadata) : null,
      Date.now(),
    );

  return {
    id,
    sessionId: opts.sessionId,
    direction: opts.direction,
    filename: opts.filename,
    mimeType: opts.mimeType ?? null,
    diskPath,
    discordUrl: opts.discordUrl ?? null,
    discordMessageId: opts.discordMessageId ?? null,
    sizeBytes,
    metadata: opts.metadata ?? null,
    createdAt: Date.now(),
  };
}

/**
 * Register an artifact from an existing file on disk.
 * Copies the file into the artifact storage directory.
 */
export function registerArtifactFromFile(
  opts: RegisterArtifactOpts,
  sourcePath: string,
): Artifact {
  const id = nanoid();
  const dir = ensureSessionDir(opts.sessionId);
  const safeFilename = `${opts.direction}_${id}_${opts.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const diskPath = join(dir, safeFilename);

  copyFileSync(sourcePath, diskPath);

  const stats = statSync(diskPath);
  const sizeBytes = opts.sizeBytes ?? stats.size;

  getDb()
    .prepare(
      `INSERT INTO artifacts (id, session_id, direction, filename, mime_type, disk_path, discord_url, discord_message_id, size_bytes, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      opts.sessionId,
      opts.direction,
      opts.filename,
      opts.mimeType ?? null,
      diskPath,
      opts.discordUrl ?? null,
      opts.discordMessageId ?? null,
      sizeBytes,
      opts.metadata ? JSON.stringify(opts.metadata) : null,
      Date.now(),
    );

  return {
    id,
    sessionId: opts.sessionId,
    direction: opts.direction,
    filename: opts.filename,
    mimeType: opts.mimeType ?? null,
    diskPath,
    discordUrl: opts.discordUrl ?? null,
    discordMessageId: opts.discordMessageId ?? null,
    sizeBytes,
    metadata: opts.metadata ?? null,
    createdAt: Date.now(),
  };
}

/**
 * Update the Discord URL/message ID for an artifact after it's been sent.
 */
export function updateArtifactDiscordInfo(
  artifactId: string,
  discordUrl: string,
  discordMessageId?: string,
): void {
  getDb()
    .prepare(
      `UPDATE artifacts SET discord_url = ?, discord_message_id = ? WHERE id = ?`,
    )
    .run(discordUrl, discordMessageId ?? null, artifactId);
}

/**
 * Get all artifacts for a session, ordered by creation time.
 */
export function getSessionArtifacts(sessionId: string): Artifact[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM artifacts WHERE session_id = ? ORDER BY created_at ASC",
    )
    .all(sessionId) as Record<string, unknown>[];
  return rows.map(rowToArtifact);
}

/**
 * Get a single artifact by ID.
 */
export function getArtifact(id: string): Artifact | undefined {
  const row = getDb()
    .prepare("SELECT * FROM artifacts WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToArtifact(row) : undefined;
}

/**
 * Build a gateway download URL for an artifact.
 */
export function getArtifactDownloadUrl(
  sessionId: string,
  artifactId: string,
): string {
  const base = getGatewayBaseUrl();
  return `${base}/artifacts/${sessionId}/${artifactId}/download`;
}

/**
 * Build the gateway portal URL for a session's artifacts.
 */
export function getArtifactPortalUrl(sessionId: string): string {
  const base = getGatewayBaseUrl();
  return `${base}/artifacts/${sessionId}`;
}

/**
 * Format file size into human-readable string.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
