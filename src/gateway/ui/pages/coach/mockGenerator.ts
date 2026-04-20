import type { RideData } from "./types";

// ═══════════════════════════════════════════════════════════════════════
// Realistic cycling physics simulation
// ═══════════════════════════════════════════════════════════════════════

export function createMockRideGenerator() {
  let elapsed = 0;
  let distance = 0;
  let calories = 0;
  let baseElevation = 150;
  let elevationPhase = Math.random() * Math.PI * 2;
  let basePower = 180;
  let baseHR = 135;
  let baseCadence = 85;
  let baseSpeed = 28;
  let angle = 0;
  const centerLat = 37.42;
  const centerLng = -122.08;

  // Interval training state
  let intervalMode: "steady" | "push" | "recover" = "steady";
  let intervalTimer = 60 + Math.random() * 120;

  return (): RideData => {
    elapsed += 1;
    elevationPhase += 0.02;

    // Interval training simulation
    intervalTimer -= 1;
    if (intervalTimer <= 0) {
      if (intervalMode === "steady" && Math.random() > 0.5) {
        intervalMode = "push";
        intervalTimer = 20 + Math.random() * 40;
        basePower = 240 + Math.random() * 60;
        baseSpeed = 32 + Math.random() * 8;
        baseCadence = 90 + Math.random() * 15;
      } else if (intervalMode === "push") {
        intervalMode = "recover";
        intervalTimer = 30 + Math.random() * 30;
        basePower = 120 + Math.random() * 40;
        baseSpeed = 22 + Math.random() * 6;
        baseCadence = 70 + Math.random() * 10;
      } else {
        intervalMode = "steady";
        intervalTimer = 60 + Math.random() * 120;
        basePower = 170 + Math.random() * 30;
        baseSpeed = 26 + Math.random() * 6;
        baseCadence = 82 + Math.random() * 8;
      }
    }

    // Terrain
    const gradient =
      Math.sin(elevationPhase) * 5 +
      Math.sin(elevationPhase * 0.3) * 3 +
      Math.sin(elevationPhase * 0.7) * 2;
    baseElevation += gradient * 0.1;

    // Power (gradient + interval + noise)
    const gradientPowerBoost = Math.max(0, gradient) * 18;
    const power = basePower + gradientPowerBoost + (Math.random() - 0.5) * 30;

    // Speed (inversely related to gradient)
    const speedGradientEffect = -gradient * 1.8;
    const speed = Math.max(5, baseSpeed + speedGradientEffect + (Math.random() - 0.5) * 3);

    // HR responds slowly (realistic lag)
    const targetHR = 100 + (power - 100) * 0.2;
    baseHR += (targetHR - baseHR) * 0.03;
    const heartRate = baseHR + (Math.random() - 0.5) * 4;

    // Cadence with terrain effect
    const cadence = baseCadence + (Math.random() - 0.5) * 8 - Math.max(0, gradient) * 2;

    distance += speed / 3600;
    calories += power * 0.001;

    // GPS loop
    angle += 0.001;
    const lat = centerLat + Math.sin(angle) * 0.02;
    const lng = centerLng + Math.cos(angle) * 0.03;

    return {
      timestamp: Date.now(),
      speed: Math.round(speed * 10) / 10,
      power: Math.round(Math.max(0, power)),
      heartRate: Math.round(Math.max(60, heartRate)),
      cadence: Math.round(Math.max(40, cadence)),
      distance: Math.round(distance * 100) / 100,
      elevation: Math.round(baseElevation * 10) / 10,
      gradient: Math.round(gradient * 10) / 10,
      calories: Math.round(calories),
      elapsedTime: elapsed,
      latitude: lat,
      longitude: lng,
    };
  };
}
