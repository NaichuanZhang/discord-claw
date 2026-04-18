# Voice Pipeline Optimization Notes

## Current Architecture (as of 2026-04-13)
- **STT**: EigenAI Whisper V3 Turbo (`whisper_v3_turbo`) — endpoint: `https://api-web.eigenai.com/api/v1/generate`
- **Agent**: Claude Sonnet 4 (`claude-sonnet-4-20250514`) via Anthropic/Bedrock — configurable via `VOICE_MODEL` env var
- **TTS**: EigenAI Chatterbox — endpoint: `https://api-web.eigenai.com/api/chatterbox`

## Typical Latencies (observed)
- STT: ~470ms
- Agent (Sonnet): ~2100ms ← biggest bottleneck
- TTS (Chatterbox): ~1200ms
- Playback: ~1750ms
- **Total: ~5.5s**

## EigenAI Available LLM Models (from /v1/models)
- gpt-oss-120b
- minimax-m2-5
- qwen3-235b-thinking
- kimi-k2-5
- qwen3-next-80b-a3b-thinking
- llama31-8b
- dpsk-3-2
- qwen3-vl-30b-thinking
- qwen3-30b-fp8
- qwen3-8b-fp8
- qwen3-coder-480b
- qwen3-5-397b
- qwen3-vl-30b-instruct

## Optimization Options Discussed
1. **Quick win**: Switch VOICE_MODEL to Haiku (`claude-haiku-4-5-20250514`) — could cut agent time to ~400-600ms
2. **Medium**: Stream TTS — start playback before full audio generated
3. **Medium**: Stream Claude + TTS in parallel — pipe first sentence to TTS while Claude generates rest
4. **Harder**: Swap TTS provider for lower latency (ElevenLabs Turbo, Deepgram Aura)
5. **Option**: Use EigenAI LLMs (e.g. llama31-8b, qwen3-8b-fp8) as voice model — potentially very fast but need to test quality

## Key Files
- `src/voice/stt.ts` — STT client
- `src/voice/tts.ts` — TTS client  
- `src/voice/agent.ts` — Voice agent (Claude), reads VOICE_MODEL env var, default: claude-sonnet-4-20250514
