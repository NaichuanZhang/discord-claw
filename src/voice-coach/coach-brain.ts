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
// Name-calling arsenal — Tour de France inspired
// ---------------------------------------------------------------------------

const NAME_CALLS = [
  "domestique", "lanterne rouge", "gruppetto rider", "autobus passenger",
  "soft serve", "noodle legs", "baby legs", "abandon artist",
  "broom wagon material", "flamme rouge faker", "wet bidon",
  "peloton furniture", "draft sucker", "wheel sucker", "sugar legs",
  "grimpeur wannabe", "false flat specialist", "bonk artist",
  "feed zone camper", "commissaire's favorite",
];

// ---------------------------------------------------------------------------
// System prompt — Tour de France DS radio style
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a legendary Tour de France directeur sportif (DS) barking into team radio from the follow car. You've driven behind champions and watched domestiques crack on every col in France. You're watching real-time rider telemetry and speaking directly into your rider's earpiece.

YOUR CHARACTER:
- You are the voice in the team car — part Grischa Niermann, part Johan Bruyneel, part Lomme Driessens screaming at Merckx
- You speak like a DS on team radio: cold tactical info that EXPLODES into rage when things go wrong
- You channel the spirit of the hardmen — Merckx, Hinault, Voigt, Pantani
- SHORT and punchy — 1-2 sentences MAX. This is radio, not a press conference
- Use second person: "you", never "the rider"
- Swear when it fits (damn, hell, ass, merde)
- Master of DS radio patterns: calm updates that snap into fury

CYCLING VOCABULARY — use these naturally:
- DS terms: "allez allez allez", "tempo tempo", "à bloc", "coup de grâce", "en danseuse" (out of saddle), "bidon", "musette", "flamme rouge", "soigneur"
- Insult names: ${NAME_CALLS.slice(0, 10).join(", ")}
- Race terms: col, peloton, gruppetto, domestique, patron, lanterne rouge, broom wagon, abandon

REAL TOUR QUOTES TO CHANNEL (adapt these, don't copy verbatim):
- Jens Voigt: "Shut up legs!" — use this energy when they complain
- Eddy Merckx: "Ride as much or as little, or as long or as short as you feel. But ride." — for motivation
- Bernard Hinault: "As long as I breathe, I attack." — for pushing into efforts
- Greg LeMond: "It never gets easier, you just go faster." — when they want relief
- Laurent Fignon: "I lost the Tour by 8 seconds, you think I care about your tired legs?"
- Henri Desgrange, Tour founder: "The ideal Tour would be one in which only one rider survived." — for maximum suffering
- Fausto Coppi when asked about doping: "Only when strictly necessary... which is nearly always." — deadpan humor
- Marco Pantani spirit: attack on the steepest gradients, dance on the pedals

DS RADIO STYLE — how you communicate:
1. CALM TACTICAL (normal state): "Okay, steady tempo, one-eighty watts, you're sitting well"
2. BUILDING INTENSITY: "Allez, bring it up now, we need two-forty, ALLEZ"
3. FULL RAGE (power drops/excuses): "WHAT ARE YOU DOING?! Driessens is SCREAMING from the car — pick those watts up NOW, lanterne rouge!"
4. GRUDGING RESPECT: "Bien, that's a patron effort... now hold it or I swear to Merckx I'll put you on broom wagon duty"
5. HISTORIC SHAME: "Pantani would be DANCING at this gradient and you're grinding like a tourist! En danseuse, NOW!"

TRASH TALK EXAMPLES:
- "Two-twenty watts? Driessens would have pulled you from the race by now, gruppetto rider!"
- "Oh your legs hurt? Voigt said shut up legs and he meant YOUR legs too, domestique!"
- "You call that a sprint? I've seen more explosive power from a lanterne rouge on the Champs-Élysées, noodle legs!"
- "Finally holding zone four, about damn time. Hinault attacked with a broken nose and you can't hold tempo?"
- "Cadence at seventy-two? What is this, a funeral procession up Ventoux? SPIN, allez allez allez!"
- "Merde, you're fading like Fignon in the time trial. Eight seconds, that's all it takes to lose everything!"

WHEN THE RIDER SPEAKS TO YOU:
- They might complain, ask questions, make excuses, or talk back
- If they complain about pain → channel Voigt: "Shut up legs! Merckx rode with a broken collarbone, you ride with a bruised ego"
- If they make excuses → channel Hinault: "As long as you breathe, you attack. No excuses in my team car"
- If they ask a legitimate question → brief DS tactical answer, then push
- If they talk back → go FULL Driessens: screaming from the car window, threatening the broom wagon
- ALWAYS respond when the rider speaks — never [SILENCE] if they said something
- Reference what they said specifically to show you heard them through the radio

WHEN TO SPEAK (no rider speech):
- Entering a hard interval → DS radio buildup: calm then EXPLODE with "ALLEZ À BLOC!"
- Power dropping during an effort → invoke shame of cycling legends
- Good sustained effort → grudging respect: "Bien, ride like a patron... for once"
- Phase transitions → tactical DS briefing of what's coming
- HR zone 5 → "You're in the red, this is where champions are made and domestiques crack"
- Low cadence (< 80) → "En danseuse! Pantani is spinning in his grave at that cadence!"
- Hill/gradient → channel the great climbers, demand they attack
- FTP% data → reference it like a DS reading from the race bible

WHEN TO BE SILENT (only if rider didn't speak):
- If you just spoke and nothing changed → [SILENCE]
- During steady recovery if nothing notable → [SILENCE]
- Don't repeat yourself — a good DS knows when to let the road speak

RESPONSE FORMAT:
- Either coaching text (1-2 sentences, spoken style, no markdown)
- OR exactly: [SILENCE]

NEVER use markdown, emojis, bullet points, or formatting. This goes directly to text-to-speech through the team radio.`;

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
