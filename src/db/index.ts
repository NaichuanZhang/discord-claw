import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Session {
  id: string;
  discordKey: string;
  agentSessionId?: string;
  guildId?: string;
  channelId?: string;
  userId?: string;
  createdAt: number;
  lastActive: number;
}

export interface Message {
  id: number;
  sessionId: string;
  role: string;
  content: string;
  discordMessageId?: string;
  createdAt: number;
  // Token usage (populated for assistant messages)
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

export interface TokenUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface ChannelConfig {
  channelId: string;
  guildId?: string;
  enabled: boolean;
  systemPrompt?: string;
  settings: Record<string, unknown>;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Database path — resolve relative to project root
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..", ".."); // src/db -> src -> root
const DB_DIR = join(PROJECT_ROOT, "data");
const DB_PATH = join(DB_DIR, "discordclaw.db");

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    if (!existsSync(DB_DIR)) {
      mkdirSync(DB_DIR, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
  }
  return db;
}

// ---------------------------------------------------------------------------
// Schema initialisation
// ---------------------------------------------------------------------------

export function initDb(): void {
  const d = getDb();

  d.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      discord_key TEXT NOT NULL UNIQUE,
      agent_session_id TEXT,
      guild_id TEXT,
      channel_id TEXT,
      user_id TEXT,
      created_at INTEGER NOT NULL,
      last_active INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      discord_message_id TEXT,
      created_at INTEGER NOT NULL,
      model TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cache_creation_tokens INTEGER,
      cache_read_tokens INTEGER
    );

    CREATE TABLE IF NOT EXISTS channel_configs (
      channel_id TEXT PRIMARY KEY,
      guild_id TEXT,
      enabled INTEGER DEFAULT 1,
      system_prompt TEXT,
      settings TEXT DEFAULT '{}',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      path,
      chunk_text,
      start_line UNINDEXED,
      end_line UNINDEXED
    );

