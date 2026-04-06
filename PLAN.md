# Discordclaw: Stripped-Down Discord Agent with Claude SDK

## Context

The user wants a simplified version of [openclaw](https://github.com/openclaw/openclaw) that:
- Keeps **only** Discord channel control (drops 39 other channels)
- Replaces openclaw's multi-provider AI runtime with **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`)
- Inherits openclaw's **soul** (personality via `SOUL.md`) and **memory** (long-term `MEMORY.md` + daily `memory/YYYY-MM-DD.md` with SQLite FTS5 search)
- Provides a **single-page web dashboard** for full control (status, config, logs, sessions, per-channel settings)
- Inherits openclaw's **cron system** (scheduled tasks: one-shot, interval, cron expressions → agent runs → Discord delivery)
- Is dramatically simpler: ~2000 lines vs openclaw's 3000+ for Discord alone

## Architecture

```
discordclaw/
├── src/
│   ├── bot/                  # Discord bot (discord.js v14)
│   │   ├── client.ts         # Client setup, intent config, event routing
│   │   ├── messages.ts       # Message handler: filter → session → agent → reply
│   │   ├── commands.ts       # Slash commands: /help, /config, /sessions, /clear
│   │   └── components.ts     # Button/select menu interaction handlers
│   ├── agent/                # Claude Agent SDK integration
│   │   ├── agent.ts          # query() wrapper, system prompt assembly, streaming
│   │   ├── tools.ts          # Custom MCP tools for Discord operations
│   │   └── sessions.ts       # Per-thread/DM session tracking + context
│   ├── soul/                 # Soul system (personality)
│   │   └── soul.ts           # Load SOUL.md, watch for changes, inject into prompt
│   ├── memory/               # Memory system
│   │   ├── memory.ts         # File discovery, indexing, FTS5 search
│   │   └── tools.ts          # memory_search + memory_get agent tools
│   ├── cron/                 # Scheduled tasks
│   │   ├── service.ts        # Timer loop, job execution, retry logic
│   │   ├── store.ts          # JSON file persistence (data/cron/jobs.json)
│   │   └── types.ts          # Job types, schedule types, payload types
│   ├── gateway/              # Web dashboard
│   │   ├── server.ts         # Express server + WebSocket for real-time updates
│   │   ├── api.ts            # REST API routes
│   │   └── ui/               # React SPA (Vite)
│   │       ├── App.tsx        # Main app with sidebar nav
│   │       ├── pages/
│   │       │   ├── Status.tsx     # Bot status, guilds, uptime
│   │       │   ├── Sessions.tsx   # Session browser + message log
│   │       │   ├── Channels.tsx   # Per-channel config
│   │       │   ├── Config.tsx     # Global config + soul editor
│   │       │   ├── Cron.tsx       # Scheduled jobs manager
│   │       │   └── Logs.tsx       # Real-time message log
│   │       └── index.html
│   ├── db/                   # Database
│   │   └── index.ts          # SQLite schema, migrations, query helpers
│   └── index.ts              # Entry point: start bot + gateway
├── data/                     # Runtime data (gitignored)
│   ├── discordclaw.db        # SQLite database
│   ├── SOUL.md               # Personality file
│   ├── MEMORY.md             # Long-term memory
│   ├── memory/               # Daily memory notes
│   │   └── YYYY-MM-DD.md
│   └── cron/
│       ├── jobs.json          # Persisted cron jobs
│       └── runs/              # Run history logs (JSONL per job)
├── .env                      # DISCORD_BOT_TOKEN, ANTHROPIC_API_KEY
├── package.json
├── tsconfig.json
└── vite.config.ts            # Dashboard build config
```

## Components

### 1. Discord Bot (`src/bot/`)

**client.ts** — Discord.js v14 client setup:
- Intents: Guilds, GuildMessages, MessageContent, DirectMessages, GuildMessageReactions
- Event routing to handlers (messageCreate, interactionCreate)
- Connection lifecycle (ready, disconnect, reconnect)

**messages.ts** — Message handling pipeline (simplified from openclaw's 900+ line version):
1. **Filter**: Skip bot messages, check if bot is mentioned or in DM
2. **Session resolve**: Look up or create session for this thread/DM/channel
3. **Agent dispatch**: Build context (message + history + soul + memory instructions) → `query()` via Claude Agent SDK
4. **Reply**: Chunk response to 2000 chars, send as reply. Show typing indicator while processing.
5. **Log**: Store message + response in SQLite

**commands.ts** — Slash commands:
- `/help` — Show bot capabilities
- `/config` — Show/edit channel config (system prompt override, enabled)
- `/sessions` — List recent conversation sessions
- `/clear` — Clear current session context
- `/soul` — Show current soul (personality)

**components.ts** — Handle button clicks and select menu interactions from agent-generated components.

### 2. Claude Agent SDK Integration (`src/agent/`)

**agent.ts** — Core agent wrapper:
```typescript
// Simplified interface
async function processMessage(opts: {
  message: string;
  sessionKey: string;
  context: { guild?: string; channel: string; user: string; };
  history: Message[];
}): Promise<AsyncIterable<AgentMessage>> {
  const systemPrompt = buildSystemPrompt({
    soul: loadSoul(),
    memoryInstructions: buildMemoryRecallSection(),
    channelConfig: getChannelConfig(opts.context.channel),
  });

  return query({
    prompt: opts.message,
    options: {
      systemPrompt,
      maxTurns: 10,
      allowedTools: [
        "mcp__discord__send_message",
        "mcp__discord__add_reaction",
        "mcp__discord__get_history",
        "mcp__memory__memory_search",
        "mcp__memory__memory_get",
      ],
      mcpServers: { discord: discordToolServer, memory: memoryToolServer },
      permissionMode: "acceptEdits",
    },
  });
}
```

**System prompt assembly order** (following openclaw's priority):
1. Base agent instructions
2. SOUL.md content (personality — high priority)
3. Memory Recall section (instructs when/how to use memory tools)
4. Channel-specific instructions (from per-channel config)
5. Context (current guild, channel, user info)

**tools.ts** — Custom MCP tools the Claude agent can call:
- `send_message(channel_id, text)` — Send a message to a Discord channel
- `add_reaction(message_id, emoji)` — React to a message
- `get_history(channel_id, limit)` — Fetch recent channel messages
- `get_user_info(user_id)` — Get Discord user details
- `create_thread(channel_id, name)` — Create a new thread

**sessions.ts** — Session management:
- Session key format: `thread:{threadId}` or `dm:{userId}` or `channel:{channelId}`
- Store in SQLite: session_id, discord_key, agent_session_id (for Claude SDK `resume`), created_at, last_active
- Auto-expire sessions after configurable TTL (default 24h)
- Load last N messages as context when resuming

### 3. Soul System (`src/soul/`)

**soul.ts** — Personality management:
- Load `data/SOUL.md` at startup
- Watch file for changes (fs.watch), reload on edit
- Provide `getSoul(): string` for system prompt injection
- Default soul template if file doesn't exist:
  ```markdown
  # Soul
  You are a helpful AI assistant on Discord.
  Be concise, friendly, and direct.
  Use casual tone appropriate for Discord.
  ```
- Dashboard can edit SOUL.md via API → file write → auto-reload

### 4. Memory System (`src/memory/`)

**memory.ts** — Simplified memory engine (inheriting openclaw's patterns):
- **File discovery**: Scan `data/MEMORY.md` + `data/memory/*.md`
- **Indexing**: SQLite FTS5 full-text search index
  - Chunk files into ~400-token segments with 80-token overlap
  - Re-index on file change (debounced 1.5s)
  - Store: path, chunk_text, start_line, end_line, mtime
- **Search**: BM25 scoring via FTS5 `MATCH` query
- **No embeddings** (simplification): Skip vector search — FTS5 keyword search is sufficient for a personal bot. Can add embeddings later if needed.

**tools.ts** — Memory tools exposed to Claude agent:
- `memory_search(query, maxResults?)` — Search across all memory files, returns ranked snippets with path + line numbers
- `memory_get(path, from?, lines?)` — Read specific lines from a memory file

**Memory Recall prompt section** (injected into system prompt):
```
## Memory Recall
You have access to long-term memory stored in markdown files.
Before answering questions about prior conversations, decisions, preferences,
people, or facts: use memory_search to find relevant context, then memory_get
to read specific sections. Write new memories by asking the user if they'd
like you to remember something.
```

### 5. Cron System (`src/cron/`)

Simplified from openclaw's production cron (inheriting core patterns, dropping multi-process locking, webhook triggers, staggering).

**types.ts** — Data model:
```typescript
type CronSchedule =
  | { type: "at"; timestamp: number }              // One-shot (epoch ms)
  | { type: "every"; intervalMs: number }           // Repeating interval
  | { type: "cron"; expression: string; tz?: string } // 5-field cron + timezone

type CronPayload =
  | { kind: "systemEvent"; text: string }           // Inject into main session context
  | { kind: "agentTurn"; message: string; model?: string } // Fresh isolated agent run

type CronDelivery = {
  channelId: string;           // Discord channel to post result
  mentionUser?: string;        // Optional user to @mention
}

type CronJob = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  deleteAfterRun?: boolean;    // For one-shots
  schedule: CronSchedule;
  payload: CronPayload;
  delivery?: CronDelivery;     // Where to post results
  state: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastRunStatus?: "ok" | "error" | "skipped";
    lastError?: string;
    consecutiveErrors?: number;
  };
  createdAt: number;
  updatedAt: number;
}
```

**store.ts** — JSON file persistence:
- Load/save `data/cron/jobs.json` (atomic write via temp file + rename)
- Format: `{ version: 1, jobs: CronJob[] }`
- Run history: append to `data/cron/runs/{jobId}.jsonl` per execution

**service.ts** — Timer loop and execution:
1. On startup: load jobs, compute next run times
2. Timer loop: find earliest due job, `setTimeout` until then (max 60s check interval)
3. On fire: execute job payload
   - **systemEvent**: Enqueue text as context for next Discord interaction
   - **agentTurn**: Call `query()` with job message in isolated context, capture result
4. Delivery: If `delivery.channelId` set, post result to Discord channel
5. Update state: set lastRunAtMs, status, compute next run
6. Retry: On error, up to 3 retries with backoff (60s, 120s, 300s). Auto-disable after 3 consecutive failures.
7. Cleanup: Delete one-shot jobs (`deleteAfterRun`) after successful execution

**Slash command** `/cron`:
- `/cron add <name> <schedule> <message>` — Create a new scheduled job
- `/cron list` — List active jobs with next run time
- `/cron remove <id>` — Delete a job
- `/cron run <id>` — Force-run a job immediately
- `/cron toggle <id>` — Enable/disable a job

**Dashboard API endpoints** (added to api.ts):
```
GET    /api/cron              — List all cron jobs
POST   /api/cron              — Create new job
PUT    /api/cron/:id          — Update job
DELETE /api/cron/:id          — Delete job
POST   /api/cron/:id/run      — Force-run job
GET    /api/cron/:id/runs     — Get run history
```

**Dashboard UI** (Cron.tsx):
- Table of jobs: name, schedule (human-readable), next run, last status, enabled toggle
- Create/edit job form: name, schedule type picker (at/every/cron), message, delivery channel
- Run history viewer per job
- Manual run button

### 6. Database (`src/db/`)

**SQLite schema** (`better-sqlite3`):

```sql
-- Conversation sessions
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  discord_key TEXT NOT NULL UNIQUE,  -- "thread:123" or "dm:456"
  agent_session_id TEXT,              -- Claude SDK session ID for resume
  guild_id TEXT,
  channel_id TEXT,
  user_id TEXT,
  created_at INTEGER NOT NULL,
  last_active INTEGER NOT NULL
);

-- Message log
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL,           -- "user" | "assistant" | "system"
  content TEXT NOT NULL,
  discord_message_id TEXT,
  created_at INTEGER NOT NULL
);

-- Per-channel configuration
CREATE TABLE channel_configs (
  channel_id TEXT PRIMARY KEY,
  guild_id TEXT,
  enabled INTEGER DEFAULT 1,
  system_prompt TEXT,           -- Channel-specific prompt override
  settings TEXT DEFAULT '{}',   -- JSON blob for extra settings
  updated_at INTEGER NOT NULL
);

-- Global config (key-value store)
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Memory FTS index
CREATE VIRTUAL TABLE memory_fts USING fts5(
  path,
  chunk_text,
  start_line UNINDEXED,
  end_line UNINDEXED
);
```

### 7. Gateway Dashboard (`src/gateway/`)

**server.ts** — Express + WebSocket:
- Serves React SPA from built static files
- WebSocket for real-time message log streaming
- Token auth via `GATEWAY_TOKEN` env var (simple bearer token)

**api.ts** — REST endpoints:
```
GET    /api/status              — Bot status (guilds, channels, uptime, connection state)
GET    /api/sessions            — List sessions (paginated, filterable by guild/channel)
GET    /api/sessions/:id        — Session detail + messages
DELETE /api/sessions/:id        — Clear session
GET    /api/channels            — List channel configs
PUT    /api/channels/:id        — Update channel config (enabled, system_prompt, settings)
GET    /api/config              — Global config (gateway port, session TTL, etc.)
PUT    /api/config              — Update global config
GET    /api/soul                — Read SOUL.md content
PUT    /api/soul                — Write SOUL.md content
GET    /api/memory              — List memory files
GET    /api/memory/:path        — Read memory file content
PUT    /api/memory/:path        — Write/update memory file
POST   /api/bot/restart         — Restart Discord bot connection
WS     /ws/logs                 — Real-time message log stream
```

**React SPA** (`src/gateway/ui/`):
- **Status page**: Bot online/offline, connected guilds with channel counts, uptime, memory usage
- **Sessions page**: Table of sessions with last message preview, click to view full message log
- **Channels page**: Per-channel toggle (enabled/disabled), system prompt editor per channel
- **Config page**: Soul editor (SOUL.md with live preview), memory file browser/editor, global settings
- **Cron page**: Job table, create/edit forms, run history, manual trigger
- **Logs page**: Real-time message stream via WebSocket, filterable by guild/channel

### 8. Entry Point (`src/index.ts`)

Startup sequence:
1. Load .env (dotenv)
2. Initialize SQLite database + run migrations
3. Load SOUL.md + start file watcher
4. Index memory files
5. Start cron service (load jobs, start timer loop)
6. Start Discord bot (connect + register slash commands)
7. Start Express gateway server
8. Log startup summary (guilds connected, gateway URL, cron jobs active)

## Dependencies

```json
{
  "dependencies": {
    "discord.js": "^14.16",
    "@anthropic-ai/claude-agent-sdk": "latest",
    "express": "^4.21",
    "better-sqlite3": "^11",
    "dotenv": "^16",
    "ws": "^8",
    "croner": "^9"
  },
  "devDependencies": {
    "typescript": "^5.7",
    "tsx": "^4",
    "vite": "^6",
    "react": "^19",
    "react-dom": "^19",
    "@types/express": "^5",
    "@types/better-sqlite3": "^7",
    "@types/ws": "^8"
  }
}
```

## Implementation Plan

### Step 1: Project scaffold + database
- `package.json`, `tsconfig.json`, `.env.example`
- `src/db/index.ts` — SQLite schema, migrations, query helpers
- `src/index.ts` — skeleton entry point

### Step 2: Soul system
- `src/soul/soul.ts` — Load SOUL.md, file watcher, getSoul()
- `data/SOUL.md` — Default personality template

### Step 3: Memory system
- `src/memory/memory.ts` — File discovery, FTS5 indexing, search
- `src/memory/tools.ts` — memory_search + memory_get MCP tools
- `data/MEMORY.md` — Empty starter file

### Step 4: Claude Agent SDK integration
- `src/agent/agent.ts` — query() wrapper, system prompt assembly
- `src/agent/tools.ts` — Discord MCP tools (send_message, add_reaction, get_history, etc.)
- `src/agent/sessions.ts` — Session CRUD + context loading

### Step 5: Discord bot
- `src/bot/client.ts` — Discord.js client setup
- `src/bot/messages.ts` — Message pipeline (filter → session → agent → reply)
- `src/bot/commands.ts` — Slash commands (/help, /config, /sessions, /clear, /soul, /cron)
- `src/bot/components.ts` — Component interaction handler

### Step 6: Cron system
- `src/cron/types.ts` — Job types, schedule types, payload types
- `src/cron/store.ts` — JSON file persistence + run history logging
- `src/cron/service.ts` — Timer loop, execution, retry, delivery to Discord

### Step 7: Gateway API
- `src/gateway/server.ts` — Express server + WebSocket
- `src/gateway/api.ts` — All REST endpoints (including cron CRUD)

### Step 8: Dashboard UI
- Vite config + React scaffold
- Status, Sessions, Channels, Config, Cron, Logs pages
- WebSocket integration for real-time logs

### Step 9: Integration + polish
- Wire entry point (index.ts) to start everything
- Test end-to-end: send Discord message → get Claude response
- Error handling, graceful shutdown
- `.env.example` with all required vars documented

## Verification

1. **Bot connects**: Start with `tsx src/index.ts`, verify bot appears online in Discord
2. **Message flow**: Send DM to bot → receive Claude response → check message logged in DB
3. **Session persistence**: Send follow-up in same thread → verify context preserved
4. **Soul**: Edit SOUL.md → send message → verify personality change reflected
5. **Memory**: Write to MEMORY.md → ask bot about it → verify it searches and recalls
6. **Slash commands**: Test /help, /config, /sessions, /clear in Discord
7. **Dashboard**: Open gateway URL → verify status page shows connected guilds
8. **Dashboard config**: Edit soul via dashboard → verify file updated + bot reflects change
9. **Real-time logs**: Open logs page → send Discord message → verify appears in real-time
10. **Channel config**: Disable channel via dashboard → verify bot ignores messages in that channel
11. **Cron one-shot**: Create `/cron add "test" "at:+1m" "Say hello"` → verify fires after 1 minute and delivers to Discord
12. **Cron recurring**: Create cron job via dashboard with `every:5m` → verify it repeats
13. **Cron agent turn**: Create job with agent turn payload → verify Claude processes and result posted to channel
14. **Cron management**: Toggle enable/disable via dashboard, force-run, view run history
