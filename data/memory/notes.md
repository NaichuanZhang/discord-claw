
## Monitored Channels
Channels with `"monitor": true` in their channel_configs settings will have the bot respond to ALL messages (no @mention needed). Top-level messages create threads, messages in threads under monitored channels get direct responses.

Currently monitored channels:
- 1491470706171711659 
- 1491834183889457285
- 1491850506883170345

To add more: `INSERT OR REPLACE INTO channel_configs (channel_id, enabled, settings, updated_at) VALUES ('<id>', 1, '{"monitor": true}', <timestamp_ms>);`

## Voice Assistant Project
- Goal: Make the Discord bot act as a voice assistant in voice channels
- **STT**: EigenAI Whisper v3 Turbo
  - Endpoint: `https://api-web.eigenai.com/api/v1/generate`
  - Model: `whisper_v3_turbo`
  - API Key: `sk-6eec6e97_5f91daae09f851bb343f6232cb4d2c6d2aee015cb242264a2d45bb2944fc2d14`
  - Supports: language param, json response format
- **TTS**: TBD (OpenAI TTS, ElevenLabs, or AWS Polly)
- **Pipeline**: Join voice → receive audio → STT (EigenAI) → Claude → TTS → play audio back
- **Requires**: @discordjs/voice, @discordjs/opus, sodium-native, GuildVoiceStates intent

## LiteLLM Proxy — Model Inventory (2026-04-13)
- **Proxy URL**: `http://100.75.23.51:4321` (ANTHROPIC_BASE_URL)
- **Auth**: `sk-1234` (ANTHROPIC_AUTH_TOKEN)
- **Current voice model**: `bedrock-claude-haiku-4-5`
- **Current text model**: `bedrock-claude-opus-4-6-1m`

### Available models on proxy:
**Claude (Bedrock):**
- `bedrock-claude-haiku-4-5` — fastest, used for voice
- `claude-haiku-4-5-20251001` — direct API Haiku
- `bedrock-claude-sonnet-4-1m` — Sonnet with 1M context
- `bedrock-claude-4-5-sonnet-1m` — Claude 4.5 Sonnet 1M
- `bedrock-claude-4-5-sonnet-eu` — Claude 4.5 Sonnet EU region
- `bedrock-claude-opus-4` — Opus 4
- `bedrock-claude-opus-4-1` — Opus 4.1
- `bedrock-claude-opus-4-5-1m` — Opus 4.5 with 1M
- `bedrock-claude-opus-4-6-1m` — Opus 4.6 with 1M (current text model)

**Other:**
- `cohere-embed-multilingual-v3` — embeddings
- `stability-ultra` / `stability-core` / `stability.sd3-5-large-v1:0` — image gen

### Voice latency discussion:
- Voice pipeline total ~5.5s (STT=473ms, Agent=2104ms, TTS=1184ms, Play=1755ms)
- Agent step is the bottleneck
- Already using Haiku for voice — options to speed up further: streaming TTS, parallel Claude+TTS, faster TTS provider

## Evolution Preferences (from Alex)
- **Quality over speed, always.** Time is not a concern for evolutions.
- Do NOT cap file reads before implementation — read as many files as needed to fully understand context.
- Thoroughness prevents bad PRs, which are far more expensive than extra read rounds.
- No artificial constraints on preparation — get it right the first time.