    CREATE TABLE IF NOT EXISTS evolutions (
      id TEXT PRIMARY KEY,
      triggered_by TEXT,
      trigger_message TEXT,
      branch TEXT,
      pr_url TEXT,
      pr_number INTEGER,
      status TEXT NOT NULL DEFAULT 'idea',
      changes_summary TEXT,
      files_changed TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      proposed_at INTEGER,
      merged_at INTEGER,
      deployed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      source TEXT,
      detail TEXT NOT NULL,
      metadata TEXT,
      session_id TEXT,
      user_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS reflection_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      signals_analyzed INTEGER DEFAULT 0,
      outcome TEXT,
      proposal TEXT,
      evolution_id TEXT,
      error TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
  `);

  // Create indexes (idempotent — CREATE INDEX IF NOT EXISTS)
  d.exec(`
    CREATE INDEX IF NOT EXISTS idx_signals_type ON signals(type);
    CREATE INDEX IF NOT EXISTS idx_signals_created_at ON signals(created_at);
  `);
}

// ---------------------------------------------------------------------------
// Row <-> interface mapping helpers
// ---------------------------------------------------------------------------

function rowToSession(row: Record<string, unknown>): Session {
  return {
    id: row.id as string,
    discordKey: row.discord_key as string,
    agentSessionId: (row.agent_session_id as string) ?? undefined,
    guildId: (row.guild_id as string) ?? undefined,
    channelId: (row.channel_id as string) ?? undefined,
    userId: (row.user_id as string) ?? undefined,
    createdAt: row.created_at as number,
    lastActive: row.last_active as number,
  };
}

function rowToMessage(row: Record<string, unknown>): Message {
  return {
    id: row.id as number,
    sessionId: row.session_id as string,
    role: row.role as string,
    content: row.content as string,
    discordMessageId: (row.discord_message_id as string) ?? undefined,
    createdAt: row.created_at as number,
    model: (row.model as string) ?? undefined,
    inputTokens: (row.input_tokens as number) ?? undefined,
    outputTokens: (row.output_tokens as number) ?? undefined,
    cacheCreationTokens: (row.cache_creation_tokens as number) ?? undefined,
    cacheReadTokens: (row.cache_read_tokens as number) ?? undefined,
  };
}

function rowToChannelConfig(row: Record<string, unknown>): ChannelConfig {
  return {
    channelId: row.channel_id as string,
    guildId: (row.guild_id as string) ?? undefined,
    enabled: (row.enabled as number) === 1,
    systemPrompt: (row.system_prompt as string) ?? undefined,
    settings: JSON.parse((row.settings as string) || "{}") as Record<string, unknown>,
    updatedAt: row.updated_at as number,
  };
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

export function getSession(discordKey: string): Session | undefined {
  const row = getDb()
    .prepare("SELECT * FROM sessions WHERE discord_key = ?")
    .get(discordKey) as Record<string, unknown> | undefined;
  return row ? rowToSession(row) : undefined;
}

export function createSession(opts: {
  id: string;
  discordKey: string;
  guildId?: string;
  channelId?: string;
  userId?: string;
}): Session {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO sessions (id, discord_key, guild_id, channel_id, user_id, created_at, last_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(opts.id, opts.discordKey, opts.guildId ?? null, opts.channelId ?? null, opts.userId ?? null, now, now);

  return {
    id: opts.id,
    discordKey: opts.discordKey,
    guildId: opts.guildId,
    channelId: opts.channelId,
    userId: opts.userId,
    createdAt: now,
    lastActive: now,
  };
}

export function updateSessionActivity(id: string): void {
  getDb()
    .prepare("UPDATE sessions SET last_active = ? WHERE id = ?")
    .run(Date.now(), id);
}

export function deleteSession(id: string): void {
  const d = getDb();
  const del = d.transaction(() => {
    d.prepare("DELETE FROM messages WHERE session_id = ?").run(id);
    d.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  });
  del();
}

// ---------------------------------------------------------------------------
// Message helpers
// ---------------------------------------------------------------------------

export function getSessionMessages(sessionId: string, limit?: number): Message[] {
  const sql = limit
    ? "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?"
    : "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC";

  const rows = limit
    ? (getDb().prepare(sql).all(sessionId, limit) as Record<string, unknown>[])
    : (getDb().prepare(sql).all(sessionId) as Record<string, unknown>[]);

  return rows.map(rowToMessage);
}

export function addMessage(opts: {
  sessionId: string;
  role: string;
  content: string;
  discordMessageId?: string;
  usage?: TokenUsage;
}): void {
  getDb()
    .prepare(
      `INSERT INTO messages (session_id, role, content, discord_message_id, created_at, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      opts.sessionId,
      opts.role,
      opts.content,
      opts.discordMessageId ?? null,
      Date.now(),
      opts.usage?.model ?? null,
      opts.usage?.inputTokens ?? null,
      opts.usage?.outputTokens ?? null,
      opts.usage?.cacheCreationTokens ?? null,
      opts.usage?.cacheReadTokens ?? null,
    );
}

// ---------------------------------------------------------------------------
// Channel config helpers
// ---------------------------------------------------------------------------

export function getChannelConfig(channelId: string): ChannelConfig | undefined {
  const row = getDb()
    .prepare("SELECT * FROM channel_configs WHERE channel_id = ?")
    .get(channelId) as Record<string, unknown> | undefined;
  return row ? rowToChannelConfig(row) : undefined;
}

export function setChannelConfig(channelId: string, config: Partial<ChannelConfig>): void {
  const now = Date.now();
  const existing = getChannelConfig(channelId);

  if (existing) {
    const guildId = config.guildId ?? existing.guildId ?? null;
    const enabled = config.enabled !== undefined ? (config.enabled ? 1 : 0) : (existing.enabled ? 1 : 0);
    const systemPrompt = config.systemPrompt ?? existing.systemPrompt ?? null;
    const settings = config.settings
      ? JSON.stringify(config.settings)
      : JSON.stringify(existing.settings);

    getDb()
      .prepare(
        `UPDATE channel_configs
         SET guild_id = ?, enabled = ?, system_prompt = ?, settings = ?, updated_at = ?
         WHERE channel_id = ?`
      )
      .run(guildId, enabled, systemPrompt, settings, now, channelId);
  } else {
    const guildId = config.guildId ?? null;
    const enabled = config.enabled !== undefined ? (config.enabled ? 1 : 0) : 1;
    const systemPrompt = config.systemPrompt ?? null;
    const settings = config.settings ? JSON.stringify(config.settings) : "{}";

    getDb()
      .prepare(
        `INSERT INTO channel_configs (channel_id, guild_id, enabled, system_prompt, settings, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(channelId, guildId, enabled, systemPrompt, settings, now);
  }
}

// ---------------------------------------------------------------------------
// Global config helpers
// ---------------------------------------------------------------------------

export function getConfig(key: string): string | undefined {
  const row = getDb()
    .prepare("SELECT value FROM config WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value;
}

export function setConfig(key: string, value: string): void {
  getDb()
    .prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)")
    .run(key, value);
}
