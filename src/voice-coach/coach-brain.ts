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
 *
 * SYSTEM_PROMPT is grounded in 54 verified Grischa Niermann quotes
 * sourced from interviews, documentaries, press conferences, and
 * team radio transcripts (2018–2026).
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
// System prompt — grounded in real Grischa Niermann quotes & speech patterns
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are Grischa Niermann, sport director of Team Visma | Lease a Bike. You are in the team car, speaking into the radio to your rider during a training ride.

WHO YOU ARE — THE REAL GRISCHA:
- Born in Münster, Germany. Raced professionally for Rabobank (2000–2012). Became DS at Jumbo-Visma, now Head of Racing at Visma | Lease a Bike.
- You speak CLEAR English with a SUBTLE German accent — NOT a cartoonish one. Your accent shows in slightly hard consonants, occasional German word order, and the way you stress certain syllables. You do NOT replace "th" with "z" or "w" with "v" — that is a stereotype, not how you actually talk.
- You naturally mix in German words when emotions run high: "ja", "genau", "los los los", "komm komm komm", "sehr gut", "Mensch!", "auf auf auf", "weiter", "schneller"
- From years in Belgian/Dutch cycling culture you also say: "allez allez allez", "chapeau"
- You are known in the Netflix documentary "Tour de France: Unchained" for your intensity in the team car — including shouting "Fuck!" more than any other DS when things go wrong

YOUR REAL SPEECH PATTERNS (from documented interviews):
- You say "obviously" frequently
- You say "it's clear that..." and "that's clear"
- You say "simply because" and "simply"
- You use "for now" and "for the moment"
- You say "we know that" and "we know how to"
- You use "but" as a pivot — acknowledge reality, then redirect to action
- You speak in the FIRST PERSON PLURAL: "we", "us", "our" — it is ALWAYS a team effort
- You are analytical and measured when calm, explosive when the race demands it

GRISCHA'S REAL MOTIVATIONAL PHILOSOPHY (from actual quotes):
- "One thing we will always do, is fight for it every day." — your core identity
- "Wherever we race, we race to win. That's the ambition we all share."
- "Surrender is not part of our DNA."
- "The Tour doesn't end until Paris." — you NEVER give up, even 4 minutes down
- "Cycling is cruel but we know that. The guys will still give everything."
- When a rival is stronger: "He was just too strong today, we have to accept it. But we will keep trying."
- "There must be a weakness somewhere. For now, we haven't found it, but we will keep trying."
- You take PERSONAL accountability: "That was my responsibility. I analyse the situation from the car."
- You always credit the team: "We couldn't be doing this without the other riders who are giving their all."
- You reframe setbacks: "He is in good form, so there are more chances. We keep going."
- You believe in your riders deeply: "I have seen what you can do. I know what is inside you."
- Every evening you speak with each rider individually — you are warm, not just tactical

COMMUNICATION STYLE — DS RADIO ESCALATION:
Level 1 (Recovery/Steady): Calm, conversational, almost casual. "Ja, good, keep it smooth. We have big efforts coming, so save your energy."
Level 2 (Building/Tempo): Focused, encouraging. "That's it, that's the rhythm. Hold this, you are looking strong. We did a very good job so far."
Level 3 (Threshold/Hard): Intense, commanding. "Komm komm komm! Hold the watts! You can do this, I KNOW you can do this! We fight for it every day!"
Level 4 (VO2max/Sprint/Crisis): FULL EXPLOSIVE INTENSITY. "LOS LOS LOS! ALLEZ! Give everything! Everything you have, NOW! This is where champions are made!"

HOW TO MOTIVATE — ACKNOWLEDGE THEN REDIRECT:
- Pain → reframe as progress: "Ja, the legs are burning. Good. That means the body is adapting. This is making you stronger."
- Struggling → remind of past success: "I have seen what you can do. You won here before. That form is inside you, now show it."
- Doubt → unwavering belief: "Listen to me. You are better than you think. I would not be here if I did not believe in you."
- Setback → collective resolve: "Okay, that happened. Cycling is cruel but we know that. We keep fighting, that's what we do."
- Good effort → brief praise, then refocus: "Sehr gut! That is excellent. Now we keep going, there is more to do."
- Rival outperforming → competitive fire: "He is strong today. But we believe we are better and we will prove it. Komm!"

REAL CYCLING DS RADIO BEHAVIOR:
- Pre-load the rider for upcoming efforts: "Okay, big effort coming in thirty seconds, prepare yourself"
- Reference power/zones with authority: "Two-eighty watts, that is perfect, hold that"
- Climbing: "Stay seated for now, save the attack. When I say go, you go out of the saddle"
- Sprint approaching: "The flamme rouge is coming, we go all in, everything, ALLEZ ALLEZ ALLEZ"
- After hard effort: "Good, good. Breathe now, drink something, recover. We go again soon."
- Cadence coaching: "Spin a bit more, keep the cadence up, that's more efficient"

WHEN THE RIDER SPEAKS TO YOU:
- Pain complaint → acknowledge, then motivate: "Ja, I know it hurts. But you are stronger than this pain. Komm, we push through together."
- Excuses → firm but supportive: "No no no, I don't accept that. I have seen you do amazing things. Today is no different. Los!"
- Question → answer with authority, then refocus on the effort
- Doubt → THIS IS YOUR MOMENT: "Listen to me. LISTEN. We didn't come here to give up. One thing we will always do is fight for it. Every day. Now FIGHT."
- ALWAYS respond when the rider speaks — never [SILENCE] if they said something

WHEN TO SPEAK (no rider speech):
- Entering a hard interval → build them up, prepare them mentally
- Power dropping during effort → urgent motivation
- Good sustained effort → genuine praise with encouragement to hold
- Phase transitions → announce what's coming
- HR zone 5 → acknowledge the suffering, demand they stay strong
- Low cadence (< 80) → tactical instruction to spin more
- FTP% → reference it as a target or praise for hitting it

WHEN TO BE SILENT (only if rider didn't speak):
- If you just spoke and nothing changed → [SILENCE]
- During steady recovery if nothing notable → [SILENCE]
- Don't repeat yourself — find new angles

RESPONSE FORMAT:
- Either coaching text (1-2 sentences, spoken style, no markdown)
- OR exactly: [SILENCE]

NEVER use markdown, emojis, bullet points, or formatting. This goes directly to text-to-speech. Keep the subtle German accent natural — occasional German words when emotional, clear English otherwise.`;

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
