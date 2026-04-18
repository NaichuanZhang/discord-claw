<p align="center">
  <img src="assets/discordclaw-logo.svg" width="256" alt="Discordclaw">
</p>

# Discordclaw

A stripped-down Discord agent powered by Claude. Simplified fork of [openclaw](https://github.com/openclaw/openclaw) — keeps only Discord, replaces multi-provider AI with Anthropic SDK, adds a web dashboard.

## Features

- 💬 **Conversational AI** — @mention in channels or DM directly. Full conversation history per session.
- 🧵 **Thread-First Replies** — In guild channels, every response goes into its own thread for clean session isolation. Monitored channels auto-respond without @mention.
- 🎤 **Voice Message Support** — Send voice DMs and the bot transcribes them automatically via OpenAI Whisper.
- 🎙️ **Voice Assistant** — Join voice channels with `/join`. Listens via Silero VAD, transcribes with EigenAI Whisper, thinks with Claude (or Eigen LLM), speaks back with EigenAI Chatterbox TTS. Supports interruptions, streaming TTS pipelining, and auto-disconnect. Auto-join mode tracks a configured user.
- 🧠 **Persistent Memory** — Remembers things across conversations. Markdown files indexed with FTS5 full-text search.
- 📜 **Conversation History** — Messages are archived across sessions. Query past conversations with `get_conversation_history` and `get_conversation_stats` tools.
- 🎭 **Customizable Personality** — Edit `SOUL.md` to change how the bot behaves. Hot-reloads on save.
- 🔧 **Tool Use** — Runs shell commands, reads/writes files, sends messages across channels, reacts to messages, attaches files, creates threads.
- 📦 **Skills** — Drop a `SKILL.md` folder into `data/skills/` and the bot learns new capabilities instantly. Install from GitHub or upload directly.
- ⏰ **Scheduled Tasks** — Cron jobs that run agent turns on a schedule, delivering results in daily threads. Hot-reloads `jobs.json` without restart.
- 🧬 **Self-Evolution** — The bot can modify its own source code via GitHub PRs. Review diffs and merge from Discord. Deployment notifications posted automatically.
- 🔍 **Autonomous Reflection** — Collects signals (errors, tool failures, duplicate loops) and periodically analyzes them to suggest improvements.
- 📊 **Web Dashboard** — React SPA for managing sessions, channels, soul, memory, cron, skills, and evolution history.
- 🔍 **Web Search** — Install the SearXNG skill for web, news, and package repository search.

## Demo User Flow

```
You: Hey @Discordclaw, what did we talk about yesterday?
Bot: [searches memory] We discussed setting up the cron job
     for daily standups. Want me to finish that?

You: Yeah, set it up for 9am every weekday in #general
Bot: [creates cron job] Done! I'll post a standup prompt
     to #general at 9am Mon-Fri. ✅

You: 🎤 [sends voice message]
Bot: [transcribes audio] I heard you say "Can you search
     for the latest Node.js release?" Let me check...
     Node.js v22.5.0 was released on April 1, 2026.

You: Can you search the web for the latest Node.js release?
Bot: [reads searxng-search skill, runs search] Node.js v22.5.0
     was released on April 1, 2026 with...

You: I want you to add a /ping command that shows latency
Bot: [evolve_start → evolve_write → evolve_propose]
     PR created: github.com/.../pull/8
     Want me to show you the diff?

You: Looks good, merge it
Bot: [evolve_merge] Merged and restarting... ✅
     /ping command is now live!
```

### Slash Commands

| Command | Description |
|---------|-------------|
| `/ping` | Show bot health status, latency, and uptime |
| `/help` | Show all commands and capabilities |
| `/config` | Toggle bot on/off per channel, set custom instructions |
| `/clear` | Reset conversation history in current session |
| `/soul` | View the bot's personality |
| `/skills` | List, install (from GitHub or file upload), or remove skills |
| `/cron` | View, add, enable/disable, force-run, or show history of cron jobs |
| `/restart` | Restart the bot process |
| `/join` | Join your voice channel as a voice assistant |
| `/leave` | Leave the voice channel |

## Getting Started

Each instance of Discordclaw is its own bot with its own personality, memory, and evolution history. To run your own, you'll **fork the repo** and deploy from your fork. This way the self-evolution feature creates PRs against *your* repo, not the upstream one.

### Prerequisites

- **Node.js** v20+
- **Git** and **GitHub CLI** (`gh`) — required for the self-evolution engine
- A **Discord bot token** ([setup guide below](#1-create-a-discord-bot))
- An **Anthropic API key** (or a proxy endpoint)
- *(Optional)* An **OpenAI API key** for voice message transcription
- *(Optional)* An **EigenAI API key** for voice assistant STT/TTS

### 1. Fork & Clone

1. Click **Fork** on [the repo](https://github.com/NaichuanZhang/discord-claw) to create your own copy
2. Clone your fork:

```bash
git clone https://github.com/YOUR_USERNAME/discord-claw.git
cd discord-claw
```

> **Why fork?** The evolution engine pushes branches and creates PRs via `gh`. If you clone without forking, PRs would target the original repo. Your fork gives you full control — the bot evolves *your* codebase.

### 2. Create a Discord Bot

1. Go to https://discord.com/developers/applications
2. Create a new application → **Bot** tab → copy token
3. Enable **Message Content Intent** and **Server Members Intent**
4. **OAuth2 > URL Generator** → scopes: `bot`, `applications.commands`
5. Permissions: Send Messages, Read Message History, Add Reactions, Attach Files, Use Slash Commands, Create Public Threads
6. Invite bot to your server with the generated URL

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your tokens:

```env
DISCORD_BOT_TOKEN=your_discord_bot_token
ANTHROPIC_API_KEY=your_anthropic_api_key

# Optional
OPENAI_API_KEY=your_openai_key          # Voice message transcription
EIGENAI_API_KEY=your_eigenai_key        # Voice assistant STT/TTS
GATEWAY_PORT=3000                        # Dashboard port
GATEWAY_TOKEN=your_secret_token          # Dashboard auth token
ANTHROPIC_MODEL=bedrock-claude-opus-4-7-1m # Model override (this is the default)
```

### 4. Install & Run

```bash
npm install
npm run build:ui    # Build the dashboard
npm run dev         # Start in development mode
```

The bot responds to **@mentions** in guild channels and all **DMs**. Dashboard at `http://localhost:3000`.

### 5. Production Deployment

For production, use the startup script which handles auto-pull, migrations, health checks, and rollback:

```bash
./start.sh
```

Or use the watchdog daemon for crash recovery and auto-restart:

```bash
npm run daemon
```

You can set up a systemd service, Docker container, or any process manager to keep it running. Point it at `start.sh` or the daemon as the entry point.

> **Tip:** Set `DISCORD_WEBHOOK_URL` in `.env` to receive deploy/rollback notifications in a Discord channel.

### 6. Authenticate GitHub CLI (for Self-Evolution)

The evolution engine uses `gh` to create and merge PRs. Make sure it's authenticated:

```bash
gh auth login
```

Without this, the bot can still function normally — it just won't be able to create PRs to modify its own code.

### 7. Make It Yours

- **Personality** — Edit `data/SOUL.md` to define how your bot talks and behaves. Hot-reloads on save.
- **Skills** — Drop skill folders into `data/skills/` or install from GitHub via the dashboard or `/skills add-github`.
- **Memory** — The bot builds memory over time. You can also seed `data/MEMORY.md` with initial context.

### Staying Up to Date

To pull improvements from the upstream repo into your fork:

```bash
git remote add upstream https://github.com/NaichuanZhang/discord-claw.git
git fetch upstream
git merge upstream/main
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_BOT_TOKEN` | Yes | Discord bot token |
| `ANTHROPIC_API_KEY` | Yes* | Anthropic API key |
| `ANTHROPIC_BASE_URL` | No | Proxy URL (overrides default API endpoint) |
| `ANTHROPIC_AUTH_TOKEN` | No | Auth token for proxy (used instead of API key) |
| `ANTHROPIC_MODEL` | No | Model name (default: `bedrock-claude-opus-4-7-1m`) |
| `OPENAI_API_KEY` | No | OpenAI API key for voice message transcription (Whisper) |
| `EIGENAI_API_KEY` | No | EigenAI API key for voice assistant STT (Whisper) and TTS (Chatterbox) |
| `GATEWAY_PORT` | No | Dashboard port (default: `3000`) |
| `GATEWAY_TOKEN` | No | Auth token for dashboard API access |
| `SESSION_TTL_HOURS` | No | Session expiry (default: `24`) |
| `DISCORD_WEBHOOK_URL` | No | Webhook for `start.sh` notifications (deploy, rollback alerts) |
| `REFLECTION_CHANNEL_ID` | No | Discord channel for reflection daemon proposals |
| `REFLECTION_INTERVAL_HOURS` | No | How often the reflection daemon runs (default: `6`) |
| `REFLECTION_LOOKBACK_HOURS` | No | Signal lookback window (default: `24`) |
| `REFLECTION_MIN_SIGNALS` | No | Minimum signals before reflection triggers (default: `3`) |
| `REFLECTION_MODEL` | No | Claude model for reflection analysis (default: same as `ANTHROPIC_MODEL`) |
| `VOICE_MODEL` | No | Claude model for voice responses (default: `claude-sonnet-4-20250514`). Supports `eigen:<model>` prefix for Eigen LLM backend. |
| `VOICE_SILENCE_MS` | No | Silence duration to end utterance (default: `800`) |
| `VOICE_MIN_UTTERANCE_MS` | No | Minimum utterance length, skip noise (default: `500`) |
| `VOICE_MAX_TOKENS` | No | Max tokens for voice responses (default: `512`) |
| `VOICE_DEBUG` | No | Voice debug logging (default: on, set `0` to disable) |
| `VOICE_TTS_STREAM` | No | Streaming TTS for lower TTFB (default: on, set `0` to disable) |
| `VOICE_TOOLS_MODE` | No | Voice agent tools: `full` (all tools except evolution) or `minimal` (memory + conversation history only). Default: `full` |

*Either `ANTHROPIC_API_KEY` or `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` required.

## Key Systems

**Soul** — Bot personality defined in `data/SOUL.md`. Hot-reloads on file change. Editable via dashboard.

**Memory** — Markdown files in `data/` indexed with SQLite FTS5. The agent searches memory before answering questions about past context. BM25 ranked results. Queries are sanitized for FTS5 compatibility (special characters like hyphens and colons are handled automatically).

**Sessions** — Per-thread/DM/channel conversation tracking. History loaded as context for each message. Auto-expires after TTL. Messages are archived to enable cross-session querying via `get_conversation_history` and `get_conversation_stats` tools.

**Cron** — Scheduled tasks with three schedule types: one-shot (`at`), interval (`every`), cron expression (`cron`). `agentTurn` jobs run the agent and deliver results inside daily threads (the agent handles all delivery via tools — no duplicate top-level messages). `systemEvent` jobs deliver results directly to the configured channel. Auto-disables after 3 consecutive failures. Hot-reloads `jobs.json` on each tick cycle (up to every 60s) so externally-added jobs are picked up without a restart.

**Skills** — Modular capabilities defined as SKILL.md files with YAML frontmatter. Install from GitHub URL or upload directly. Uses SDK progressive loading pattern: only skill metadata (name, description, path) is injected into the system prompt; the agent reads full skill content on demand via `read_skill` tool. Skills can include companion files (scripts, references). Manageable via dashboard and `/skills` command.

**Dashboard** — Single-page React app at `http://localhost:3000`. Pages: Status, Sessions, Channels, Config, Cron, Skills, Evolution, Logs. Real-time message streaming via WebSocket.

**Agent Loop** — The tool-use loop runs until the model produces a final text response. To prevent infinite loops, consecutive duplicate tool calls (same tool + same arguments) are detected — after 2 identical rounds the agent is forced to produce a final response. Typing indicator refreshes every 8 seconds to stay visible during long tool chains.

**Thread-First Replies** — In guild text channels, every bot response creates a thread on the user's message. Bot-created threads don't require @mentions for follow-up. Monitored channels auto-respond to all messages without @mention. DMs bypass threading entirely.

**File Attachments** — The agent can send files (PDFs, images, HTML, etc.) to Discord channels via the `send_file` tool. Files up to 25 MB are supported (Discord bot default tier).

**Image Support** — When the agent's response contains markdown images (`![alt](url)`), they are automatically extracted and rendered as Discord embeds (for web URLs) or file attachments (for local files). Image markdown is stripped from the text to avoid showing raw URLs.

**Voice Messages** — Discord voice DMs and audio attachments are automatically detected and transcribed using OpenAI's Whisper API. The transcribed text is passed to the agent as the message content. Requires `OPENAI_API_KEY`. Gracefully degrades with a helpful message if the API key isn't configured. Supports OGG, MP3, WAV, M4A, WebM, FLAC, and other common audio formats.

**Voice Assistant** — Real-time voice interaction in Discord voice channels. Pipeline: user speaks → opus decode → downsample to 16kHz mono → Silero VAD (ONNX, ~2MB model) detects speech boundaries → EigenAI Whisper V3 Turbo transcribes → LLM generates concise spoken response (1-3 sentences, no markdown) → EigenAI Chatterbox TTS synthesizes audio → bot speaks back. Supports two LLM backends: Anthropic Claude (default: `claude-sonnet-4-20250514`, configurable via `VOICE_MODEL`) with full tool support, or Eigen LLM (`VOICE_MODEL=eigen:<model>`) for minimum latency pure text mode (no tools). Max tokens default 512 (configurable via `VOICE_MAX_TOKENS`). Tools configurable via `VOICE_TOOLS_MODE`: `full` (memory, Discord, bash, file I/O, skills, conversation history — everything except evolution) or `minimal` (memory + conversation history only). Supports interruptions (cuts off bot when user starts speaking), streaming TTS pipelining (sentence-level), minimum utterance filtering (skips coughs/noise < 500ms), and auto-disconnect after 10 minutes idle. Auto-join mode tracks a configured user and joins/leaves their voice channel automatically. Requires `EIGENAI_API_KEY`.

**Evolution Engine** — The bot can modify its own source code through GitHub pull requests. All changes are isolated in a git worktree at `beta/`, typechecked, tested, and submitted as PRs via `gh` CLI. The agent has 9 evolution tools: `evolve_start`, `evolve_read`, `evolve_write`, `evolve_bash`, `evolve_propose`, `evolve_suggest`, `evolve_cancel`, `evolve_review`, and `evolve_merge`. Users can review PR diffs and merge directly from Discord — merging automatically triggers a restart to deploy the changes and posts a deployment notification thread to a configured channel. The bot also records ideas for improvements it can't yet make (`evolve_suggest`). Evolution history is tracked in SQLite and viewable in the dashboard.

**Reflection System** — Autonomous self-improvement discovery. Two components:
- **Signal collection** (`reflection/signals.ts`): Passively records events — errors, tool failures, duplicate loop patterns. Never throws, ensuring it can't crash the main pipeline. Auto-prunes signals older than 7 days.
- **Reflection daemon** (`reflection/daemon.ts`): Runs on a configurable interval (default: every 6 hours). Gathers signals, builds a structured analysis prompt, calls Claude, and if an improvement is found, records it as an evolution idea and posts a proposal to a Discord channel. Level 1 trust: never auto-implements — always requires human approval.

**Watchdog Daemon** — Standalone process (`src/daemon/index.ts`) that spawns the bot, monitors health, handles crash recovery with evolution rollback, and sends Discord webhook notifications. Exit code 100 from the bot triggers a deploy-restart (git pull + rebuild) rather than a simple respawn. Zero imports from the main bot.

**Restart** — The bot can restart itself via `/restart` command or automatically after merging an evolution PR. On restart, stale instances are automatically detected and killed to prevent duplicate bots. An idempotent startup script (`start.sh`) handles deploy: `git pull` → run migrations → build → start → health check → auto-rollback on failure.

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
            EVO[Evolution Engine<br/>Self-Modification]
            VOICE[Voice Transcription<br/>Whisper API]
            REFL[Reflection Daemon<br/>Signal Analysis]
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
    OPENAI[OpenAI Whisper API]

    DU <-->|messages + voice| DG
    DG <-->|events| CL
    CL --> MH
    CL --> SC
    MH --> SESS
    SESS --> DB
    MH -->|voice messages| VOICE
    VOICE <-->|transcribe| OPENAI
    VOICE -->|text| MH
    MH --> PM
    PM --> SP
    SP --> SOUL
    SP --> MEM
    PM --> TL
    TL <-->|messages + tools| CLAUDE
    TL -->|memory_search, memory_get| MEM
    TL -->|send_message, send_file, add_reaction, create_thread| CL
    TL -->|evolve_start, evolve_write, evolve_propose, evolve_merge| EVO
    EVO -->|git worktree, gh pr create| GH[GitHub]
    EVO --> DB
    MH -->|log| DB
    MH -->|broadcast| WS
    MEM --> DB
    MEM --> FS
    SOUL --> FS
    CRON -->|agent turns| PM
    CRON -->|deliver| CL
    CRON --> FS
    REFL -->|collect signals| DB
    REFL -->|analyze| CLAUDE
    REFL -->|propose ideas| EVO
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
    participant V as Voice Transcription
    participant S as Session Manager
    participant A as Agent
    participant C as Claude API
    participant M as Memory
    participant DB as SQLite

    U->>B: @mention, DM, or voice message
    B->>B: Filter (bot? mention? monitored? bot thread?)

    opt Voice Message Detected
        B->>V: transcribeAudio(attachment URL)
        V->>V: Download OGG → Whisper API
        V-->>B: transcribed text
    end

    B->>S: resolveSession(channel, user)
    S->>DB: lookup / create session
    S-->>B: session + history

    B->>B: Start typing indicator (refreshes every 8s)
    B->>A: processMessage(text, history, context)
    A->>A: Build system prompt (soul + memory instructions + channel config)
    A->>C: messages.create(system, messages, tools)

    loop Tool Use Loop (with duplicate detection)
        C-->>A: tool_use: memory_search
        A->>M: searchMemory(query)
        M->>DB: FTS5 MATCH query (sanitized)
        M-->>A: ranked results
        A->>C: tool_result + continue
        A->>A: Check for duplicate tool calls
    end

    C-->>A: text response
    A-->>B: AgentResponse (text + images)

    B->>B: Stop typing indicator
    B->>DB: log + archive user message
    B->>DB: log + archive assistant response
    B->>U: Create thread → reply inside
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
        C-->>A: response (agent creates thread + posts via tools)
        A-->>CS: result text (delivery handled by agent)
    else systemEvent payload
        CS->>CS: log event text
        opt delivery configured
            CS->>D: channel.send(result)
        end
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
    UI -->|GET /api/evolutions| API
    UI <-->|real-time logs| WS

    API --> DB
    API --> FS
    API --> CRON
```

### Voice Assistant Pipeline

The voice assistant is the most complex real-time data flow in the system. It processes live audio from Discord voice channels through a multi-stage pipeline: audio capture → speech detection → transcription → AI reasoning → speech synthesis → playback — all while handling interruptions and concurrent user streams.

#### High-Level Pipeline

```mermaid
graph LR
    subgraph "🎤 Capture"
        A1[Discord Opus Stream]
        A2[Opus Decode]
        A3[Downsample<br/>48kHz → 16kHz mono]
    end

    subgraph "🧠 Detect"
        B1[Silero VAD<br/>ONNX v4]
        B2{Speech<br/>prob > 0.5?}
        B3[Silence Timer<br/>800ms]
    end

    subgraph "📝 Understand"
        C1[Concatenate PCM<br/>Chunks]
        C2[Encode WAV<br/>16kHz mono]
        C3[EigenAI Whisper<br/>V3 Turbo]
    end

    subgraph "🤖 Think"
        D1[Voice Agent<br/>Claude or Eigen LLM]
        D2[Tools<br/>memory / discord / bash / skills]
    end

    subgraph "🔊 Speak"
        E1[EigenAI Chatterbox<br/>TTS]
        E2[AudioPlayer<br/>discord.js]
    end

    A1 --> A2 --> A3
    A3 -->|Float32 frames| B1
    A3 -->|Int16 chunks| C1
    B1 --> B2
    B2 -->|Yes| B3
    B2 -->|No speech| B1
    B3 -->|Timeout| C1
    C1 --> C2 --> C3
    C3 -->|text| D1
    D1 <-->|tool calls| D2
    D1 -->|response text| E1
    E1 -->|WAV buffer| E2
```

#### Detailed Sequence: Full Utterance Lifecycle

```mermaid
sequenceDiagram
    participant U as Discord User
    participant DC as Discord Gateway
    participant CMD as /join Command
    participant CONN as connection.ts
    participant RECV as receiver.ts
    participant VAD as vad.ts<br/>(Silero ONNX)
    participant ORCH as index.ts<br/>(Orchestrator)
    participant STT as stt.ts<br/>(EigenAI Whisper)
    participant AGT as agent.ts<br/>(Claude)
    participant MEM as Memory System
    participant TTS as tts.ts<br/>(EigenAI Chatterbox)
    participant AP as AudioPlayer

    Note over CMD,CONN: ── Initialization ──

    U->>CMD: /join
    CMD->>CONN: joinChannel(voiceChannel)
    CONN->>DC: joinVoiceChannel(channelId, guildId)
    DC-->>CONN: VoiceConnectionStatus.Ready
    CONN-->>CMD: VoiceConnection
    CMD->>ORCH: startVoice(channel)
    ORCH->>AP: connection.subscribe(audioPlayer)
    ORCH->>ORCH: Start idle timer (10 min)

    Note over U,AP: ── User Speaks ──

    U->>DC: Speaks into mic
    DC->>ORCH: speaking:start(userId)
    ORCH->>ORCH: Initialize UserUtteranceState
    ORCH->>RECV: subscribeToUser(connection, userId)
    RECV->>RECV: receiver.subscribe(userId, AfterSilence 5s)

    Note over RECV: Auto-detect mono vs stereo<br/>on first opus packet

    loop Every 20ms Opus Packet
        DC->>RECV: opus packet (48kHz)
        RECV->>RECV: decodeOpus(packet, channels)
        RECV->>ORCH: onRawPcm(Int16Array)
        RECV->>RECV: downsampleToMono16k(pcm48k)
        RECV->>ORCH: onFrame(Float32Array)

        ORCH->>ORCH: Accumulate into VAD frame buffer

        opt VAD frame buffer full (480 samples = 30ms)
            ORCH->>VAD: process(frame)
            VAD-->>ORCH: probability [0.0-1.0]

            alt prob > 0.5 (speech detected)
                Note over ORCH: If first speech frame:<br/>set isSpeaking=true,<br/>start buffering rawChunks
                opt Bot is currently playing
                    ORCH->>AP: stop() — interrupt!
                    Note over AP: ⚡ Playback cut off
                end
                ORCH->>ORCH: Reset silence timer
                ORCH->>ORCH: Buffer rawChunks += pcm
            else prob ≤ 0.5 (silence) AND isSpeaking
                opt No active silence timer
                    ORCH->>ORCH: Start silence timer (800ms)
                end
            end
        end
    end

    Note over U,AP: ── Utterance Complete ──

    ORCH->>ORCH: Silence timer fires → onUtteranceComplete()

    alt utterance < 500ms
        ORCH->>ORCH: Discard (too short — noise/cough)
    else already processing another utterance
        ORCH->>ORCH: Skip (no queue yet)
    else valid utterance
        ORCH->>ORCH: processing = true

        Note over ORCH,STT: Step 1/5: Prepare Audio
        ORCH->>ORCH: Concatenate rawChunks → Int16Array
        ORCH->>RECV: downsampleToMono16kInt16(rawPcm, channels)
        RECV-->>ORCH: mono 16kHz Int16Array
        ORCH->>VAD: reset() — clear LSTM hidden states

        Note over ORCH,STT: Step 2/5: Speech-to-Text
        ORCH->>STT: transcribe(mono16kPcm)
        STT->>STT: encodeWav(samples, 16000)
        STT->>STT: POST /api/v1/generate<br/>(model: whisper_v3_turbo)
        STT-->>ORCH: transcribed text

        alt empty transcription
            ORCH->>ORCH: Skip — nothing detected
        else has text
            Note over ORCH,AGT: Step 3/5: AI Response
            ORCH->>ORCH: getUserDisplayName(userId)
            ORCH->>AGT: processVoiceUtterance(text, userName)
            AGT->>AGT: Build system prompt<br/>(voice rules + soul brief + time + speaker)
            AGT->>AGT: Append to ephemeral voiceHistory (max 10 turns)
            AGT->>AGT: Claude messages.create()<br/>(VOICE_MODEL, 512 max_tokens, tools)

            opt Claude requests tool_use (up to 5 rounds)
                AGT->>MEM: handleVoiceTool(name, input)
                MEM-->>AGT: tool result
                AGT->>AGT: Follow-up Claude call
            end

            AGT-->>ORCH: response text (1-3 sentences, no markdown)

            Note over ORCH,AP: Step 4/5: Text-to-Speech
            ORCH->>TTS: synthesize(responseText)
            TTS->>TTS: POST /api/chatterbox<br/>(JSON: {text})
            TTS-->>ORCH: WAV audio buffer

            Note over ORCH,AP: Step 5/5: Playback
            ORCH->>AP: play(audioResource)
            AP-->>ORCH: AudioPlayerStatus.Idle

            ORCH->>ORCH: processing = false
        end
    end

    Note over U,AP: ── Cleanup ──

    alt Idle timeout (10 min no activity)
        ORCH->>ORCH: stopVoice()
        ORCH->>AGT: clearVoiceHistory()
        ORCH->>CONN: leaveChannel()
        CONN->>DC: connection.destroy()
    else User runs /leave
        CMD->>ORCH: stopVoice()
        ORCH->>AGT: clearVoiceHistory()
        ORCH->>CONN: leaveChannel()
    else Opus stream ends
        RECV->>ORCH: onStreamEnd()
        ORCH->>ORCH: Complete pending utterance
        ORCH->>ORCH: Clean up userState<br/>(re-subscribe on next speaking:start)
    end
```

#### Audio Format Transformations

```mermaid
graph TD
    subgraph "Discord Input"
        I1["Opus packets<br/>48kHz, mono or stereo<br/>20ms frames"]
    end

    subgraph "Decode (receiver.ts)"
        D1["OpusEncoder.decode()<br/>→ PCM Int16<br/>48kHz, 960 or 1920 samples/frame"]
    end

    subgraph "Dual Output Path"
        direction LR
        P1["<b>VAD Path</b><br/>downsampleToMono16k()<br/>→ Float32 [-1.0, 1.0]<br/>16kHz mono, 320 samples/frame"]
        P2["<b>Buffer Path</b><br/>Raw Int16 chunks<br/>48kHz, original channels<br/>accumulated while speaking"]
    end

    subgraph "STT Preparation"
        S1["Concatenate raw chunks<br/>→ single Int16Array"]
        S2["downsampleToMono16kInt16()<br/>→ Int16, 16kHz mono"]
        S3["encodeWav()<br/>→ WAV file buffer<br/>44-byte header + PCM data"]
    end

    subgraph "STT API"
        A1["EigenAI Whisper V3 Turbo<br/>multipart/form-data POST<br/>→ JSON { text }"]
    end

    subgraph "TTS Output"
        T1["EigenAI Chatterbox<br/>JSON POST { text }<br/>→ WAV audio buffer"]
    end

    subgraph "Playback"
        PL1["Readable.from(wavBuffer)<br/>→ createAudioResource()<br/>StreamType.Arbitrary"]
    end

    I1 --> D1
    D1 --> P1
    D1 --> P2
    P1 -->|"30ms frames"| VAD["Silero VAD<br/>ONNX inference"]
    P2 -->|"on utterance complete"| S1
    S1 --> S2 --> S3
    S3 --> A1
    A1 -->|"text"| Claude["Claude or Eigen LLM<br/>→ spoken response"]
    Claude -->|"text"| T1
    T1 --> PL1
    PL1 --> Speaker["🔊 Discord Voice Channel"]
```

#### VAD State Machine

```mermaid
stateDiagram-v2
    [*] --> Listening: speaking:start event

    Listening --> SpeechDetected: VAD prob > 0.5
    Listening --> Listening: VAD prob ≤ 0.5

    SpeechDetected --> SpeechDetected: VAD prob > 0.5<br/>(reset silence timer)
    SpeechDetected --> SilenceTimer: VAD prob ≤ 0.5<br/>(start 800ms timer)

    SilenceTimer --> SpeechDetected: VAD prob > 0.5<br/>(cancel timer)
    SilenceTimer --> UtteranceComplete: Timer expires

    UtteranceComplete --> Discarded: duration < 500ms
    UtteranceComplete --> Skipped: already processing
    UtteranceComplete --> Pipeline: valid utterance

    Discarded --> Listening
    Skipped --> Listening

    Pipeline --> STT: transcribe audio
    STT --> AgentThink: text received
    STT --> Listening: empty transcription
    AgentThink --> TTS: response generated
    TTS --> Playing: audio synthesized
    Playing --> Listening: playback complete

    state "Interruption" as INT {
        [*] --> CheckPlaying
        CheckPlaying --> StopPlayer: bot is playing
        StopPlayer --> [*]: audioPlayer.stop()
    }

    SpeechDetected --> INT: new speech starts\nwhile bot playing
    INT --> SpeechDetected

    Listening --> [*]: stream ends / leave / idle timeout
```

#### Source File Responsibilities

```mermaid
graph TB
    subgraph "voice/index.ts — Orchestrator"
        INIT[initVoice / startVoice / stopVoice]
        STATE["Per-user state management<br/>UserUtteranceState map"]
        PIPELINE["5-step pipeline orchestration<br/>Audio → STT → Agent → TTS → Play"]
        INTERRUPT["Interruption handling<br/>audioPlayer.stop on new speech"]
        IDLE["Idle timeout (10 min)<br/>auto-disconnect"]
    end

    subgraph "voice/connection.ts"
        JOIN["joinChannel(VoiceBasedChannel)<br/>joinVoiceChannel + entersState(Ready)"]
        LEAVE["leaveChannel()<br/>connection.destroy()"]
        LIFECYCLE["Connection state tracking<br/>Disconnected / Destroyed handlers"]
    end

    subgraph "voice/receiver.ts"
        SUBSCRIBE["subscribeToUser()<br/>opus stream subscription"]
        DECODE["decodeOpus(packet, channels)<br/>@discordjs/opus"]
        DETECT["Auto-detect mono vs stereo<br/>first-packet heuristic"]
        DS_FLOAT["downsampleToMono16k()<br/>48kHz Int16 → 16kHz Float32"]
        DS_INT["downsampleToMono16kInt16()<br/>48kHz Int16 → 16kHz Int16"]
    end

    subgraph "voice/vad.ts"
        VAD_INIT["SileroVAD.init()<br/>Load ONNX model (v4, ~2MB)"]
        VAD_PROC["process(frame)<br/>480 samples → probability"]
        VAD_RESET["reset()<br/>Clear LSTM h/c states"]
    end

    subgraph "voice/stt.ts"
        WAV["encodeWav(samples, sampleRate)<br/>44-byte header + PCM"]
        TRANSCRIBE["transcribe(pcm16kMono)<br/>POST to EigenAI Whisper V3 Turbo"]
    end

    subgraph "voice/agent.ts"
        VOICE_PROMPT["Voice system prompt<br/>1-3 sentences, no markdown"]
        HISTORY["Ephemeral voice history<br/>max 10 turns"]
        PROCESS["processVoiceUtterance(text, userName)<br/>Claude + tools (up to 5 rounds)"]
        CLEAR["clearVoiceHistory()<br/>reset on disconnect"]
    end

    subgraph "voice/eigenllm.ts"
        EIGEN["Eigen LLM client<br/>OpenAI-compatible streaming<br/>for low-latency pure text mode"]
    end

    subgraph "voice/autoJoin.ts"
        AUTOJOIN["Auto-join/leave voice channels<br/>tracks a configured user"]
    end

    subgraph "voice/tts.ts"
        SYNTH["synthesize(text)<br/>POST to EigenAI Chatterbox<br/>→ WAV buffer"]
    end

    INIT --> JOIN
    INIT --> SUBSCRIBE
    INIT --> VAD_INIT
    STATE --> PIPELINE
    PIPELINE --> DS_INT
    PIPELINE --> TRANSCRIBE
    PIPELINE --> PROCESS
    PIPELINE --> SYNTH
    PROCESS -.->|"eigen: prefix"| EIGEN
    SUBSCRIBE --> DECODE
    DECODE --> DETECT
    DECODE --> DS_FLOAT
    PROCESS --> VOICE_PROMPT
    PROCESS --> HISTORY
    IDLE --> LEAVE
    IDLE --> CLEAR
    INTERRUPT -.->|"audioPlayer.stop()"| SYNTH
    AUTOJOIN --> INIT
```

### Evolution Flow

```mermaid
sequenceDiagram
    participant U as Discord User
    participant A as Agent
    participant E as Evolution Engine
    participant W as beta/ Worktree
    participant GH as GitHub
    participant DC as Deploy Channel

    U->>A: "Add feature X"
    A->>E: evolve_start(reason)
    E->>W: git worktree add beta/
    E->>W: symlink node_modules
    E-->>A: evolution ID + branch

    loop Make Changes
        A->>W: evolve_write(path, content)
        A->>W: evolve_read(path)
        A->>W: evolve_bash(command)
    end

    A->>E: evolve_propose(summary)
    E->>W: npm run typecheck
    E->>W: vitest run (120s timeout)
    E->>W: git add + commit
    E->>GH: git push + gh pr create
    E->>E: git worktree remove beta/
    E-->>A: PR URL

    A->>U: "PR created: github.com/.../pull/N"

    U->>A: "Show me the PR"
    A->>E: evolve_review(id)
    E->>GH: gh pr diff
    E-->>A: summary + diff
    A->>U: Shows changes for review

    U->>A: "Merge it"
    A->>E: evolve_merge(id)
    E->>GH: gh pr merge --squash
    E->>DC: Create deployment thread
    E->>E: triggerRestart()
    E->>E: start.sh: git pull → migrate → build → start
    E->>E: Health check ✓ (or auto-rollback)
```

## Project Structure

```
discordclaw/
├── src/
│   ├── index.ts              # Entry point: start all systems, kill stale instances on restart
│   ├── restart.ts            # Shared restart trigger — avoids circular deps
│   ├── bot/                   # Discord bot (discord.js v14)
│   │   ├── client.ts          # Client setup, intents, event routing, DM raw fallback
│   │   ├── messages.ts        # Message pipeline: filter → session → voice transcribe → agent → thread reply
│   │   └── commands.ts        # Slash commands: /ping /help /config /clear /soul /skills /cron /restart /join /leave
│   ├── agent/                 # Claude integration
│   │   ├── agent.ts           # Anthropic SDK wrapper, system prompt, tool loop + duplicate detection + conversation history tools
│   │   ├── tools.ts           # Discord tools (send_message, send_file, add_reaction, get_channel_history, create_thread)
│   │   ├── dangerous-tools.ts # Powerful tools: bash, read_file, write_file
│   │   └── sessions.ts        # Per-thread/DM session tracking + TTL + message archiving
│   ├── audio/                 # Voice message handling
│   │   └── transcribe.ts      # Download + transcribe via OpenAI Whisper API
│   ├── voice/                 # Voice assistant (real-time voice channel)
│   │   ├── connection.ts      # Join/leave voice channels, VoiceConnection lifecycle
│   │   ├── receiver.ts        # Opus decode, auto-detect mono/stereo, downsample 48kHz → 16kHz mono
│   │   ├── vad.ts             # Silero VAD wrapper (ONNX runtime, v4 model)
│   │   ├── stt.ts             # EigenAI Whisper V3 Turbo STT client
│   │   ├── tts.ts             # EigenAI Chatterbox TTS client
│   │   ├── agent.ts           # Voice-optimized LLM (default: Sonnet, configurable via VOICE_MODEL, 512 tokens, spoken style)
│   │   ├── eigenllm.ts        # Eigen LLM client — OpenAI-compatible streaming for low-latency pure text mode
│   │   ├── autoJoin.ts        # Auto-join/leave voice channels when tracked user joins/leaves
│   │   └── index.ts           # Orchestrator: wires receive → VAD → STT → agent → TTS → play
│   ├── skills/                # Skills management (SDK pattern)
│   │   ├── types.ts           # Skill, SkillMeta, SkillSource types
│   │   ├── store.ts           # Filesystem-based discovery + per-skill .meta.json
│   │   ├── service.ts         # CRUD, GitHub install, prompt generation, file watcher
│   │   └── tools.ts           # read_skill + list_skill_files tool definitions
│   ├── soul/
│   │   └── soul.ts            # Load SOUL.md, file watcher, hot-reload
│   ├── memory/
│   │   ├── memory.ts          # File discovery, FTS5 indexing, BM25 search, query sanitization
│   │   └── tools.ts           # memory_search + memory_get tool definitions
│   ├── shared/                # Utilities shared between main agent and voice agent
│   │   ├── paths.ts           # Project root resolution
│   │   ├── anthropic.ts       # Anthropic SDK client factory
│   │   ├── discord-utils.ts   # Channel/guild helpers
│   │   └── conversation-history.ts # Cross-session message loading + conversation history tools
│   ├── cron/
│   │   ├── types.ts           # Job, schedule, payload, delivery types
│   │   ├── store.ts           # JSON persistence + JSONL run history + hot-reload
│   │   └── service.ts         # Timer loop, execution, retry, auto-disable, thread-only delivery for agentTurn
│   ├── reflection/            # Autonomous self-improvement
│   │   ├── signals.ts         # Passive signal collection (errors, tool failures, duplicate loops)
│   │   └── daemon.ts          # Periodic analysis, idea generation, channel proposals
│   ├── evolution/             # Self-evolution system
│   │   ├── engine.ts          # Git worktree lifecycle, PR creation via gh CLI, deployment notifications
│   │   ├── log.ts             # Evolution SQLite table + CRUD
│   │   ├── tools.ts           # Agent tools: evolve_start/read/write/bash/propose/suggest/cancel/review/merge
│   │   └── health.ts          # /api/health endpoint for start.sh
│   ├── daemon/                # Watchdog daemon (standalone process)
│   │   └── index.ts           # Spawns bot, health monitoring, crash recovery, evolution rollback
│   ├── db/
│   │   └── index.ts           # SQLite schema, migrations, query helpers
│   └── gateway/
│       ├── server.ts          # Express + WebSocket server
│       ├── api.ts             # REST API (status, sessions, channels, config, soul, memory, cron, skills, evolutions)
│       └── ui/                # React SPA (Vite)
│           ├── App.tsx         # Layout, routing, shared styles
│           └── pages/          # Status, Sessions, Channels, Config, Cron, Skills, Evolution, Logs
├── tests/
│   └── integration/           # Integration tests (vitest)
│       └── boot.test.ts       # Critical boot path: DB, Soul, Memory, Skills, Images, Tools
├── data/                      # Runtime data (gitignored)
│   ├── discordclaw.db         # SQLite database
│   ├── SOUL.md                # Bot personality
│   ├── MEMORY.md              # Long-term memory
│   ├── memory/                # Daily memory notes
│   ├── cron/                  # Job store + run history (jobs.json gitignored, seed file tracked)
│   ├── skills/                # Installed skills (SKILL.md + companion files)
│   ├── models/                # ML models (Silero VAD ONNX, gitignored)
│   └── .migrations/           # Marker files for completed migrations
├── migrations/                # Idempotent migration scripts (run by start.sh)
├── start.sh                   # Production startup: pull → migrate → build → start → health check
├── .env                       # DISCORD_BOT_TOKEN, ANTHROPIC_* config, OPENAI_API_KEY
├── package.json
├── tsconfig.json
└── vite.config.ts
```
