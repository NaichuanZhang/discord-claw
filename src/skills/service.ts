import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, cp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { SkillStore } from "./store.js";
import type {
  Skill,
  SkillSummary,
  SkillMeta,
  SkillFrontmatter,
  SkillInstallGitHub,
  SkillInstallUpload,
  SkillPatch,
  SkillSource,
} from "./types.js";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const SKILLS_DIR = path.join(PROJECT_ROOT, "data", "skills");
const MAX_SKILLS_PROMPT_CHARS = 8000;

// ---------------------------------------------------------------------------
// Module-level singleton accessor (for agent.ts to import)
// ---------------------------------------------------------------------------

let _instance: SkillService | null = null;

export function getSkillService(): SkillService | null {
  return _instance;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(...args: unknown[]): void {
  console.log("[skills]", ...args);
}

/**
 * Parse YAML-like frontmatter from a SKILL.md file.
 * No external YAML dependency — only handles simple `key: value` lines.
 */
function parseFrontmatter(content: string): {
  frontmatter: SkillFrontmatter;
  body: string;
} {
  const lines = content.split("\n");

  // Must start with ---
  if (lines[0]?.trim() !== "---") {
    return {
      frontmatter: {} as SkillFrontmatter,
      body: content,
    };
  }

  // Find the closing ---
  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      closingIndex = i;
      break;
    }
  }

  if (closingIndex === -1) {
    return {
      frontmatter: {} as SkillFrontmatter,
      body: content,
    };
  }

  // Parse key: value lines between the fences
  const frontmatter: Record<string, string> = {};
  for (let i = 1; i < closingIndex; i++) {
    const line = lines[i]!.trim();
    if (!line || line.startsWith("#")) continue;

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    frontmatter[key] = value;
  }

  const body = lines.slice(closingIndex + 1).join("\n");

  return { frontmatter: frontmatter as SkillFrontmatter, body };
}

// ---------------------------------------------------------------------------
// GitHub URL parser
// ---------------------------------------------------------------------------

type GitHubUrlInfo =
  | { type: "repo"; owner: string; repo: string; branch?: string; path?: string }
  | { type: "raw"; url: string };

function parseGitHubUrl(url: string): GitHubUrlInfo {
  const parsed = new URL(url);

  // raw.githubusercontent.com/* -> { type: "raw", url }
  if (parsed.hostname === "raw.githubusercontent.com") {
    return { type: "raw", url };
  }

  // github.com/owner/repo[/tree/branch/path]
  const segments = parsed.pathname.split("/").filter(Boolean);

  if (segments.length < 2) {
    throw new Error(`Invalid GitHub URL: ${url}`);
  }

  const owner = segments[0]!;
  let repo = segments[1]!;

  // Strip .git suffix
  if (repo.endsWith(".git")) {
    repo = repo.slice(0, -4);
  }

  // github.com/owner/repo/tree/branch/path...
  if (segments.length >= 4 && segments[2] === "tree") {
    const branch = segments[3]!;
    const subPath = segments.length > 4 ? segments.slice(4).join("/") : undefined;
    return { type: "repo", owner, repo, branch, path: subPath };
  }

  return { type: "repo", owner, repo };
}

// ---------------------------------------------------------------------------
// SKILL.md finder
// ---------------------------------------------------------------------------

/**
 * Recursively look for SKILL.md in a directory.
 * Checks the root first, then one level deep.
 */
