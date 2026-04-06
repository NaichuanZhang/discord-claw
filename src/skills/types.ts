// ---------------------------------------------------------------------------
// Skills management system – type definitions
// ---------------------------------------------------------------------------

/** Parsed from YAML frontmatter in SKILL.md files. */
export interface SkillFrontmatter {
  name: string;
  description: string;
  "user-invocable"?: string;
  "disable-model-invocation"?: string;
  [key: string]: string | undefined;
}

/** Discriminated union describing where a skill was installed from. */
export type SkillSource =
  | { type: "upload" }
  | { type: "github"; url: string }
  | { type: "local" };

/** Full runtime representation of an installed skill. */
export interface Skill {
  /** Unique identifier (nanoid). */
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  userInvocable: boolean;
  disableModelInvocation: boolean;
  /** Absolute path to the skill directory. */
  dirPath: string;
  /** Absolute path to SKILL.md. */
  filePath: string;
  /** Markdown body after frontmatter. */
  body: string;
  /** Full raw file content (frontmatter + body). */
  rawContent: string;
  source: SkillSource;
  /** Epoch milliseconds when the skill was first installed. */
  installedAt: number;
  /** Epoch milliseconds when the skill was last updated. */
  updatedAt: number;
}

/** Lightweight view of a Skill for API list responses (excludes large text fields). */
export type SkillSummary = Omit<Skill, "body" | "rawContent">;

/** Payload for installing a skill from a GitHub repository. */
export interface SkillInstallGitHub {
  url: string;
  name?: string;
}

/** Payload for installing a skill via direct content upload. */
export interface SkillInstallUpload {
  content: string;
  name?: string;
}

/** Fields that can be patched on an existing skill. */
export interface SkillPatch {
  enabled?: boolean;
  content?: string;
}

/** Lightweight persistence object stored in the skills data file. */
export interface SkillMeta {
  id: string;
  name: string;
  source: SkillSource;
  enabled: boolean;
  installedAt: number;
  updatedAt: number;
}

/** Top-level shape of the persisted skills store. */
export interface SkillsStoreData {
  version: 1;
  skills: SkillMeta[];
}
