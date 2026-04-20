import { HR_ZONES, POWER_ZONES } from "./constants";
import type { ZoneInfo } from "./types";

export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function getHRZone(hr: number): ZoneInfo {
  for (let i = HR_ZONES.length - 1; i >= 0; i--) {
    if (hr >= HR_ZONES[i].min) return HR_ZONES[i];
  }
  return HR_ZONES[0];
}

export function getPowerZone(watts: number): ZoneInfo {
  for (let i = POWER_ZONES.length - 1; i >= 0; i--) {
    if (watts >= POWER_ZONES[i].min) return POWER_ZONES[i];
  }
  return POWER_ZONES[0];
}

/** Lerp between two colors (hex strings) */
export function lerpColor(a: string, b: string, t: number): string {
  const ah = parseInt(a.replace("#", ""), 16);
  const bh = parseInt(b.replace("#", ""), 16);
  const ar = (ah >> 16) & 0xff, ag = (ah >> 8) & 0xff, ab = ah & 0xff;
  const br = (bh >> 16) & 0xff, bg = (bh >> 8) & 0xff, bb = bh & 0xff;
  const rr = Math.round(ar + (br - ar) * t);
  const rg = Math.round(ag + (bg - ag) * t);
  const rb = Math.round(ab + (bb - ab) * t);
  return `#${((rr << 16) | (rg << 8) | rb).toString(16).padStart(6, "0")}`;
}
