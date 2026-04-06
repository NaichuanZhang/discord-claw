# Discordclaw

A stripped-down Discord agent powered by Claude. Simplified fork of [openclaw](https://github.com/openclaw/openclaw) — keeps only Discord, replaces multi-provider AI with Anthropic SDK, adds a web dashboard.

## Architecture

```mermaid
graph TB
    subgraph Discord
        DU[Discord Users]
        DG[Discord Gateway]
    end

    subgraph Discordclaw
        subgraph Bot["Bot (discord.js v14)"]
            CL[Client]
            MH[Message Handler]
            SC[Slash Commands]
        end

        subgraph Agent["Agent (Anthropic SDK)"]
            PM[processMessage]
            SP[System Prompt Builder]
            TL[Tool Loop]
        end

        subgraph Systems
            SOUL[Soul System<br/>SOUL.md]
            MEM[Memory System<br/>FTS5 Search]
            SESS[Session Manager]
            CRON[Cron Service]
        end

        subgraph Storage
            DB[(SQLite)]
            FS[data/ Files]
        end

        subgraph Gateway["Gateway (Express)"]
            API[REST API]
            WS[WebSocket]
            UI[React Dashboard]
        end
    end

    CLAUDE[Claude API]

    DU <-->|messages| DG
    DG <-->|events| CL
    CL --> MH
    CL --> SC
    MH --> SESS
    SESS --> DB
    MH --> PM
    PM --> SP
    SP --> SOUL
    SP --> MEM
    PM --> TL
    TL <-->|messages + tools| CLAUDE
    TL -->|memory_search, memory_get| MEM
    TL -->|send_message, add_reaction| CL
    MH -->|log| DB
    MH -->|broadcast| WS
    MEM --> DB
    MEM --> FS
    SOUL --> FS
    CRON -->|agent turns| PM
    CRON -->|deliver| CL
    CRON --> FS
    API --> DB
    API --> SESS
    API --> SOUL
    API --> MEM
    API --> CRON
    UI -->|fetch| API
    UI -->|stream| WS
```

## Data Flow

### Message Flow

```mermaid
sequenceDiagram
    participant U as Discord User
    participant B as Bot
    participant S as Session Manager
    participant A as Agent
    participant C as Claude API
    participant M as Memory
    participant DB as SQLite

    U->>B: @mention or DM
    B->>B: Filter (bot? mention? enabled?)
    B->>S: resolveSession(channel, user)
    S->>DB: lookup / create session
    S-->>B: session + history

    B->>A: processMessage(text, history, context)
    A->>A: Build system prompt (soul + memory instructions + channel config)
    A->>C: messages.create(system, messages, tools)

    loop Tool Use Loop (max 10 turns)
        C-->>A: tool_use: memory_search
        A->>M: searchMemory(query)
        M->>DB: FTS5 MATCH query
        M-->>A: ranked results
        A->>C: tool_result + continue
    end

    C-->>A: text response
    A-->>B: response string

    B->>DB: log user message
    B->>DB: log assistant response
    B->>U: message.reply(response)
    B->>WS: broadcastLog(entry)
```

### Cron Job Execution

```mermaid
sequenceDiagram
    participant T as Timer Loop
    participant CS as Cron Service
    participant ST as Cron Store
    participant A as Agent
    participant C as Claude API
    participant D as Discord

    T->>CS: tick() — check due jobs
    CS->>ST: getJobs() where nextRunAtMs <= now

    alt agentTurn payload
        CS->>A: processAgentTurn(message)
        A->>C: messages.create(soul + message)
        C-->>A: response
        A-->>CS: result text
    else systemEvent payload
        CS->>CS: log event text
    end

    opt delivery configured
        CS->>D: channel.send(result)
    end

    CS->>ST: updateJobState(lastRun, status)
    CS->>ST: appendRunEntry(history)
    CS->>CS: computeNextRun() + armTimer()
```

### Dashboard Data Flow

```mermaid
graph LR
    subgraph Browser
        UI[React SPA]
    end

    subgraph Server
        API[REST API]
        WS[WebSocket /ws/logs]
    end

    subgraph Data
        DB[(SQLite)]
        FS[data/ files]
        CRON[Cron Store]
    end

    UI -->|GET /api/status| API
    UI -->|GET/DELETE /api/sessions| API
    UI -->|GET/PUT /api/channels| API
    UI -->|GET/PUT /api/soul| API
    UI -->|GET/PUT /api/memory| API
    UI -->|CRUD /api/cron| API
    UI <-->|real-time logs| WS

    API --> DB
    API --> FS
    API --> CRON
```

## Project Structure

```
discordclaw/
├── src/
│   ├── index.ts              # Entry point: start all systems
│   ├── bot/                   # Discord bot (discord.js v14)
│   │   ├── client.ts          # Client setup, intents, event routing
│   │   ├── messages.ts        # Message pipeline: filter → session → agent → reply
│   │   ├── commands.ts        # Slash commands: /help /config /sessions /forget /soul
│   │   └── components.ts      # Button/select interaction handler
│   ├── agent/                 # Claude integration
│   │   ├── agent.ts           # Anthropic SDK wrapper, system prompt, tool loop
│   │   ├── tools.ts           # Discord tools (send_message, add_reaction, get_history)
│   │   └── sessions.ts        # Per-thread/DM session tracking + TTL
│   ├── skills/                # Skills management (SDK pattern)
│   │   ├── types.ts           # Skill, SkillMeta, SkillSource types
│   │   ├── store.ts           # File persistence + metadata JSON
│   │   ├── service.ts         # CRUD, GitHub install, prompt generation, file watcher
│   │   └── tools.ts           # read_skill + list_skill_files tool definitions
│   ├── soul/
│   │   └── soul.ts            # Load SOUL.md, file watcher, hot-reload
│   ├── memory/
│   │   ├── memory.ts          # File discovery, FTS5 indexing, BM25 search
│   │   └── tools.ts           # memory_search + memory_get tool definitions
│   ├── cron/
│   │   ├── types.ts           # Job, schedule, payload, delivery types
│   │   ├── store.ts           # JSON persistence + JSONL run history
│   │   └── service.ts         # Timer loop, execution, retry, auto-disable
│   ├── db/
│   │   └── index.ts           # SQLite schema, migrations, query helpers
│   └── gateway/
│       ├── server.ts          # Express + WebSocket server
│       ├── api.ts             # REST API (status, sessions, channels, config, soul, memory, cron, skills)
│       └── ui/                # React SPA (Vite)
│           ├── App.tsx         # Layout, routing, shared styles
│           └── pages/          # Status, Sessions, Channels, Config, Cron, Skills, Logs
├── data/                      # Runtime data (gitignored)
│   ├── discordclaw.db         # SQLite database
│   ├── SOUL.md                # Bot personality
│   ├── MEMORY.md              # Long-term memory
│   ├── memory/                # Daily memory notes
│   ├── cron/                  # Job store + run history
│   └── skills/                # Installed skills (SKILL.md + companion files)
├── .env                       # DISCORD_BOT_TOKEN, ANTHROPIC_* config
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## Setup

### Discord Bot

1. Go to https://discord.com/developers/applications
2. Create a new application, then go to **Bot** tab
3. Copy the bot token for your `.env`
4. Under **Privileged Gateway Intents**, enable:
   - **Message Content Intent** (required)
   - **Server Members Intent** (recommended)
5. Go to **OAuth2 > URL Generator**, select scopes: `bot`, `applications.commands`
6. Select permissions: Send Messages, Read Message History, Add Reactions, Use Slash Commands
7. Use the generated URL to invite the bot to your server

### Install & Run

```bash
# Install
npm install

# Configure
cp .env.example .env
# Edit .env with your Discord bot token and Anthropic API config

# Build dashboard
npm run build:ui

# Run
npm run dev
```

The bot responds to **@mentions** in guild channels and all **DMs**. Dashboard available at `http://localhost:3000`.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_BOT_TOKEN` | Yes | Discord bot token |
| `ANTHROPIC_API_KEY` | Yes* | Anthropic API key |
| `ANTHROPIC_BASE_URL` | No | Proxy URL (overrides default API endpoint) |
| `ANTHROPIC_AUTH_TOKEN` | No | Auth token for proxy (used instead of API key) |
| `ANTHROPIC_MODEL` | No | Model name (default: `bedrock-claude-opus-4-6-1m`) |
| `GATEWAY_PORT` | No | Dashboard port (default: `3000`) |
| `SESSION_TTL_HOURS` | No | Session expiry (default: `24`) |

*Either `ANTHROPIC_API_KEY` or `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` required.

## Key Systems

**Soul** — Bot personality defined in `data/SOUL.md`. Hot-reloads on file change. Editable via dashboard.

**Memory** — Markdown files in `data/` indexed with SQLite FTS5. The agent searches memory before answering questions about past context. BM25 ranked results.

**Sessions** — Per-thread/DM/channel conversation tracking. History loaded as context for each message. Auto-expires after TTL.

**Cron** — Scheduled tasks with three schedule types: one-shot (`at`), interval (`every`), cron expression (`cron`). Jobs can run agent turns and deliver results to Discord channels. Auto-disables after 3 consecutive failures.

**Skills** — Modular capabilities defined as SKILL.md files with YAML frontmatter. Install from GitHub URL or upload directly. Uses SDK progressive loading pattern: only skill metadata (name, description, path) is injected into the system prompt; the agent reads full skill content on demand via `read_skill` tool. Skills can include companion files (scripts, references). Manageable via dashboard.

**Dashboard** — Single-page React app at `http://localhost:3000`. Status, session browser, channel config, soul/memory editor, cron manager, skills manager, real-time message logs via WebSocket.
