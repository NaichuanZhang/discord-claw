/**
 * Mock cycling data generator.
 *
 * Simulates a realistic cycling ride with phases:
 *   warmup → tempo → intervals → recovery → sprint → cooldown
 *
 * Provides a simple function to get current cycling data (no HTTP server needed).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CyclingData {
  /** Heart rate in BPM */
  hr: number;
  /** Power output in watts */
  watts: number;
  /** Cadence in RPM */
  cadence: number;
  /** HR zone (1-5) */
  zone: number;
  /** Elapsed minutes since ride start */
  elapsed_min: number;
  /** Current ride phase name */
  phase: string;
  /** Whether this is an interval effort */
  is_interval: boolean;
}

// ---------------------------------------------------------------------------
// Ride simulation
// ---------------------------------------------------------------------------

type Phase = "warmup" | "tempo" | "interval_on" | "interval_off" | "threshold" | "sprint" | "cooldown";

interface PhaseConfig {
  name: string;
  duration_min: number;
  hr_target: [number, number];     // [min, max]
  watts_target: [number, number];
  cadence_target: [number, number];
  is_interval: boolean;
}

const PHASES: { phase: Phase; config: PhaseConfig }[] = [
  {
    phase: "warmup",
    config: { name: "Warmup", duration_min: 3, hr_target: [110, 130], watts_target: [120, 160], cadence_target: [80, 90], is_interval: false },
  },
  {
    phase: "tempo",
    config: { name: "Tempo", duration_min: 4, hr_target: [140, 155], watts_target: [180, 220], cadence_target: [85, 95], is_interval: false },
  },
  // Interval block: 4x (30s on / 30s off) = 4 min
  {
    phase: "interval_on",
    config: { name: "Interval ON", duration_min: 0.5, hr_target: [165, 180], watts_target: [300, 380], cadence_target: [95, 110], is_interval: true },
  },
  {
    phase: "interval_off",
    config: { name: "Interval REST", duration_min: 0.5, hr_target: [145, 160], watts_target: [130, 160], cadence_target: [75, 85], is_interval: false },
  },
  {
    phase: "interval_on",
    config: { name: "Interval ON", duration_min: 0.5, hr_target: [170, 185], watts_target: [310, 400], cadence_target: [95, 110], is_interval: true },
  },
  {
    phase: "interval_off",
    config: { name: "Interval REST", duration_min: 0.5, hr_target: [150, 165], watts_target: [130, 160], cadence_target: [75, 85], is_interval: false },
  },
  {
    phase: "interval_on",
    config: { name: "Interval ON", duration_min: 0.5, hr_target: [175, 190], watts_target: [320, 420], cadence_target: [95, 110], is_interval: true },
  },
  {
    phase: "interval_off",
    config: { name: "Interval REST", duration_min: 0.5, hr_target: [155, 170], watts_target: [130, 160], cadence_target: [75, 85], is_interval: false },
  },
  {
    phase: "interval_on",
    config: { name: "Interval ON", duration_min: 0.5, hr_target: [178, 195], watts_target: [330, 440], cadence_target: [95, 110], is_interval: true },
  },
  {
    phase: "interval_off",
    config: { name: "Interval REST", duration_min: 0.5, hr_target: [155, 170], watts_target: [130, 160], cadence_target: [75, 85], is_interval: false },
  },
  {
    phase: "threshold",
    config: { name: "Threshold", duration_min: 5, hr_target: [160, 175], watts_target: [240, 290], cadence_target: [88, 98], is_interval: false },
  },
  {
    phase: "sprint",
    config: { name: "Sprint", duration_min: 1, hr_target: [180, 200], watts_target: [450, 600], cadence_target: [100, 120], is_interval: true },
  },
  {
    phase: "cooldown",
    config: { name: "Cooldown", duration_min: 5, hr_target: [100, 125], watts_target: [80, 120], cadence_target: [70, 82], is_interval: false },
  },
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let rideStartTime: number | null = null;
let lastHr = 120;
let lastWatts = 140;
let lastCadence = 85;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Smoothly move a value toward a target with some noise */
function smoothMove(current: number, targetMin: number, targetMax: number, smoothing: number = 0.15): number {
  const target = rand(targetMin, targetMax);
  const noise = (Math.random() - 0.5) * 6;
  return current + (target - current) * smoothing + noise;
}

function getHrZone(hr: number): number {
  if (hr < 120) return 1;
  if (hr < 140) return 2;
  if (hr < 160) return 3;
  if (hr < 180) return 4;
  return 5;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start (or restart) the mock ride. Resets the clock to 0.
 */
export function startRide(): void {
  rideStartTime = Date.now();
  lastHr = 110;
  lastWatts = 130;
  lastCadence = 82;
  console.log("[mock-cycling] Ride started");
}

/**
 * Stop the mock ride.
 */
export function stopRide(): void {
  rideStartTime = null;
  console.log("[mock-cycling] Ride stopped");
}

/**
 * Get current cycling telemetry. Returns null if ride not started.
 */
export function getCyclingData(): CyclingData | null {
  if (!rideStartTime) return null;

  const elapsedMs = Date.now() - rideStartTime;
  const elapsedMin = elapsedMs / 60_000;

  // Find current phase
  let accumulatedMin = 0;
  let currentPhase = PHASES[PHASES.length - 1]; // Default to last phase

  for (const p of PHASES) {
    if (elapsedMin < accumulatedMin + p.config.duration_min) {
      currentPhase = p;
      break;
    }
    accumulatedMin += p.config.duration_min;
  }

  // If we've exceeded all phases, loop back or stay in cooldown
  const config = currentPhase.config;

  // Smoothly adjust values toward current phase targets
  lastHr = Math.round(smoothMove(lastHr, config.hr_target[0], config.hr_target[1], 0.12));
  lastWatts = Math.round(smoothMove(lastWatts, config.watts_target[0], config.watts_target[1], 0.2));
  lastCadence = Math.round(smoothMove(lastCadence, config.cadence_target[0], config.cadence_target[1], 0.15));

  // Clamp values
  lastHr = Math.max(80, Math.min(210, lastHr));
  lastWatts = Math.max(0, Math.min(700, lastWatts));
  lastCadence = Math.max(0, Math.min(140, lastCadence));

  return {
    hr: lastHr,
    watts: lastWatts,
    cadence: lastCadence,
    zone: getHrZone(lastHr),
    elapsed_min: Math.round(elapsedMin * 10) / 10,
    phase: config.name,
    is_interval: config.is_interval,
  };
}
