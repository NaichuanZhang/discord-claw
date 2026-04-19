// ---------------------------------------------------------------------------
// Evolution tools — agent-facing tools for self-modification
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  startEvolution,
  finalizeEvolution,
  cancelEvolution,
  mergeEvolution,
  recordSuggestion,
  getBetaDir,
  gh,
} from "./engine.js";
import { getActiveEvolution, getEvolution, listEvolutions, resolveEvolution } from "./log.js";

const execFileAsync = promisify(execFile);

const MAX_OUTPUT = 8192;
const BASH_TIMEOUT = 30_000;

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const evolutionTools = [
  {
    name: "evolve_start",
    description:
      "Start a new evolution session. Creates an isolated git worktree at beta/ for making source code changes. All changes will be submitted as a GitHub PR. Only one evolution can be active at a time.",
    input_schema: {
      type: "object" as const,
      properties: {
        reason: {
          type: "string",
          description: "Why this evolution is needed — what capability to add or change",
        },
      },
      required: ["reason"],
    },
  },
  {
    name: "evolve_read",
    description:
      "Read a file from the beta/ worktree during an active evolution. Use this to understand existing code before modifying it.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "File path relative to repo root (e.g. 'src/agent/agent.ts')",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "evolve_write",
    description:
      "Write a file in the beta/ worktree during an active evolution. Creates parent directories as needed. For source code changes to src/, TypeScript files, start.sh, or migrations.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "File path relative to repo root (e.g. 'src/evolution/new-feature.ts')",
        },
        content: {
          type: "string",
          description: "Content to write to the file",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "evolve_bash",
    description:
      "Execute a shell command in the beta/ worktree context during an active evolution. Use for running typecheck, inspecting state, etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute (cwd is beta/)",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default 30000, max 60000)",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "evolve_propose",
    description:
      "Finalize the current evolution: runs typecheck, commits all changes, pushes branch, and creates a GitHub PR. Fails if typecheck doesn't pass.",
    input_schema: {
      type: "object" as const,
      properties: {
        summary: {
          type: "string",
          description: "Short description for the PR title and commit message",
        },
      },
      required: ["summary"],
    },
  },
  {
    name: "evolve_suggest",
    description:
      "Record an idea for a potential improvement. Use this when you encounter a limitation you could fix by modifying your own code. Does NOT start an evolution — just records the idea for later review.",
    input_schema: {
      type: "object" as const,
      properties: {
        what: {
          type: "string",
          description: "What capability is missing or what could be improved",
        },
        why: {
          type: "string",
          description: "Context for why this improvement would be useful",
        },
      },
      required: ["what", "why"],
    },
  },
  {
    name: "evolve_cancel",
    description:
      "Cancel the current active evolution session. Cleans up the worktree and deletes the branch. Use if you need to abandon an in-progress evolution.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "evolve_review",
    description:
      "Review a proposed evolution PR. Shows summary, changed files, and diff. If no id is provided, shows the most recent proposed evolution.",
    input_schema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Evolution id to review. If omitted, reviews the most recent proposed evolution.",
        },
      },
      required: [],
    },
  },
  {
    name: "evolve_merge",
    description:
      "Merge a proposed evolution PR and restart the bot to deploy the changes. The user must have reviewed the PR first via evolve_review.",
    input_schema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Evolution id to merge",
        },
      },
      required: ["id"],
    },
  },
];

// ---------------------------------------------------------------------------
// Path safety for worktree
// ---------------------------------------------------------------------------

