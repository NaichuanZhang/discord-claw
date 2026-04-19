/**
 * Mock cycling data generator.
 *
 * Simulates a realistic cycling ride with 33 phases including:
 *   warmup → tempo → over-unders → micro bursts → hill climb →
 *   bonking → second wind → long intervals → VO2max → attack →
 *   sprint finish → cooldown
 *
 * Features:
 * - Random power surges and drops (8% / 6% chance each poll)
 * - Fatigue drift (HR creeps up, power creeps down over time)
 * - Standing/seated position simulation
 * - Gradient simulation for hill phases
 * - FTP-relative power tracking
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
  /** Rider's FTP in watts */
  ftp: number;
  /** Current power as % of FTP */
  pct_ftp: number;
  /** Rider position */
  position: "seated" | "standing";
  /** Road gradient in % (0 for flat) */
  gradient: number;
}

// ---------------------------------------------------------------------------
// Ride simulation
// ---------------------------------------------------------------------------

interface PhaseConfig {
  name: string;
  duration_min: number;
  hr_target: [number, number];
  watts_target: [number, number];
  cadence_target: [number, number];
  is_interval: boolean;
  /** Probability of standing (0-1) */
  standing_prob: number;
  /** Road gradient in % */
  gradient: number;
}

const RIDER_FTP = 260; // Watts

