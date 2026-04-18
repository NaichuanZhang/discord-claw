// ---------------------------------------------------------------------------
// Evolution log — SQLite-backed history of all evolutions
// ---------------------------------------------------------------------------

import { nanoid } from "nanoid";
import { getDb } from "../db/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EvolutionStatus =
  | "idea"
  | "proposing"
  | "proposed"
  | "deployed"
  | "rolled_back"
  | "cancelled"
  | "rejected";

export type EvolutionMode = "local" | "daytona";

export interface Evolution {
  id: string;
  triggeredBy: string | null;
  triggerMessage: string | null;
  branch: string | null;
  prUrl: string | null;
  prNumber: number | null;
  status: EvolutionStatus;
  changesSummary: string | null;
  filesChanged: string[] | null;
  sandboxId: string | null;
  mode: EvolutionMode | null;
  createdAt: number;
  proposedAt: number | null;
  mergedAt: number | null;
  deployedAt: number | null;
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function rowToEvolution(row: Record<string, unknown>): Evolution {
  return {
    id: row.id as string,
    triggeredBy: (row.triggered_by as string) ?? null,
    triggerMessage: (row.trigger_message as string) ?? null,
    branch: (row.branch as string) ?? null,
    prUrl: (row.pr_url as string) ?? null,
    prNumber: (row.pr_number as number) ?? null,
    status: row.status as EvolutionStatus,
    changesSummary: (row.changes_summary as string) ?? null,
    filesChanged: row.files_changed
      ? (JSON.parse(row.files_changed as string) as string[])
      : null,
    sandboxId: (row.sandbox_id as string) ?? null,
    mode: (row.mode as EvolutionMode) ?? null,
    createdAt: row.created_at as number,
    proposedAt: (row.proposed_at as number) ?? null,
    mergedAt: (row.merged_at as number) ?? null,
    deployedAt: (row.deployed_at as number) ?? null,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function createEvolution(opts: {
  triggeredBy: string;
  triggerMessage?: string;
  branch?: string;
  status?: EvolutionStatus;
  sandboxId?: string;
  mode?: EvolutionMode;
}): Evolution {
  const id = nanoid();
  const now = Date.now();
  const status = opts.status ?? "idea";

  getDb()
    .prepare(
      `INSERT INTO evolutions (id, triggered_by, trigger_message, branch, status, sandbox_id, mode, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      opts.triggeredBy,
      opts.triggerMessage ?? null,
      opts.branch ?? null,
      status,
      opts.sandboxId ?? null,
      opts.mode ?? null,
      now,
    );

  return {
    id,
    triggeredBy: opts.triggeredBy,
    triggerMessage: opts.triggerMessage ?? null,
    branch: opts.branch ?? null,
    prUrl: null,
    prNumber: null,
    status,
    changesSummary: null,
    filesChanged: null,
    sandboxId: opts.sandboxId ?? null,
    mode: opts.mode ?? null,
    createdAt: now,
    proposedAt: null,
    mergedAt: null,
    deployedAt: null,
  };
}

export function getEvolution(id: string): Evolution | undefined {
  const row = getDb()
    .prepare("SELECT * FROM evolutions WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToEvolution(row) : undefined;
}

export function getActiveEvolution(): Evolution | undefined {
  const row = getDb()
    .prepare("SELECT * FROM evolutions WHERE status = 'proposing' LIMIT 1")
    .get() as Record<string, unknown> | undefined;
  return row ? rowToEvolution(row) : undefined;
}

export function listEvolutions(filter?: {
  status?: EvolutionStatus;
}): Evolution[] {
  const db = getDb();
  let sql = "SELECT * FROM evolutions";
  const params: unknown[] = [];

  if (filter?.status) {
    sql += " WHERE status = ?";
    params.push(filter.status);
  }

  sql += " ORDER BY created_at DESC";

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(rowToEvolution);
}

export function getIdeas(): Evolution[] {
  return listEvolutions({ status: "idea" });
}

export function getDeployedEvolutions(): Evolution[] {
  return listEvolutions({ status: "deployed" });
}

export function updateEvolution(
  id: string,
  fields: Partial<{
    status: EvolutionStatus;
    branch: string;
    prUrl: string;
    prNumber: number;
    changesSummary: string;
    filesChanged: string[];
    sandboxId: string;
    mode: EvolutionMode;
    proposedAt: number;
    mergedAt: number;
    deployedAt: number;
  }>,
): void {
  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (fields.status !== undefined) {
    setClauses.push("status = ?");
    params.push(fields.status);
  }
  if (fields.branch !== undefined) {
    setClauses.push("branch = ?");
    params.push(fields.branch);
  }
  if (fields.prUrl !== undefined) {
    setClauses.push("pr_url = ?");
    params.push(fields.prUrl);
  }
  if (fields.prNumber !== undefined) {
    setClauses.push("pr_number = ?");
    params.push(fields.prNumber);
  }
  if (fields.changesSummary !== undefined) {
    setClauses.push("changes_summary = ?");
    params.push(fields.changesSummary);
  }
  if (fields.filesChanged !== undefined) {
    setClauses.push("files_changed = ?");
    params.push(JSON.stringify(fields.filesChanged));
  }
  if (fields.sandboxId !== undefined) {
    setClauses.push("sandbox_id = ?");
    params.push(fields.sandboxId);
  }
  if (fields.mode !== undefined) {
    setClauses.push("mode = ?");
    params.push(fields.mode);
  }
  if (fields.proposedAt !== undefined) {
    setClauses.push("proposed_at = ?");
    params.push(fields.proposedAt);
  }
  if (fields.mergedAt !== undefined) {
    setClauses.push("merged_at = ?");
    params.push(fields.mergedAt);
  }
  if (fields.deployedAt !== undefined) {
    setClauses.push("deployed_at = ?");
    params.push(fields.deployedAt);
  }

  if (setClauses.length === 0) return;

  params.push(id);
  getDb()
    .prepare(`UPDATE evolutions SET ${setClauses.join(", ")} WHERE id = ?`)
    .run(...params);
}