function safeWorktreePath(relativePath: string): string | null {
  const betaDir = getBetaDir();
  const resolved = path.resolve(betaDir, relativePath);
  if (!resolved.startsWith(betaDir + "/") && resolved !== betaDir) {
    return null; // Path traversal attempt
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Context for tracking the triggering channel
// ---------------------------------------------------------------------------

let _currentChannelId: string | undefined;
let _currentUserId: string | undefined;

export function setEvolutionContext(channelId?: string, userId?: string): void {
  _currentChannelId = channelId;
  _currentUserId = userId;
}

// ---------------------------------------------------------------------------
// GitHub PR query helpers (live data, no DB)
// ---------------------------------------------------------------------------

interface GitHubPR {
  number: number;
  title: string;
  state: string;
  url: string;
  headRefName: string;
  changedFiles: number;
  additions: number;
  deletions: number;
  files?: { path: string }[];
}

/**
 * List open PRs from GitHub. Always fresh data.
 */
async function listOpenPRs(): Promise<GitHubPR[]> {
  try {
    const { stdout } = await gh([
      "pr", "list",
      "--state", "open",
      "--json", "number,title,state,url,headRefName,changedFiles,additions,deletions",
    ]);
    return JSON.parse(stdout) as GitHubPR[];
  } catch {
    return [];
  }
}

/**
 * Get a single PR by number from GitHub.
 */
async function getPRByNumber(prNumber: number): Promise<GitHubPR | null> {
  try {
    const { stdout } = await gh([
      "pr", "view", String(prNumber),
      "--json", "number,title,state,url,headRefName,changedFiles,additions,deletions,files",
    ]);
    return JSON.parse(stdout) as GitHubPR;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tool handler
// ---------------------------------------------------------------------------

export async function handleEvolutionTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  try {
    switch (name) {
      case "evolve_start": {
        const reason = input.reason as string;
        const evolution = await startEvolution({
          reason,
          triggeredBy: _currentUserId ?? "unknown",
          channelId: _currentChannelId,
        });
        return JSON.stringify({
          success: true,
          evolution_id: evolution.id,
          branch: evolution.branch,
          message: `Evolution started. Make changes using evolve_write/evolve_read/evolve_bash, then call evolve_propose to submit the PR.`,
        });
      }

      case "evolve_read": {
        const active = getActiveEvolution();
        if (!active) {
          return JSON.stringify({ error: "No active evolution. Call evolve_start first." });
        }

        const filePath = input.path as string;
        const absPath = safeWorktreePath(filePath);
        if (!absPath) {
          return JSON.stringify({ error: "Invalid path — must be within the repository" });
        }

        if (!fs.existsSync(absPath)) {
          return JSON.stringify({ error: `File not found: ${filePath}` });
        }

        const stat = fs.statSync(absPath);
        if (stat.isDirectory()) {
          return JSON.stringify({ error: `"${filePath}" is a directory` });
        }
        if (stat.size > 256 * 1024) {
          return JSON.stringify({ error: `File too large: ${stat.size} bytes (max 256KB)` });
        }

        const content = fs.readFileSync(absPath, "utf-8");
        return JSON.stringify({ path: filePath, content });
      }

      case "evolve_write": {
        const active = getActiveEvolution();
        if (!active) {
          return JSON.stringify({ error: "No active evolution. Call evolve_start first." });
        }

        const filePath = input.path as string;
        const content = input.content as string;
        const absPath = safeWorktreePath(filePath);
        if (!absPath) {
          return JSON.stringify({ error: "Invalid path — must be within the repository" });
        }

        const dir = path.dirname(absPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(absPath, content, "utf-8");
        return JSON.stringify({ success: true, path: filePath });
      }

      case "evolve_bash": {
        const active = getActiveEvolution();
        if (!active) {
          return JSON.stringify({ error: "No active evolution. Call evolve_start first." });
        }

        const command = input.command as string;
        const timeout = Math.min(
          (input.timeout as number) || BASH_TIMEOUT,
          60_000,
        );

        try {
          const { stdout, stderr } = await execFileAsync(
            "/bin/bash",
            ["-c", command],
            { cwd: getBetaDir(), timeout, maxBuffer: 1024 * 1024 },
          );

          const out = stdout.length > MAX_OUTPUT
            ? stdout.slice(0, MAX_OUTPUT) + "\n... (truncated)"
            : stdout;
          const err = stderr.length > MAX_OUTPUT
            ? stderr.slice(0, MAX_OUTPUT) + "\n... (truncated)"
            : stderr;

          return JSON.stringify({ exit_code: 0, stdout: out, stderr: err || undefined });
        } catch (execErr: any) {
          return JSON.stringify({
            exit_code: execErr.code ?? 1,
            stdout: (execErr.stdout || "").slice(0, MAX_OUTPUT),
            stderr: (execErr.stderr || execErr.message || "").slice(0, MAX_OUTPUT),
          });
        }
      }

      case "evolve_propose": {
        const active = getActiveEvolution();
        if (!active) {
          return JSON.stringify({ error: "No active evolution. Call evolve_start first." });
        }

        const summary = input.summary as string;
        const result = await finalizeEvolution({
          id: active.id,
          summary,
          channelId: _currentChannelId,
        });

        return JSON.stringify({
          success: true,
          pr_url: result.prUrl,
          pr_number: result.prNumber,
          message: `PR created: ${result.prUrl}`,
        });
      }

      case "evolve_suggest": {
        const what = input.what as string;
        const why = input.why as string;
        const evolution = recordSuggestion({
          what,
          why,
          triggeredBy: _currentUserId ?? "unknown",
        });

        return JSON.stringify({
          success: true,
          idea_id: evolution.id,
          message: "Suggestion recorded. It can be reviewed and implemented later.",
        });
      }

      case "evolve_cancel": {
        const active = getActiveEvolution();
        if (!active) {
          return JSON.stringify({ error: "No active evolution to cancel." });
        }
        await cancelEvolution(active.id);
        return JSON.stringify({
          success: true,
          message: `Evolution ${active.id} cancelled.`,
        });
      }

      case "evolve_review": {
        const id = input.id as string | undefined;

        // If an evolution id is provided, look it up (supports both nanoid and PR number)
        if (id) {
          const evolution = resolveEvolution(id);
          if (!evolution) {
            return JSON.stringify({ error: `Evolution not found: ${id}. Try the nanoid or PR number.` });
          }
          if (!evolution.prNumber) {
            return JSON.stringify({ error: `Evolution ${evolution.id} has no PR number.` });
          }

          // Fetch live PR data from GitHub
          const pr = await getPRByNumber(evolution.prNumber);
          if (!pr) {
            return JSON.stringify({ error: `PR #${evolution.prNumber} not found on GitHub. It may have been closed or merged.` });
          }

          let diff = "";
          try {
            const { stdout } = await gh(["pr", "diff", String(pr.number)]);
            diff = stdout.length > MAX_OUTPUT
              ? stdout.slice(0, MAX_OUTPUT) + "\n... (truncated)"
              : stdout;
          } catch (err: any) {
            diff = `(Failed to fetch diff: ${err.message})`;
          }

          return JSON.stringify({
            id: evolution.id,
            pr_number: pr.number,
            pr_url: pr.url,
            title: pr.title,
            state: pr.state,
            branch: pr.headRefName,
            summary: evolution.changesSummary,
            files_changed: pr.files?.map((f) => f.path) ?? evolution.filesChanged,
            additions: pr.additions,
            deletions: pr.deletions,
            diff,
          });
        }

        // No id provided — find most recent open PR from GitHub
        const openPRs = await listOpenPRs();
        if (openPRs.length === 0) {
          return JSON.stringify({ error: "No open PRs found on GitHub." });
        }

        // Pick the most recent (highest number)
        const latestPR = openPRs.reduce((a, b) => a.number > b.number ? a : b);

        let diff = "";
        try {
          const { stdout } = await gh(["pr", "diff", String(latestPR.number)]);
          diff = stdout.length > MAX_OUTPUT
            ? stdout.slice(0, MAX_OUTPUT) + "\n... (truncated)"
            : stdout;
        } catch (err: any) {
          diff = `(Failed to fetch diff: ${err.message})`;
        }

        // Try to find matching DB evolution for extra context
        const proposed = listEvolutions({ status: "proposed" });
        const matchingEvo = proposed.find((e) => e.prNumber === latestPR.number);

        return JSON.stringify({
          id: matchingEvo?.id ?? null,
          pr_number: latestPR.number,
          pr_url: latestPR.url,
          title: latestPR.title,
          state: latestPR.state,
          branch: latestPR.headRefName,
          summary: matchingEvo?.changesSummary ?? latestPR.title,
          changed_files: latestPR.changedFiles,
          additions: latestPR.additions,
          deletions: latestPR.deletions,
          diff,
        });
      }

      case "evolve_merge": {
        const id = input.id as string;
        // Resolve by nanoid or PR number
        const evolution = resolveEvolution(id);
        if (!evolution) {
          return JSON.stringify({ error: `Evolution not found: ${id}. Try the nanoid or PR number.` });
        }
        await mergeEvolution({ id: evolution.id, channelId: _currentChannelId });
        return JSON.stringify({
          success: true,
          message: "PR merged. Restarting to deploy...",
        });
      }

      default:
        return JSON.stringify({ error: `Unknown evolution tool: ${name}` });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[evolution] Tool "${name}" failed:`, msg);
    return JSON.stringify({ error: msg });
  }
}