const PHASES: PhaseConfig[] = [
  // === WARMUP (0-3 min) ===
  { name: "Easy Spin Warmup", duration_min: 1.5, hr_target: [105, 120], watts_target: [100, 130], cadence_target: [80, 90], is_interval: false, standing_prob: 0, gradient: 0 },
  { name: "Warmup Ramp", duration_min: 1.5, hr_target: [120, 138], watts_target: [140, 180], cadence_target: [85, 95], is_interval: false, standing_prob: 0.05, gradient: 0 },

  // === TEMPO BUILD (3-7 min) ===
  { name: "Tempo", duration_min: 2, hr_target: [140, 155], watts_target: [185, 220], cadence_target: [88, 95], is_interval: false, standing_prob: 0.05, gradient: 1 },
  { name: "Tempo Push", duration_min: 2, hr_target: [150, 162], watts_target: [210, 245], cadence_target: [88, 96], is_interval: false, standing_prob: 0.1, gradient: 2 },

  // === OVER-UNDERS (7-11 min) ===
  { name: "Over-Under: OVER", duration_min: 0.75, hr_target: [165, 178], watts_target: [270, 300], cadence_target: [92, 100], is_interval: true, standing_prob: 0.15, gradient: 0 },
  { name: "Over-Under: under", duration_min: 0.5, hr_target: [155, 168], watts_target: [220, 245], cadence_target: [85, 92], is_interval: false, standing_prob: 0, gradient: 0 },
  { name: "Over-Under: OVER", duration_min: 0.75, hr_target: [168, 182], watts_target: [275, 310], cadence_target: [92, 102], is_interval: true, standing_prob: 0.2, gradient: 0 },
  { name: "Over-Under: under", duration_min: 0.5, hr_target: [158, 170], watts_target: [215, 240], cadence_target: [84, 91], is_interval: false, standing_prob: 0, gradient: 0 },
  { name: "Over-Under: OVER", duration_min: 0.75, hr_target: [172, 186], watts_target: [280, 320], cadence_target: [93, 104], is_interval: true, standing_prob: 0.25, gradient: 0 },

  // === RECOVERY (11-12.5 min) ===
  { name: "Recovery Spin", duration_min: 1.5, hr_target: [130, 148], watts_target: [110, 145], cadence_target: [78, 88], is_interval: false, standing_prob: 0, gradient: 0 },

  // === MICRO BURSTS (12.5-15.5 min) — 10s on / 20s off x6 ===
  { name: "Micro Burst ON", duration_min: 0.17, hr_target: [170, 185], watts_target: [380, 480], cadence_target: [105, 120], is_interval: true, standing_prob: 0.8, gradient: 0 },
  { name: "Micro Burst off", duration_min: 0.33, hr_target: [155, 170], watts_target: [120, 150], cadence_target: [75, 85], is_interval: false, standing_prob: 0, gradient: 0 },
  { name: "Micro Burst ON", duration_min: 0.17, hr_target: [172, 188], watts_target: [390, 500], cadence_target: [105, 122], is_interval: true, standing_prob: 0.85, gradient: 0 },
  { name: "Micro Burst off", duration_min: 0.33, hr_target: [158, 172], watts_target: [115, 145], cadence_target: [74, 84], is_interval: false, standing_prob: 0, gradient: 0 },
  { name: "Micro Burst ON", duration_min: 0.17, hr_target: [175, 192], watts_target: [400, 520], cadence_target: [108, 125], is_interval: true, standing_prob: 0.9, gradient: 0 },
  { name: "Micro Burst off", duration_min: 0.33, hr_target: [160, 175], watts_target: [110, 140], cadence_target: [73, 83], is_interval: false, standing_prob: 0, gradient: 0 },

  // === HILL CLIMB (15.5-20 min) ===
  { name: "Hill Climb - Base", duration_min: 1.5, hr_target: [155, 168], watts_target: [235, 270], cadence_target: [70, 80], is_interval: false, standing_prob: 0.15, gradient: 6 },
  { name: "Hill Climb - Steep", duration_min: 1.5, hr_target: [168, 182], watts_target: [265, 310], cadence_target: [65, 76], is_interval: true, standing_prob: 0.5, gradient: 10 },
  { name: "Hill Climb - Summit Push", duration_min: 1.5, hr_target: [178, 195], watts_target: [290, 350], cadence_target: [60, 72], is_interval: true, standing_prob: 0.7, gradient: 12 },

  // === THE BONK (20-22 min) — simulates hitting the wall ===
  { name: "Bonking - Power Fade", duration_min: 1, hr_target: [170, 185], watts_target: [160, 200], cadence_target: [65, 75], is_interval: false, standing_prob: 0, gradient: 3 },
  { name: "Bonking - Survival Mode", duration_min: 1, hr_target: [165, 180], watts_target: [120, 165], cadence_target: [60, 72], is_interval: false, standing_prob: 0, gradient: 1 },

  // === SECOND WIND (22-24 min) ===
  { name: "Second Wind", duration_min: 2, hr_target: [155, 168], watts_target: [200, 245], cadence_target: [82, 92], is_interval: false, standing_prob: 0.1, gradient: 0 },

  // === LONG INTERVALS (24-30 min) — 2min on / 1min off x2 ===
  { name: "Long Interval ON", duration_min: 2, hr_target: [170, 185], watts_target: [275, 315], cadence_target: [90, 100], is_interval: true, standing_prob: 0.2, gradient: 0 },
  { name: "Long Interval REST", duration_min: 1, hr_target: [150, 165], watts_target: [130, 160], cadence_target: [78, 88], is_interval: false, standing_prob: 0, gradient: 0 },
  { name: "Long Interval ON", duration_min: 2, hr_target: [175, 190], watts_target: [280, 325], cadence_target: [91, 102], is_interval: true, standing_prob: 0.25, gradient: 0 },
  { name: "Long Interval REST", duration_min: 1, hr_target: [152, 168], watts_target: [125, 155], cadence_target: [77, 86], is_interval: false, standing_prob: 0, gradient: 0 },

  // === VO2MAX EFFORTS (30-33 min) ===
  { name: "VO2max Effort", duration_min: 1, hr_target: [182, 198], watts_target: [320, 380], cadence_target: [95, 108], is_interval: true, standing_prob: 0.3, gradient: 0 },
  { name: "VO2max Recovery", duration_min: 0.5, hr_target: [165, 180], watts_target: [120, 150], cadence_target: [75, 85], is_interval: false, standing_prob: 0, gradient: 0 },
  { name: "VO2max Effort 2", duration_min: 1, hr_target: [185, 202], watts_target: [330, 400], cadence_target: [96, 110], is_interval: true, standing_prob: 0.4, gradient: 0 },
  { name: "VO2max Recovery", duration_min: 0.5, hr_target: [168, 182], watts_target: [115, 145], cadence_target: [74, 84], is_interval: false, standing_prob: 0, gradient: 0 },

  // === ATTACK + SPRINT FINISH (33-35 min) ===
  { name: "Race Attack", duration_min: 1, hr_target: [185, 200], watts_target: [350, 450], cadence_target: [98, 115], is_interval: true, standing_prob: 0.6, gradient: 2 },
  { name: "SPRINT FINISH", duration_min: 0.5, hr_target: [195, 210], watts_target: [500, 700], cadence_target: [110, 130], is_interval: true, standing_prob: 1.0, gradient: 0 },

  // === COOLDOWN (35-40 min) ===
  { name: "Cooldown", duration_min: 3, hr_target: [110, 135], watts_target: [80, 120], cadence_target: [70, 82], is_interval: false, standing_prob: 0, gradient: 0 },
  { name: "Easy Spin Out", duration_min: 2, hr_target: [95, 115], watts_target: [60, 90], cadence_target: [65, 78], is_interval: false, standing_prob: 0, gradient: 0 },
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
  console.log("[mock-cycling] Ride started — 33 phases, ~40min simulated ride");
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
    if (elapsedMin < accumulatedMin + p.duration_min) {
      currentPhase = p;
      break;
    }
    accumulatedMin += p.duration_min;
  }

  const config = currentPhase;

  // Fatigue drift: HR creeps up 0.5bpm/min, power drops 0.3W/min after 10min
  const fatigueFactor = Math.max(0, elapsedMin - 10);
  const hrFatigueDrift = fatigueFactor * 0.5;
  const wattsFatigueDrift = fatigueFactor * -0.3;

  // Smoothly adjust values toward current phase targets
  lastHr = Math.round(
    smoothMove(lastHr, config.hr_target[0] + hrFatigueDrift, config.hr_target[1] + hrFatigueDrift, 0.12)
  );
  lastWatts = Math.round(
    smoothMove(lastWatts, config.watts_target[0] + wattsFatigueDrift, config.watts_target[1] + wattsFatigueDrift, 0.2)
  );
  lastCadence = Math.round(smoothMove(lastCadence, config.cadence_target[0], config.cadence_target[1], 0.15));

  // Random events: power surge (8% chance)
  if (Math.random() < 0.08 && config.is_interval) {
    lastWatts += Math.round(rand(30, 80));
    console.log(`[mock-cycling] ⚡ Random power surge! +${lastWatts}W`);
  }

  // Random events: power drop (6% chance)
  if (Math.random() < 0.06) {
    lastWatts -= Math.round(rand(20, 50));
    console.log(`[mock-cycling] 📉 Random power drop! ${lastWatts}W`);
  }

  // Cadence wobble (5% chance)
  if (Math.random() < 0.05) {
    lastCadence += Math.round((Math.random() - 0.5) * 20);
  }

  // Clamp values
  lastHr = Math.max(80, Math.min(210, lastHr));
  lastWatts = Math.max(0, Math.min(800, lastWatts));
  lastCadence = Math.max(0, Math.min(140, lastCadence));

  // Position: standing vs seated
  const position: "seated" | "standing" = Math.random() < config.standing_prob ? "standing" : "seated";

  // FTP-relative power
  const pctFtp = Math.round((lastWatts / RIDER_FTP) * 100);

  return {
    hr: lastHr,
    watts: lastWatts,
    cadence: lastCadence,
    zone: getHrZone(lastHr),
    elapsed_min: Math.round(elapsedMin * 10) / 10,
    phase: config.name,
    is_interval: config.is_interval,
    ftp: RIDER_FTP,
    pct_ftp: pctFtp,
    position,
    gradient: config.gradient,
  };
}
