import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import type { SkillMeta, SkillSource } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

const SKILLS_DIR = path.join(PROJECT_ROOT, "data", "skills");
const MAX_SKILL_SIZE = 256 * 1024; // 256 KB

function log(...args: unknown[]): void {
  console.log("[skills-store]", ...args);
}

/**
 * Per-skill metadata stored in each skill's own directory as .meta.json.
 * The skills list is derived by scanning directories — no central meta.json.
 */
interface PerSkillMeta {
  id: string;
  source: SkillSource;
  enabled: boolean;
  installedAt: number;
  updatedAt: number;
}

export class SkillStore {
  private skills: SkillMeta[] = [];

  /**
   * Scan the skills directory for subdirectories containing SKILL.md.
   * Each skill's own .meta.json provides id, source, enabled state.
   * If .meta.json is missing, we create defaults (local source, enabled).
   */
  load(): SkillMeta[] {
    this.skills = [];

    if (!fs.existsSync(SKILLS_DIR)) {
      fs.mkdirSync(SKILLS_DIR, { recursive: true });
      log("Created skills directory");
      return this.skills;
    }

    const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillDir = path.join(SKILLS_DIR, entry.name);
      const skillMdPath = path.join(skillDir, "SKILL.md");

      if (!fs.existsSync(skillMdPath)) continue;

      const name = entry.name;
      const metaPath = path.join(skillDir, ".meta.json");
      let perMeta: PerSkillMeta;

      try {
        const raw = fs.readFileSync(metaPath, "utf-8");
        perMeta = JSON.parse(raw) as PerSkillMeta;
      } catch {
        // No .meta.json or invalid — create defaults
        const now = Date.now();
        perMeta = {
          id: nanoid(),
          source: { type: "local" },
          enabled: true,
          installedAt: now,
          updatedAt: now,
        };
        this.writePerSkillMeta(skillDir, perMeta);
        log(`Created .meta.json for "${name}"`);
      }

      this.skills.push({
        id: perMeta.id,
        name,
        source: perMeta.source,
        enabled: perMeta.enabled,
        installedAt: perMeta.installedAt,
        updatedAt: perMeta.updatedAt,
      });
    }

