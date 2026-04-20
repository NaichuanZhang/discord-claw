import type { ZoneInfo } from "./types";

// ═══════════════════════════════════════════════════════════════════════
// Zone Definitions
// ═══════════════════════════════════════════════════════════════════════

export const HR_ZONES: ZoneInfo[] = [
  { zone: 1, name: "Recovery",  color: "#4a9eff", min: 0,   max: 120 },
  { zone: 2, name: "Endurance", color: "#2ecc71", min: 120, max: 140 },
  { zone: 3, name: "Tempo",     color: "#f1c40f", min: 140, max: 155 },
  { zone: 4, name: "Threshold", color: "#e67e22", min: 155, max: 170 },
  { zone: 5, name: "VO2 Max",   color: "#e74c3c", min: 170, max: 999 },
];

export const POWER_ZONES: ZoneInfo[] = [
  { zone: 1, name: "Active Recovery", color: "#4a9eff", min: 0,   max: 130 },
  { zone: 2, name: "Endurance",       color: "#2ecc71", min: 130, max: 180 },
  { zone: 3, name: "Tempo",           color: "#f1c40f", min: 180, max: 220 },
  { zone: 4, name: "Threshold",       color: "#e67e22", min: 220, max: 260 },
  { zone: 5, name: "VO2 Max",         color: "#e74c3c", min: 260, max: 300 },
  { zone: 6, name: "Anaerobic",       color: "#9b59b6", min: 300, max: 999 },
];

export const COACH_MESSAGES = [
  { text: "Great cadence! Keep that smooth pedal stroke.", type: "motivation" as const },
  { text: "Heart rate climbing — consider easing off a bit.", type: "warning" as const },
  { text: "You're in the sweet spot. Hold this power!", type: "motivation" as const },
  { text: "Climb ahead! Shift down and spin through it.", type: "info" as const },
  { text: "Power zone 4 — you're pushing hard! Great effort.", type: "zone" as const },
  { text: "Hydration reminder: take a sip!", type: "info" as const },
  { text: "Cadence dropping — try to keep above 80 RPM.", type: "warning" as const },
  { text: "Downhill section coming. Recover and breathe.", type: "info" as const },
  { text: "You're crushing it! Personal best pace!", type: "motivation" as const },
  { text: "Entering Zone 3 — sustainable tempo effort.", type: "zone" as const },
  { text: "30 seconds of high power — let's go!", type: "motivation" as const },
  { text: "Great recovery! Heart rate coming down nicely.", type: "info" as const },
  { text: "Drafting zone — save energy and stay aero!", type: "info" as const },
  { text: "Sprint in 10 seconds! Get ready to ATTACK!", type: "motivation" as const },
  { text: "Ease up — you're above threshold. Save it.", type: "warning" as const },
  { text: "Breathing rhythm: 3 pedals in, 2 out.", type: "info" as const },
  { text: "🔥 ON FIRE! You're averaging 20W above FTP!", type: "motivation" as const },
];