function findSkillMd(dir: string): string | null {
  // Check dir/SKILL.md first
  const rootPath = path.join(dir, "SKILL.md");
  if (fs.existsSync(rootPath)) {
    return rootPath;
  }

  // Then check dir/*/SKILL.md one level deep
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const nestedPath = path.join(dir, entry.name, "SKILL.md");
      if (fs.existsSync(nestedPath)) {
        return nestedPath;
      }
    }
  } catch {
    // Directory might not exist or be unreadable
  }

  return null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SkillService {
  private store: SkillStore;
  private skills: Map<string, Skill> = new Map(); // id -> Skill
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.store = new SkillStore();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async init(): Promise<void> {
    this.store.load();
    this.reloadAll();
    this.startWatcher();
    _instance = this;
    log(`Initialized with ${this.skills.size} skill(s)`);
  }

  stop(): void {
    this.stopWatcher();
    _instance = null;
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  list(): SkillSummary[] {
    return Array.from(this.skills.values()).map(toSummary);
  }

  get(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  getByName(name: string): Skill | undefined {
    return Array.from(this.skills.values()).find((s) => s.name === name);
  }

  async installFromUpload(opts: SkillInstallUpload): Promise<Skill> {
    const { frontmatter } = parseFrontmatter(opts.content);
    const name = SkillStore.sanitizeName(
      opts.name || frontmatter.name || "unnamed-skill",
    );
    if (!SkillStore.validateName(name))
      throw new Error(`Invalid skill name: ${name}`);
    if (this.store.skillDirExists(name))
      throw new Error(`Skill "${name}" already exists`);

    const source: SkillSource = { type: "upload" };
    const meta = this.store.addSkill(name, opts.content, source);
    const skill = this.parseSkillFile(name, opts.content, meta);
    this.skills.set(skill.id, skill);
    return skill;
  }

  async installFromGitHub(opts: SkillInstallGitHub): Promise<Skill> {
    const info = parseGitHubUrl(opts.url);
    let content: string;
    let detectedName: string | undefined;
    let meta: SkillMeta;

    if (info.type === "raw") {
      // Fetch raw content directly (single file — no companion files)
      const resp = await fetch(info.url);
      if (!resp.ok)
        throw new Error(`Failed to fetch: ${resp.status} ${resp.statusText}`);
      content = await resp.text();

      const { frontmatter } = parseFrontmatter(content);
      const name = SkillStore.sanitizeName(
        opts.name || frontmatter.name || "unnamed-skill",
      );
      if (!SkillStore.validateName(name))
        throw new Error(`Invalid skill name: ${name}`);
      if (this.store.skillDirExists(name))
        throw new Error(`Skill "${name}" already exists`);

      const source: SkillSource = { type: "github", url: opts.url };
      meta = this.store.addSkill(name, content, source);
    } else {
      // Clone repo to temp dir, copy FULL skill directory (not just SKILL.md)
      const tmpDir = await mkdtemp(path.join(tmpdir(), "skill-"));
      try {
        const cloneArgs = ["clone", "--depth", "1"];
        if (info.branch) cloneArgs.push("--branch", info.branch);
        cloneArgs.push(
          `https://github.com/${info.owner}/${info.repo}.git`,
          tmpDir,
        );

        await execFileAsync("git", cloneArgs, { timeout: 30_000 });

        // Look for SKILL.md in the specified path or root
        const searchDir = info.path ? path.join(tmpDir, info.path) : tmpDir;
        const skillMdPath = findSkillMd(searchDir);
        if (!skillMdPath) throw new Error("No SKILL.md found in repository");

        // The skill directory is the parent of SKILL.md
        const skillDir = path.dirname(skillMdPath);
        content = await readFile(skillMdPath, "utf-8");
        detectedName = info.repo;

        const { frontmatter } = parseFrontmatter(content);
        const name = SkillStore.sanitizeName(
          opts.name || frontmatter.name || detectedName || "unnamed-skill",
        );
        if (!SkillStore.validateName(name))
          throw new Error(`Invalid skill name: ${name}`);
        if (this.store.skillDirExists(name))
          throw new Error(`Skill "${name}" already exists`);

        const source: SkillSource = { type: "github", url: opts.url };
        // Copy the full directory (scripts, references, etc.)
        meta = this.store.addSkillFromDir(name, skillDir, source);
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    }

    // Read the installed content and parse
    const installedContent =
      this.store.readSkillContent(meta.name) || content;
    const skill = this.parseSkillFile(meta.name, installedContent, meta);
    this.skills.set(skill.id, skill);
    return skill;
  }

  async update(id: string, patch: SkillPatch): Promise<Skill | undefined> {
    const existing = this.skills.get(id);
    if (!existing) return undefined;

    if (patch.content !== undefined) {
      this.store.updateSkillContent(existing.name, patch.content);
    }
    if (patch.enabled !== undefined) {
      this.store.updateSkillMeta(id, { enabled: patch.enabled });
    }

    // Re-parse the skill
    const meta = this.store.getMetaById(id);
    if (!meta) return undefined;
    const content = this.store.readSkillContent(existing.name);
    if (!content) return undefined;

    const skill = this.parseSkillFile(existing.name, content, meta);
    this.skills.set(id, skill);
    return skill;
  }

  remove(id: string): boolean {
    const removed = this.store.removeSkill(id);
    if (removed) {
      this.skills.delete(id);
    }
    return removed;
  }

  // ---------------------------------------------------------------------------
  // System prompt
  // ---------------------------------------------------------------------------

  buildSkillsPromptSection(): string {
    const enabled = this.getEnabledSkills();
    if (enabled.length === 0) return "";

    // SDK pattern: metadata-only listing with on-demand loading via read_skill tool
    const lines = [
      "## Skills",
      "",
      "The following skills are available. Use the `read_skill` tool to load a skill's full instructions when the task matches its description. When a skill file references a relative path (e.g., `./scripts/helper.py`), use `list_skill_files` to discover companion files and `read_skill` with the `file` parameter to read them.",
      "",
      "<available_skills>",
    ];

    for (const skill of enabled) {
      lines.push("  <skill>");
      lines.push(`    <name>${skill.name}</name>`);
      if (skill.description) {
        lines.push(`    <description>${skill.description}</description>`);
      }
      lines.push(`    <location>${skill.filePath}</location>`);
      lines.push("  </skill>");
    }

    lines.push("</available_skills>");

    return lines.join("\n");
  }

  getEnabledSkills(): Skill[] {
    return Array.from(this.skills.values()).filter((s) => s.enabled);
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private parseSkillFile(
    name: string,
    content: string,
    meta: SkillMeta,
  ): Skill {
    const { frontmatter, body } = parseFrontmatter(content);
    const skillDir = this.store.getSkillDir(name);

    return {
      id: meta.id,
      name: meta.name,
      description: frontmatter.description || "",
      enabled: meta.enabled,
      userInvocable: frontmatter["user-invocable"] !== "false",
      disableModelInvocation:
        frontmatter["disable-model-invocation"] === "true",
      dirPath: skillDir,
      filePath: path.join(skillDir, "SKILL.md"),
      body,
      rawContent: content,
      source: meta.source,
      installedAt: meta.installedAt,
      updatedAt: meta.updatedAt,
    };
  }

  private reloadAll(): void {
    this.skills.clear();
    for (const meta of this.store.getMeta()) {
      const content = this.store.readSkillContent(meta.name);
      if (!content) {
        log(`Warning: no SKILL.md found for "${meta.name}", skipping`);
        continue;
      }
      const skill = this.parseSkillFile(meta.name, content, meta);
      this.skills.set(skill.id, skill);
    }
  }

  private startWatcher(): void {
    try {
      this.watcher = fs.watch(
        SKILLS_DIR,
        { recursive: true },
        (_event, filename) => {
          if (!filename?.endsWith(".md")) return;
          if (this.debounceTimer) clearTimeout(this.debounceTimer);
          this.debounceTimer = setTimeout(() => {
            this.store.load();
            this.reloadAll();
            log("Re-loaded skills after file change");
          }, 1500);
        },
      );
    } catch {
      log("Warning: could not start file watcher for skills directory");
    }
  }

  private stopWatcher(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip body/rawContent for list responses. */
function toSummary(skill: Skill): SkillSummary {
  const { body, rawContent, ...rest } = skill;
  return rest;
}
