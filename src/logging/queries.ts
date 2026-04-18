// ---------------------------------------------------------------------------
// Log queries — used by reflection daemon, debug tools, and gateway API
// ---------------------------------------------------------------------------

import { getDb } from "../db/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppLogRow {
  id: number;
  level: string;
  category: string;
  message: string;
  metadata: string | null;
  sessionId: string | null;
  userId: string | null;
  createdAt: number;
}

export interface ErrorLogRow {
  id: number;
  level: string;
  category: string;
  message: string;
  stack: string | null;
  metadata: string | null;
  sessionId: string | null;
  userId: string | null;
  createdAt: number;
}

export interface ToolCallLogRow {
  id: number;
  tool: string;
  input: string | null;
  result: string | null;
  success: boolean;
  error: string | null;
  durationMs: number;
  context: string | null;
  sessionId: string | null;
  userId: string | null;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function toAppLogRow(row: Record<string, unknown>): AppLogRow {
  return {
    id: row.id as number,
    level: row.level as string,
    category: row.category as string,
    message: row.message as string,
    metadata: (row.metadata as string) ?? null,
    sessionId: (row.session_id as string) ?? null,
    userId: (row.user_id as string) ?? null,
    createdAt: row.created_at as number,
  };
}

function toErrorLogRow(row: Record<string, unknown>): ErrorLogRow {
  return {
    id: row.id as number,
    level: row.level as string,
    category: row.category as string,
    message: row.message as string,
    stack: (row.stack as string) ?? null,
    metadata: (row.metadata as string) ?? null,
    sessionId: (row.session_id as string) ?? null,
    userId: (row.user_id as string) ?? null,
    createdAt: row.created_at as number,
  };
}

function toToolCallLogRow(row: Record<string, unknown>): ToolCallLogRow {
  return {
    id: row.id as number,
    tool: row.tool as string,
    input: (row.input as string) ?? null,
    result: (row.result as string) ?? null,
    success: (row.success as number) === 1,
    error: (row.error as string) ?? null,
    durationMs: row.duration_ms as number,
    context: (row.context as string) ?? null,
    sessionId: (row.session_id as string) ?? null,
    userId: (row.user_id as string) ?? null,
    createdAt: row.created_at as number,
  };
}

// ---------------------------------------------------------------------------
// Application log queries
// ---------------------------------------------------------------------------

/**
 * Get recent application log entries.
 */
export function getAppLogs(opts?: {
  sinceMs?: number;
  level?: string;
  category?: string;
  limit?: number;
}): AppLogRow[] {
  const since = Date.now() - (opts?.sinceMs ?? 24 * 60 * 60 * 1000);
  const limit = opts?.limit ?? 100;
  const params: unknown[] = [since];

  let sql = "SELECT * FROM application_log WHERE created_at > ?";

  if (opts?.level) {
    sql += " AND level = ?";
    params.push(opts.level);
  }
  if (opts?.category) {
    sql += " AND category = ?";
    params.push(opts.category);
  }

  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  const rows = getDb().prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(toAppLogRow);
}

// ---------------------------------------------------------------------------
// Error log queries
// ---------------------------------------------------------------------------

/**
 * Get recent error log entries.
 */
export function getErrorLogs(opts?: {
  sinceMs?: number;
  category?: string;
  limit?: number;
}): ErrorLogRow[] {
  const since = Date.now() - (opts?.sinceMs ?? 24 * 60 * 60 * 1000);
  const limit = opts?.limit ?? 100;
  const params: unknown[] = [since];

  let sql = "SELECT * FROM error_log WHERE created_at > ?";

  if (opts?.category) {
    sql += " AND category = ?";
    params.push(opts.category);
  }

  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  const rows = getDb().prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(toErrorLogRow);
}

/**
 * Get error counts grouped by category in a time window.
 */
export function getErrorCountsByCategory(sinceMs?: number): Record<string, number> {
  const since = Date.now() - (sinceMs ?? 24 * 60 * 60 * 1000);
  const rows = getDb()
    .prepare(
      "SELECT category, COUNT(*) as count FROM error_log WHERE created_at > ? GROUP BY category ORDER BY count DESC",
    )
    .all(since) as { category: string; count: number }[];

  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.category] = row.count;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Tool call log queries
// ---------------------------------------------------------------------------

/**
 * Get recent tool call log entries.
 */
export function getToolCallLogs(opts?: {
  sinceMs?: number;
  tool?: string;
  successOnly?: boolean;
  failedOnly?: boolean;
  limit?: number;
}): ToolCallLogRow[] {
  const since = Date.now() - (opts?.sinceMs ?? 24 * 60 * 60 * 1000);
  const limit = opts?.limit ?? 100;
  const params: unknown[] = [since];

  let sql = "SELECT * FROM tool_call_log WHERE created_at > ?";

  if (opts?.tool) {
    sql += " AND tool = ?";
    params.push(opts.tool);
  }
  if (opts?.successOnly) {
    sql += " AND success = 1";
  }
  if (opts?.failedOnly) {
    sql += " AND success = 0";
  }

  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  const rows = getDb().prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(toToolCallLogRow);
}

/**
 * Get tool call statistics: call count, failure count, avg duration per tool.
 */
export function getToolCallStats(sinceMs?: number): {
  tool: string;
  totalCalls: number;
  failures: number;
  avgDurationMs: number;
  maxDurationMs: number;
}[] {
  const since = Date.now() - (sinceMs ?? 24 * 60 * 60 * 1000);
  const rows = getDb()
    .prepare(
      `SELECT
        tool,
        COUNT(*) as total_calls,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures,
        AVG(duration_ms) as avg_duration_ms,
        MAX(duration_ms) as max_duration_ms
      FROM tool_call_log
      WHERE created_at > ?
      GROUP BY tool
      ORDER BY total_calls DESC`,
    )
    .all(since) as {
    tool: string;
    total_calls: number;
    failures: number;
    avg_duration_ms: number;
    max_duration_ms: number;
  }[];

  return rows.map((r) => ({
    tool: r.tool,
    totalCalls: r.total_calls,
    failures: r.failures,
    avgDurationMs: Math.round(r.avg_duration_ms),
    maxDurationMs: r.max_duration_ms,
  }));
}

/**
 * Get the slowest tool calls in a time window.
 */
export function getSlowestToolCalls(opts?: {
  sinceMs?: number;
  limit?: number;
}): ToolCallLogRow[] {
  const since = Date.now() - (opts?.sinceMs ?? 24 * 60 * 60 * 1000);
  const limit = opts?.limit ?? 10;

  const rows = getDb()
    .prepare(
      "SELECT * FROM tool_call_log WHERE created_at > ? ORDER BY duration_ms DESC LIMIT ?",
    )
    .all(since, limit) as Record<string, unknown>[];

  return rows.map(toToolCallLogRow);
}

// ---------------------------------------------------------------------------
// Pruning
// ---------------------------------------------------------------------------

/**
 * Prune old log entries. Default retention: 7 days for app/tool logs, 30 days for errors.
 */
export function pruneLogs(opts?: {
  appRetentionMs?: number;
  errorRetentionMs?: number;
  toolRetentionMs?: number;
}): { appPruned: number; errorPruned: number; toolPruned: number } {
  const d = getDb();
  const now = Date.now();

  const appCutoff = now - (opts?.appRetentionMs ?? 7 * 24 * 60 * 60 * 1000);
  const errorCutoff = now - (opts?.errorRetentionMs ?? 30 * 24 * 60 * 60 * 1000);
  const toolCutoff = now - (opts?.toolRetentionMs ?? 7 * 24 * 60 * 60 * 1000);

  const appPruned = d.prepare("DELETE FROM application_log WHERE created_at < ?").run(appCutoff).changes;
  const errorPruned = d.prepare("DELETE FROM error_log WHERE created_at < ?").run(errorCutoff).changes;
  const toolPruned = d.prepare("DELETE FROM tool_call_log WHERE created_at < ?").run(toolCutoff).changes;

  return { appPruned, errorPruned, toolPruned };
}
