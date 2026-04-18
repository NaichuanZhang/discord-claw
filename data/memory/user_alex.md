# Alex — User Profile

## Basics
- Discord User ID: 152801068663832576
- Location: Mountain View, CA
- Workplace: Palo Alto, CA
- DM Channel: 1482509625256448030

## Body Stats (as of April 2026)
- Weight: 63.9 kg (140.8 lbs)
- Body fat: 32%
- Lean mass: ~43.5 kg
- Fat mass: ~20.4 kg
- Resting calories (BMR): ~1,700 kcal/day
- Goal: Recomposition (maintain weight, fat → lean transition)
- No dietary restrictions

## Fitness
- Very active cyclist and lifter
- Rides Bay Trail / Shoreline area frequently
- Strava user — 1,003+ all-time rides, 9,000+ miles
- Logs 3-5 activities per day (rides, weights, walks)
- Starred segments: Palo-Roubaix, Central Sprint, 戒台寺正爬 (Beijing climb)
- Activity names can be misleading — always check HR/suffer score for intensity

## Nutrition Tracking
- Tracks daily food intake in #disclaw-food (channel: 1492254579629359114)
- Posts meals as text or photos → I estimate calories + macros (protein/carbs/fat)
- Daily thread created at 5:00 AM PT via cron job
- Memory file: data/memory/food_log.md
- Daily targets: ~1,700-1,900 kcal, 140-155g protein, 50-60g fat, 120-160g carbs
- Recomp strategy: high protein priority, moderate fat, carbs flexed around training
- Started: April 10, 2026

## Preferences & Working Style
- Prefers fast iteration — short messages, quick decisions
- Values agent autonomy — wants me to act and propose, not ask permission
- Likes tradeoff discussions before big decisions
- Wants skills documented so mistakes aren't repeated
- Quotes: "the dirty way is actually the clean way to utilize agents capabilities"
- **Search results**: Always include inline source links woven into text — do NOT list sources separately at the bottom
- **Architecture**: Prefer extending existing tables over creating new ones (nulls > extra joins)
- **Evolution process**: Always plan before coding — read current structure, identify all files, outline changes first

## Integrations Built
- Strava API skill (OAuth 2.0, refresh token flow)
- Daily training plan at 5:30 AM (cron job)
- Nightly self-reflection at 10:00 PM PT (cron job)
- Market morning research at 6:15 AM PT weekdays (cron job)
- Daily food tracking thread at 5:00 AM PT (cron job)
- **Voice assistant pipeline** (built April 13, 2026)

## Voice Assistant Architecture
- **Voice channel**: #disclaw-voice (1428838638166343714)
- **Pipeline**: Discord opus → PCM → Silero VAD → EigenAI Whisper v3 Turbo (STT) → Claude (agent) → EigenAI Chatterbox (TTS) → opus playback
- **STT**: EigenAI Whisper v3 Turbo ($0.0009/min) — endpoint via EIGENAI_API_KEY
- **TTS**: EigenAI Chatterbox ($0.10/min)
- **Voice model**: `bedrock-claude-haiku-4-5` via LiteLLM proxy (separate VOICE_MODEL env var)
- **VAD**: Silero v5 via onnxruntime-node (NOT @ricky0123/vad-node) — uses `state` input, not `h`/`c`
- **LiteLLM proxy**: http://100.75.23.51:4321, key: sk-1234
- **Key debug lesson**: Silero VAD v5 changed input signature from `h`/`c` to `state` — caused silent 0.001 probability on all frames
- **Key debug lesson**: Audio downsampling from 48kHz stereo to 16kHz mono must preserve amplitude for VAD to detect speech
- **Commands**: `/join` (joins your voice channel), `/leave` (disconnects)
