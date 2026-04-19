/**
 * Coach Brain — LLM-powered cycling coach decision engine.
 *
 * Every poll cycle, the brain receives current cycling telemetry and
 * a rolling history of recent data points. It decides whether to speak
 * and what to say.
 *
 * The LLM can respond with actual coaching text or "[SILENCE]" when
 * there's nothing worth saying.
 */

import { anthropicClient } from "../shared/anthropic.js";
import type { CyclingData } from "./mock-server.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COACH_MODEL = "claude-sonnet-4-20250514";
const COACH_MAX_TOKENS = 150;

// ---------------------------------------------------------------------------
// History buffer
// ---------------------------------------------------------------------------

const MAX_DATA_HISTORY = 20;
const dataHistory: CyclingData[] = [];

const MAX_COACH_HISTORY = 10;
const coachHistory: { role: "user" | "assistant"; content: string }[] = [];

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an aggressive cycling coach watching real-time rider telemetry (heart rate, power, cadence) during a training session. You speak directly into the rider's ear through their headphones.

YOUR PERSONALITY:
- Intense, motivating, no-nonsense
- Mix of David Goggins intensity and professional cycling coach knowledge
- SHORT and punchy — 1-2 sentences MAX. This is audio, not text.
- Use second person: "you", never "the rider"
- Occasionally swear mildly for emphasis (damn, hell)
- Know cycling terminology: watts, FTP, zone, cadence, RPM, pedal stroke

WHEN TO SPEAK:
- Entering a hard interval (power/HR spike) → push them
- Power dropping during an effort → call them out aggressively  
- Good sustained effort → brief praise, don't over-praise
- Recovery period → let them breathe, maybe short instruction
- Phase transitions → announce what's coming
- HR in zone 5 for extended time → acknowledge the pain, push through
- Cadence too low (< 80) → tell them to spin
- Cadence too high (> 110) → tell them to settle

WHEN TO BE SILENT:
- If you just spoke and nothing changed → respond with exactly [SILENCE]
- During steady recovery if nothing notable → [SILENCE]
- Don't repeat yourself — if you already said "push harder" and they are, shut up

RESPONSE FORMAT:
- Either coaching text (1-2 sentences, spoken style, no markdown) 
- OR exactly: [SILENCE]

NEVER use markdown, emojis, bullet points, or formatting. This goes directly to text-to-speech.`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reset the coach brain state (call when a ride starts/stops).
 */
export function resetCoachBrain(): void {
  dataHistory.length = 0;
  coachHistory.length = 0;
  console.log("[coach-brain] Reset");
}

/**
 * Feed new cycling data and get a coaching response.
 * Returns the coaching text, or null if the coach decides to stay silent.
 */
export async function getCoachResponse(data: CyclingData): Promise<string | null> {
  // Add to history
  dataHistory.push(data);
  if (dataHistory.length > MAX_DATA_HISTORY) {
    dataHistory.shift();
  }

  // Build the data context
  const recentStr = dataHistory
    .slice(-5)
    .map((d) => `[${d.elapsed_min}min] HR:${d.hr} W:${d.watts} CAD:${d.cadence} Z${d.zone} ${d.phase}${d.is_interval ? " ⚡" : ""}`)
    .join("\n");

  const currentStr = `CURRENT → HR: ${data.hr} bpm | Power: ${data.watts}W | Cadence: ${data.cadence} RPM | Zone: ${data.zone} | Phase: ${data.phase} | Elapsed: ${data.elapsed_min} min${data.is_interval ? " | INTERVAL EFFORT" : ""}`;

  // Compute trends
  let hrTrend = "stable";
  let wattsTrend = "stable";
  if (dataHistory.length >= 3) {
    const recent3 = dataHistory.slice(-3);
    const hrDelta = recent3[2].hr - recent3[0].hr;
    const wattsDelta = recent3[2].watts - recent3[0].watts;
    if (hrDelta > 8) hrTrend = "rising";
    else if (hrDelta < -8) hrTrend = "falling";
    if (wattsDelta > 20) wattsTrend = "rising";
    else if (wattsDelta < -20) wattsTrend = "falling";
  }

  const userMessage = `${currentStr}

Recent history:
${recentStr}

Trends: HR ${hrTrend}, Power ${wattsTrend}

What do you say to the rider? (Or [SILENCE] if nothing needs saying)`;

  // Build messages
  const messages: { role: "user" | "assistant"; content: string }[] = [
    ...coachHistory,
    { role: "user", content: userMessage },
  ];

  try {
    const response = await anthropicClient.messages.create({
      model: COACH_MODEL,
      max_tokens: COACH_MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages,
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join(" ")
      .trim();

    // Update coach history
    coachHistory.push({ role: "user", content: userMessage });
    coachHistory.push({ role: "assistant", content: text });
    while (coachHistory.length > MAX_COACH_HISTORY * 2) {
      coachHistory.shift();
    }

    // Check for silence
    if (text.includes("[SILENCE]") || text.toLowerCase() === "silence") {
      console.log(`[coach-brain] 🤫 Silence (${data.phase}, HR:${data.hr}, W:${data.watts})`);
      return null;
    }

    console.log(`[coach-brain] 🗣️ "${text}"`);
    return text;
  } catch (err) {
    console.error("[coach-brain] ❌ LLM error:", err);
    return null;
  }
}
