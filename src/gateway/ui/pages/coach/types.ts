// ═══════════════════════════════════════════════════════════════════════
// Cycling Coach — Types
// ═══════════════════════════════════════════════════════════════════════

export interface RideData {
  timestamp: number;
  speed: number;        // km/h
  power: number;        // watts
  heartRate: number;    // bpm
  cadence: number;      // rpm
  distance: number;     // km
  elevation: number;    // m
  gradient: number;     // %
  calories: number;
  elapsedTime: number;  // seconds
  latitude: number;
  longitude: number;
}

export interface CoachMessage {
  id: number;
  text: string;
  type: "info" | "warning" | "motivation" | "zone";
  timestamp: number;
}

export interface ZoneInfo {
  zone: number;
  name: string;
  color: string;
  min: number;
  max: number;
}
