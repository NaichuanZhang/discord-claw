import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import type { SkillMeta, SkillSource, SkillsStoreData } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

const SKILLS_DIR = path.join(PROJECT_ROOT, "data", "skills");
const META_PATH = path.join(SKILLS_DIR, "meta.json");
const META_TMP_PATH = META_PATH + ".tmp";
const MAX_SKILL_SIZE = 256 * 1024; // 256 KB

function log(...args: unknown[]): void {
  console.log("[skills-store]", ...args);
}

export class SkillStore {
  private skills: SkillMeta[] = [];

  /** Load skill metadata from disk (or create empty store). */
  load(): SkillMeta[] {
    try {
      const raw = fs.readFileSync(META_PATH, "utf-8");
      const data: SkillsStoreData = JSON.parse(raw);
      this.skills = data.skills ?? [];
      log(`Loaded ${this.skills.length} skill(s) from disk`);
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === "ENOENT") {
        log("No meta file found, starting with empty store");
        this.skills = [];
      } else {
        log("Error loading meta file, starting with empty store:", err);
        this.skills = [];
      }
    }
    return this.skills;
  }

  /** Save current skill metadata to disk (atomic: write temp file, then rename). */
  save(): void {
    const data: SkillsStoreData = { version: 1, skills: this.skills };
    const dir = path.dirname(META_PATH);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(META_TMP_PATH, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(META_TMP_PATH, META_PATH);
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
    const meta: SkillMeta = {
      id: nanoid(),
      name,
      source,
      enabled: true,
      installedAt: now,
      updatedAt: now,
    };

    this.skills.push(meta);
    this.save();
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
    this.save();
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

    this.save();
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
    const meta: SkillMeta = {
      id: nanoid(),
      name,
      source,
      enabled: true,
      installedAt: now,
      updatedAt: now,
    };

    this.skills.push(meta);
    this.save();
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
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