    log(`Scanned ${this.skills.length} skill(s) from disk`);
    return this.skills;
  }

  /** Get all skill metadata (in-memory). */
  getMeta(): SkillMeta[] {
    return this.skills;
  }

  /** Get single skill metadata by ID. */
  getMetaById(id: string): SkillMeta | undefined {
    return this.skills.find((s) => s.id === id);
  }

  /** Get single skill metadata by name. */
  getMetaByName(name: string): SkillMeta | undefined {
    return this.skills.find((s) => s.name === name);
  }

  /** Add a new skill from content and source. */
  addSkill(name: string, content: string, source: SkillSource): SkillMeta {
    if (!SkillStore.validateName(name)) {
      throw new Error(
        `Invalid skill name "${name}": must match /^[a-z][a-z0-9-]{0,63}$/`,
      );
    }

    if (this.getMetaByName(name)) {
      throw new Error(`Skill "${name}" already exists`);
    }

    if (Buffer.byteLength(content, "utf-8") > MAX_SKILL_SIZE) {
      throw new Error(
        `Skill content exceeds maximum size of ${MAX_SKILL_SIZE} bytes`,
      );
    }

    const skillDir = this.getSkillDir(name);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), content, "utf-8");

    const now = Date.now();
    const perMeta: PerSkillMeta = {
      id: nanoid(),
      source,
      enabled: true,
      installedAt: now,
      updatedAt: now,
    };
    this.writePerSkillMeta(skillDir, perMeta);

    const meta: SkillMeta = {
      id: perMeta.id,
      name,
      source,
      enabled: perMeta.enabled,
      installedAt: now,
      updatedAt: now,
    };

    this.skills.push(meta);
    log(`Added skill "${name}" (${meta.id})`);
    return meta;
  }

  /** Update the SKILL.md content for an existing skill. */
  updateSkillContent(name: string, content: string): void {
    if (Buffer.byteLength(content, "utf-8") > MAX_SKILL_SIZE) {
      throw new Error(
        `Skill content exceeds maximum size of ${MAX_SKILL_SIZE} bytes`,
      );
    }

    const filePath = path.join(this.getSkillDir(name), "SKILL.md");
    fs.writeFileSync(filePath, content, "utf-8");
    log(`Updated content for skill "${name}"`);
  }

  /** Patch skill metadata fields. */
  updateSkillMeta(
    id: string,
    patch: Partial<Pick<SkillMeta, "enabled">>,
  ): SkillMeta | undefined {
    const meta = this.skills.find((s) => s.id === id);
    if (!meta) return undefined;

    Object.assign(meta, patch);
    meta.updatedAt = Date.now();

    // Persist to the skill's own .meta.json
    const skillDir = this.getSkillDir(meta.name);
    this.writePerSkillMeta(skillDir, {
      id: meta.id,
      source: meta.source,
      enabled: meta.enabled,
      installedAt: meta.installedAt,
      updatedAt: meta.updatedAt,
    });

    log(`Updated meta for skill "${meta.name}" (${meta.id})`);
    return meta;
  }

  /** Remove a skill by ID (deletes directory and metadata). */
  removeSkill(id: string): boolean {
    const meta = this.skills.find((s) => s.id === id);
    if (!meta) return false;

    this.skills = this.skills.filter((s) => s.id !== id);

    const skillDir = this.getSkillDir(meta.name);
    fs.rmSync(skillDir, { recursive: true, force: true });

    log(`Removed skill "${meta.name}" (${id})`);
    return true;
  }

  /** Read the SKILL.md content for a skill, or null if not found. */
  readSkillContent(name: string): string | null {
    const filePath = path.join(this.getSkillDir(name), "SKILL.md");
    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  /** Check whether a skill directory exists on disk. */
  skillDirExists(name: string): boolean {
    return fs.existsSync(this.getSkillDir(name));
  }

  /**
   * Add a skill by copying an entire source directory.
   * Used for GitHub installs where the repo contains scripts, references, etc.
   */
  addSkillFromDir(
    name: string,
    sourceDir: string,
    source: SkillSource,
  ): SkillMeta {
    if (!SkillStore.validateName(name)) {
      throw new Error(
        `Invalid skill name "${name}": must match /^[a-z][a-z0-9-]{0,63}$/`,
      );
    }

    if (this.getMetaByName(name)) {
      throw new Error(`Skill "${name}" already exists`);
    }

    const destDir = this.getSkillDir(name);
    fs.cpSync(sourceDir, destDir, { recursive: true });

    // Remove .git directory from the copy if present
    const gitDir = path.join(destDir, ".git");
    if (fs.existsSync(gitDir)) {
      fs.rmSync(gitDir, { recursive: true, force: true });
    }

    // Verify SKILL.md exists in the copied directory
    if (!fs.existsSync(path.join(destDir, "SKILL.md"))) {
      fs.rmSync(destDir, { recursive: true, force: true });
      throw new Error("No SKILL.md found in skill directory");
    }

    const now = Date.now();
    const perMeta: PerSkillMeta = {
      id: nanoid(),
      source,
      enabled: true,
      installedAt: now,
      updatedAt: now,
    };
    this.writePerSkillMeta(destDir, perMeta);

    const meta: SkillMeta = {
      id: perMeta.id,
      name,
      source,
      enabled: perMeta.enabled,
      installedAt: now,
      updatedAt: now,
    };

    this.skills.push(meta);
    log(`Added skill "${name}" (${meta.id}) from directory`);
    return meta;
  }

  /** Get the absolute path to a skill's directory. */
  getSkillDir(name: string): string {
    return path.join(SKILLS_DIR, name);
  }

  /** Sanitize a raw string into a valid skill name. */
  static sanitizeName(raw: string): string {
    return raw
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
  }

  /** Validate that a name conforms to the skill naming rules. */
  static validateName(name: string): boolean {
    return /^[a-z][a-z0-9-]{0,63}$/.test(name);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private writePerSkillMeta(skillDir: string, meta: PerSkillMeta): void {
    const metaPath = path.join(skillDir, ".meta.json");
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
