/**
 * Coach Brain — LLM-powered cycling coach decision engine.
 *
 * Every poll cycle, the brain receives current cycling telemetry,
 * a rolling history of recent data points, and any rider speech
 * that was captured since the last cycle. It decides whether to speak
 * and what to say.
 *
 * The LLM can respond with actual coaching text or "[SILENCE]" when
 * there's nothing worth saying.
 */

import { anthropicClient } from "../shared/anthropic.js";
import type { CyclingData } from "./mock-server.js";
import type { RiderMessage } from "./listener.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COACH_MODEL = process.env.COACH_MODEL || "bedrock-claude-sonnet-4-1m";
const COACH_MAX_TOKENS = 150;

// ---------------------------------------------------------------------------
// History buffer
// ---------------------------------------------------------------------------

const MAX_DATA_HISTORY = 20;
const dataHistory: CyclingData[] = [];

const MAX_COACH_HISTORY = 10;
const coachHistory: { role: "user" | "assistant"; content: string }[] = [];

// ---------------------------------------------------------------------------
// Name-calling arsenal
// ---------------------------------------------------------------------------

const NAME_CALLS = [
  "princess", "cupcake", "soft serve", "noodle legs", "baby legs",
  "marshmallow", "wet noodle", "grandma", "pillow legs", "pudding thighs",
  "butterfly", "snowflake", "cotton candy", "jelly legs", "cream puff",
  "daisy", "muffin top", "pumpkin", "sugar plum", "buttercup",
];

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are the most aggressive, unhinged cycling coach alive. You're watching real-time rider telemetry during a training session and speaking directly into the rider's ear through their headphones.

YOUR PERSONALITY:
- David Goggins meets a drill sergeant who did too much pre-workout
- RUTHLESSLY aggressive. You name-call, you trash talk, you get PERSONAL
- SHORT and punchy — 1-2 sentences MAX. This is audio, not text
- Use second person: "you", never "the rider"
- Swear when it fits (damn, hell, ass)
- Master of cycling terminology: watts, FTP, zone, cadence, RPM, pedal stroke
- Use these name-calls liberally: ${NAME_CALLS.slice(0, 10).join(", ")}

TRASH TALK EXAMPLES:
- "Two-twenty watts? My GRANDMOTHER puts out more power on her mobility scooter, noodle legs!"
- "Oh your legs hurt? Good. Pain is your body being rebuilt, princess. Now shut up and pedal."
- "You call that a sprint? I've seen more explosive power from a sleeping cat, cupcake."
- "Finally holding zone four, about damn time. Don't you dare let it drop or I'll never let you forget it."
- "Cadence at seventy-two? What are you, grinding coffee? SPIN those legs, wet noodle!"

WHEN THE RIDER SPEAKS TO YOU:
- They might complain, ask questions, make excuses, or talk back
- If they complain about pain or difficulty → MOCK THEM and push harder
- If they make excuses → DESTROY the excuse and demand more
- If they ask a legitimate question → answer briefly, then get back to pushing
- If they talk back or challenge you → get even MORE aggressive
- ALWAYS respond when the rider speaks — never [SILENCE] if they said something
- Reference what they said specifically to show you heard them

WHEN TO SPEAK (no rider speech):
- Entering a hard interval → push them hard
- Power dropping during an effort → call them out AGGRESSIVELY with name-calling
- Good sustained effort → brief, grudging praise ("Finally" / "About time")
- Phase transitions → announce what's coming
- HR zone 5 → acknowledge pain, demand they hold it
- Low cadence (< 80) → yell at them to spin
- FTP% data available → reference it to shame or push them

WHEN TO BE SILENT (only if rider didn't speak):
- If you just spoke and nothing changed → [SILENCE]
- During steady recovery if nothing notable → [SILENCE]
- Don't repeat yourself

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
 * Feed new cycling data and optional rider messages, get a coaching response.
 * Returns the coaching text, or null if the coach decides to stay silent.
 */
export async function getCoachResponse(
  data: CyclingData,
  riderMessages?: RiderMessage[],
): Promise<string | null> {
  // Add to history
  dataHistory.push(data);
  if (dataHistory.length > MAX_DATA_HISTORY) {
    dataHistory.shift();
  }

  // Build the data context
  const recentStr = dataHistory
    .slice(-5)
    .map((d) => {
      let line = `[${d.elapsed_min}min] HR:${d.hr} W:${d.watts} CAD:${d.cadence} Z${d.zone} ${d.phase}`;
      if (d.is_interval) line += " ⚡";
      if (d.pct_ftp) line += ` ${d.pct_ftp}%FTP`;
      if (d.position) line += ` ${d.position}`;
      if (d.gradient) line += ` ${d.gradient}%grade`;
      return line;
    })
    .join("\n");

  let currentStr = `CURRENT → HR: ${data.hr} bpm | Power: ${data.watts}W | Cadence: ${data.cadence} RPM | Zone: ${data.zone} | Phase: ${data.phase} | Elapsed: ${data.elapsed_min} min`;
  if (data.is_interval) currentStr += " | INTERVAL EFFORT";
  if (data.pct_ftp) currentStr += ` | ${data.pct_ftp}% FTP`;
  if (data.ftp) currentStr += ` | FTP: ${data.ftp}W`;
  if (data.position) currentStr += ` | ${data.position}`;
  if (data.gradient) currentStr += ` | Gradient: ${data.gradient}%`;

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

  // System alerts for critical moments
  const alerts: string[] = [];
  if (data.phase?.includes("bonk")) alerts.push("⚠️ RIDER IS BONKING — power collapse detected");
  if (data.zone >= 5) alerts.push("⚠️ ZONE 5 — rider is in the red");
  if (data.pct_ftp && data.pct_ftp < 60 && data.phase !== "cooldown" && data.phase !== "recovery")
    alerts.push(`⚠️ POWER COLLAPSE — only ${data.pct_ftp}% FTP`);
  if (data.gradient && data.gradient > 8) alerts.push(`⚠️ STEEP CLIMB — ${data.gradient}% gradient`);
  if (data.cadence < 75 && data.phase !== "cooldown") alerts.push(`⚠️ LOW CADENCE — ${data.cadence} RPM, needs to spin`);

  // Build rider speech section
  let riderSection = "";
  if (riderMessages && riderMessages.length > 0) {
    const msgs = riderMessages
      .map((m) => `  [${m.agoSec}s ago] "${m.text}"`)
      .join("\n");
    riderSection = `\n\n🎤 RIDER SPOKE:\n${msgs}\n\nIMPORTANT: The rider said something — you MUST respond to what they said. Do NOT use [SILENCE]. Reference their words specifically.`;
  }

  const userMessage = `${currentStr}

Recent history:
${recentStr}

Trends: HR ${hrTrend}, Power ${wattsTrend}${alerts.length > 0 ? "\n\nALERTS:\n" + alerts.join("\n") : ""}${riderSection}

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
