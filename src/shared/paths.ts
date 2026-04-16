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

/** Absolute path to the beta/ worktree directory (used by evolution engine). */
export const BETA_DIR = join(PROJECT_ROOT, "beta");
