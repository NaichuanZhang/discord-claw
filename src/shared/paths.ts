// ---------------------------------------------------------------------------
// Shared path constants — single source of truth for all directory paths
// ---------------------------------------------------------------------------

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the project root directory. */
export const PROJECT_ROOT = join(__dirname, "..", "..");

/** Absolute path to the data/ directory. */
export const DATA_DIR = join(PROJECT_ROOT, "data");

/** Absolute path to the data/skills/ directory. */
export const SKILLS_DIR = join(PROJECT_ROOT, "data", "skills");

/**
 * @deprecated Use getWorktreeDir(evolutionId) instead.
 * Kept for backward compatibility but should not be used for new code.
 */
export const BETA_DIR = join(PROJECT_ROOT, "beta");

/** Base directory for all evolution worktrees. */
export const WORKTREES_DIR = join(PROJECT_ROOT, "worktrees");

/**
 * Get the worktree directory for a specific evolution.
 * Each evolution gets its own isolated worktree under worktrees/<id>/.
 */
export function getWorktreeDir(evolutionId: string): string {
  return join(WORKTREES_DIR, evolutionId);
}
