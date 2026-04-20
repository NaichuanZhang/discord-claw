import React, { useRef, useEffect, useCallback } from "react";

/**
 * Cycling Coach — Pure Canvas 2D Scene (Golden Hour / Sunset Theme)
 * 
 * Vibrant parallax cycling visualization:
 * - Multi-layer scrolling background (golden sky, purple mountains, green hills, road)
 * - Detailed animated cyclist with pedaling animation
 * - Particle effects (dust, light motes)
 * - Speed lines at high speeds
 * - Dynamic sky color cycling (golden hour → dusk → night → dawn)
 * - Road with perspective markings
 * - Gradient-reactive road tilt
 * - Cloud layers
 * - Smooth 60fps animation loop
 */

interface Scene3DProps {
  speed: number;
  cadence: number;
  gradient: number;
  elevation: number;
  power: number;
  elapsedTime: number;
}

// ─── Color Palette (vibrant golden hour) ─────────────────────────────
const SKY_PHASES = {
  top:    ["#1a1040", "#2a1850", "#443070", "#5a3870", "#ff6040", "#ff8844", "#4488cc", "#3366aa", "#2a2060", "#1a1040"],
  bottom: ["#302050", "#503060", "#885050", "#cc6644", "#ffaa55", "#ffcc66", "#88ccaa", "#66aa88", "#443060", "#302050"],
};

const COLORS = {
  mountain1: "#1a1030",
  mountain1Light: "#2a2050",
  mountain2: "#2a1840",
  mountain2Light: "#3a2860",
  hill1: "#1a4828",
  hill1Light: "#2a6838",
  hill2: "#286030",
  hill2Light: "#389840",
  ground: "#2a5a2a",
  road: "#3a3a44",
  roadEdge: "#5a5a60",
  roadLine: "#ffcc44",
  tree: {
    trunk: "#4a3018",
    trunkLight: "#5a4020",
    pine: "#1a5828",
    pineLight: "#2a7838",
    pineDark: "#0e4018",
    oak: "#2a6030",
    oakLight: "#3a8040",
  },
  cyclist: {
    frame: "#e63946",
    frameAccent: "#c1121f",
    jersey: "#457b9d",
    jerseyLight: "#5a9abd",
    skin: "#f5d0a0",
    helmet: "#e63946",
    shoes: "#1d3557",
    pants: "#1d3557",
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(a: string, b: string, t: number): string {
  const ah = parseInt(a.slice(1), 16);
  const bh = parseInt(b.slice(1), 16);
  const r = Math.round(lerp((ah >> 16) & 0xff, (bh >> 16) & 0xff, t));
  const g = Math.round(lerp((ah >> 8) & 0xff, (bh >> 8) & 0xff, t));
  const bv = Math.round(lerp(ah & 0xff, bh & 0xff, t));
  return `#${((r << 16) | (g << 8) | bv).toString(16).padStart(6, "0")}`;
}

function hash(x: number): number {
  const s = Math.sin(x * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function smoothNoise(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const t = f * f * (3 - 2 * f);
  return lerp(hash(i), hash(i + 1), t);
}

function fbm(x: number, octaves: number = 4): number {
  let val = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    val += amp * smoothNoise(x * freq);
    amp *= 0.5;
    freq *= 2;
  }
  return val;
}

// ─── Particle ────────────────────────────────────────────────────────
interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  size: number; alpha: number;
}

interface SpeedLine {
  x: number; y: number; len: number; speed: number; alpha: number;
}

interface Cloud {
  x: number; y: number; width: number; height: number; speed: number; alpha: number;
}

function createDustParticle(W: number, H: number, speed: number): Particle {
  return {
    x: W + Math.random() * 50,
    y: H * 0.65 + (Math.random() - 0.5) * H * 0.2,
    vx: -(2 + speed * 0.08 + Math.random() * 2),
    vy: (Math.random() - 0.5) * 0.5 - 0.3,
    life: 0, maxLife: 40 + Math.random() * 40,
    size: 1 + Math.random() * 2.5,
    alpha: 0.2 + Math.random() * 0.3,
  };
}

function createMote(W: number, H: number): Particle {
  return {
    x: Math.random() * W,
    y: H * 0.2 + Math.random() * H * 0.45,
    vx: (Math.random() - 0.5) * 0.3,
    vy: (Math.random() - 0.5) * 0.2,
    life: 0, maxLife: 200 + Math.random() * 200,
    size: 1 + Math.random() * 2.5,
    alpha: 0,
  };
}

// ─── Drawing Functions ───────────────────────────────────────────────

function drawMountainRange(
  ctx: CanvasRenderingContext2D,
  W: number, H: number,
  baseY: number, amplitude: number,
  colorDark: string, colorLight: string,
  seed: number, scroll: number, scrollSpeed: number,
) {
  const scrollX = scroll * scrollSpeed;
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 2) {
    const nx = (x + scrollX) * 0.002;
    const y = baseY - amplitude * fbm(nx + seed, 5) - amplitude * 0.3 * Math.sin(nx * 0.5 + seed);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W, H);
  ctx.closePath();

  // Gradient fill for depth
  const grad = ctx.createLinearGradient(0, baseY - amplitude, 0, baseY + amplitude);
  grad.addColorStop(0, colorLight);
  grad.addColorStop(1, colorDark);
  ctx.fillStyle = grad;
  ctx.fill();
}

function drawCloud(ctx: CanvasRenderingContext2D, cloud: Cloud) {
  ctx.save();
  ctx.globalAlpha = cloud.alpha;
  ctx.fillStyle = "rgba(255, 240, 220, 0.3)";

  // Draw cloud as overlapping ellipses
  const cx = cloud.x, cy = cloud.y;
  const w = cloud.width, h = cloud.height;

  ctx.beginPath();
  ctx.ellipse(cx, cy, w * 0.5, h * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx - w * 0.25, cy + h * 0.1, w * 0.35, h * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + w * 0.3, cy + h * 0.05, w * 0.3, h * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + w * 0.1, cy - h * 0.15, w * 0.25, h * 0.25, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawPineTree(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, scale: number, windPhase: number, shadow: boolean,
) {
  const sway = Math.sin(windPhase) * 2 * scale;
  const trunkH = 22 * scale;
  const trunkW = 3.5 * scale;

  // Shadow
  if (shadow) {
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.beginPath();
    ctx.ellipse(x + 8 * scale, y + 2, 10 * scale, 3 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Trunk
  ctx.fillStyle = COLORS.tree.trunk;
  ctx.fillRect(x - trunkW / 2, y - trunkH, trunkW, trunkH);

  // Canopy layers
  for (let i = 0; i < 3; i++) {
    const layerY = y - trunkH - i * 13 * scale;
    const layerW = (20 - i * 5) * scale;
    const layerH = 18 * scale;
    const offset = sway * (i + 1) * 0.3;

    ctx.beginPath();
    ctx.moveTo(x + offset, layerY - layerH);
    ctx.lineTo(x - layerW + offset * 0.5, layerY);
    ctx.lineTo(x + layerW + offset * 0.5, layerY);
    ctx.closePath();
    ctx.fillStyle = i === 0 ? COLORS.tree.pineDark : i === 1 ? COLORS.tree.pine : COLORS.tree.pineLight;
    ctx.fill();

    // Snow/light on tips
    if (i === 2) {
      ctx.fillStyle = "rgba(255,255,200,0.15)";
      ctx.beginPath();
      ctx.moveTo(x + offset, layerY - layerH);
      ctx.lineTo(x - layerW * 0.3 + offset, layerY - layerH * 0.4);
      ctx.lineTo(x + layerW * 0.3 + offset, layerY - layerH * 0.4);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function drawOakTree(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, scale: number, windPhase: number, shadow: boolean,
) {
  const sway = Math.sin(windPhase) * 1.5 * scale;
  const trunkH = 20 * scale;
  const trunkW = 4.5 * scale;

  // Shadow
  if (shadow) {
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.beginPath();
    ctx.ellipse(x + 10 * scale, y + 2, 14 * scale, 3.5 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Trunk
  ctx.fillStyle = COLORS.tree.trunkLight;
  ctx.fillRect(x - trunkW / 2, y - trunkH, trunkW, trunkH);

  // Crown
  const crownY = y - trunkH - 10 * scale;
  const crownR = 16 * scale;
  ctx.fillStyle = COLORS.tree.oak;
  ctx.beginPath(); ctx.arc(x + sway, crownY, crownR, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = COLORS.tree.oakLight;
  ctx.beginPath(); ctx.arc(x + sway - 7 * scale, crownY + 4 * scale, crownR * 0.75, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + sway + 8 * scale, crownY + 3 * scale, crownR * 0.7, 0, Math.PI * 2); ctx.fill();

  // Highlight
  ctx.fillStyle = "rgba(255,255,200,0.08)";
  ctx.beginPath(); ctx.arc(x + sway + 3 * scale, crownY - 5 * scale, crownR * 0.5, 0, Math.PI * 2); ctx.fill();
}

function drawCyclist(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  crankAngle: number, gradient: number, _speed: number,
  bobPhase: number,
) {
  ctx.save();
  const bob = Math.sin(bobPhase * 2) * 2;
  const lean = gradient * 0.008;
  ctx.translate(cx, cy + bob);
  ctx.rotate(lean);

  const S = 2.0;
  const C = COLORS.cyclist;

  // Wheel positions
  const rearWX = -30 * S, rearWY = 12 * S;
  const frontWX = 30 * S, frontWY = 12 * S;
  const wheelR = 15 * S;
  const bbX = 0, bbY = 7 * S;

  const wheelSpin = crankAngle * 2.5;

  const drawWheel = (wx: number, wy: number) => {
    // Tire shadow
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.beginPath();
    ctx.ellipse(wx + 2, wy + wheelR + 3, wheelR * 0.7, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Tire
    ctx.beginPath();
    ctx.arc(wx, wy, wheelR, 0, Math.PI * 2);
    ctx.strokeStyle = "#2a2a2a";
    ctx.lineWidth = 4 * S;
    ctx.stroke();

    // Rim
    ctx.beginPath();
    ctx.arc(wx, wy, wheelR - 2 * S, 0, Math.PI * 2);
    ctx.strokeStyle = "#888";
    ctx.lineWidth = 1.2 * S;
    ctx.stroke();

    // Spokes
    ctx.strokeStyle = "rgba(200,200,200,0.5)";
    ctx.lineWidth = 0.6;
    for (let i = 0; i < 16; i++) {
      const a = wheelSpin + (i / 16) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(wx, wy);
      ctx.lineTo(wx + Math.cos(a) * (wheelR - 3 * S), wy + Math.sin(a) * (wheelR - 3 * S));
      ctx.stroke();
    }

    // Hub
    ctx.beginPath();
    ctx.arc(wx, wy, 3 * S, 0, Math.PI * 2);
    ctx.fillStyle = "#aaa";
    ctx.fill();
    ctx.strokeStyle = "#666";
    ctx.lineWidth = 0.5;
    ctx.stroke();
  };

  drawWheel(rearWX, rearWY);
  drawWheel(frontWX, frontWY);

  // Frame
  const seatTX = -8 * S, seatTY = -20 * S;
  const headTX = 24 * S, headTY = -16 * S;

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Main frame tubes
  ctx.strokeStyle = C.frame;
  ctx.lineWidth = 3 * S;
  // Down tube
  ctx.beginPath(); ctx.moveTo(headTX, headTY); ctx.lineTo(bbX, bbY); ctx.stroke();
  // Top tube
  ctx.beginPath(); ctx.moveTo(seatTX, seatTY); ctx.lineTo(headTX, headTY); ctx.stroke();
  // Seat tube
  ctx.beginPath(); ctx.moveTo(bbX, bbY); ctx.lineTo(seatTX, seatTY); ctx.stroke();

  // Stays
  ctx.strokeStyle = C.frameAccent;
  ctx.lineWidth = 2 * S;
  ctx.beginPath(); ctx.moveTo(bbX, bbY); ctx.lineTo(rearWX, rearWY); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(seatTX, seatTY); ctx.lineTo(rearWX, rearWY); ctx.stroke();

  // Fork
  ctx.strokeStyle = "#888";
  ctx.lineWidth = 2.5 * S;
  ctx.beginPath(); ctx.moveTo(headTX, headTY); ctx.lineTo(frontWX, frontWY); ctx.stroke();

  // Cranks & Pedals
  const crankLen = 9 * S;
  for (let side = 0; side < 2; side++) {
    const a = crankAngle + side * Math.PI;
    const px = bbX + Math.cos(a) * crankLen;
    const py = bbY + Math.sin(a) * crankLen;

    ctx.strokeStyle = "#aaa";
    ctx.lineWidth = 2.5 * S;
    ctx.beginPath(); ctx.moveTo(bbX, bbY); ctx.lineTo(px, py); ctx.stroke();

    ctx.fillStyle = "#666";
    ctx.fillRect(px - 5 * S / 2, py - 1.5 * S / 2, 5 * S, 1.5 * S);
  }

  // Handlebar
  const hbY = headTY - 3 * S;
  ctx.strokeStyle = "#555";
  ctx.lineWidth = 2.5 * S;
  ctx.beginPath();
  ctx.moveTo(headTX - 3 * S, hbY);
  ctx.quadraticCurveTo(headTX + 7 * S, hbY - 6 * S, headTX + 5 * S, hbY + 4 * S);
  ctx.stroke();
  // Bar tape
  ctx.fillStyle = C.frame;
  ctx.beginPath(); ctx.arc(headTX + 5 * S, hbY + 4 * S, 2 * S, 0, Math.PI * 2); ctx.fill();

  // Saddle
  ctx.fillStyle = "#333";
  ctx.beginPath();
  ctx.ellipse(seatTX, seatTY - 4 * S, 9 * S, 2.5 * S, 0.05, 0, Math.PI * 2);
  ctx.fill();

  // ── Rider body ──

  // Legs
  for (let side = 0; side < 2; side++) {
    const a = crankAngle + side * Math.PI;
    const footX = bbX + Math.cos(a) * crankLen;
    const footY = bbY + Math.sin(a) * crankLen;
    const hipX = seatTX + 3 * S;
    const hipY = seatTY + 10 * S;

    const kneeX = (hipX + footX) / 2 + 5 * S;
    const kneeY = (hipY + footY) / 2 + 4 * S;

    // Upper leg
    ctx.strokeStyle = C.pants;
    ctx.lineWidth = 6 * S;
    ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(kneeX, kneeY); ctx.stroke();
    // Lower leg
    ctx.lineWidth = 5 * S;
    ctx.beginPath(); ctx.moveTo(kneeX, kneeY); ctx.lineTo(footX, footY); ctx.stroke();
    // Shoe
    ctx.fillStyle = C.shoes;
    ctx.beginPath();
    ctx.ellipse(footX + 3 * S, footY, 5 * S, 2.5 * S, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Torso
  const torsoSX = seatTX + 3 * S, torsoSY = seatTY + 3 * S;
  const torsoEX = headTX - 3 * S, torsoEY = headTY - 10 * S;
  ctx.strokeStyle = C.jersey;
  ctx.lineWidth = 9 * S;
  ctx.beginPath();
  ctx.moveTo(torsoSX, torsoSY);
  ctx.quadraticCurveTo(
    (torsoSX + torsoEX) / 2, (torsoSY + torsoEY) / 2 - 5 * S,
    torsoEX, torsoEY,
  );
  ctx.stroke();

  // Jersey stripe accent
  ctx.strokeStyle = C.jerseyLight;
  ctx.lineWidth = 3 * S;
  ctx.beginPath();
  ctx.moveTo(torsoSX + 2 * S, torsoSY - 1 * S);
  ctx.quadraticCurveTo(
    (torsoSX + torsoEX) / 2 + 1 * S, (torsoSY + torsoEY) / 2 - 6 * S,
    torsoEX - 1 * S, torsoEY + 1 * S,
  );
  ctx.stroke();

  // Arms
  const handX = headTX + 5 * S, handY = hbY + 2 * S;
  const shoulderX = torsoEX - 2 * S, shoulderY = torsoEY;
  ctx.strokeStyle = C.jersey;
  ctx.lineWidth = 4.5 * S;
  ctx.beginPath(); ctx.moveTo(shoulderX, shoulderY); ctx.lineTo(handX, handY); ctx.stroke();
  // Forearm (skin)
  ctx.strokeStyle = C.skin;
  ctx.lineWidth = 3.5 * S;
  const midArmX = (shoulderX + handX) / 2 + 3 * S;
  const midArmY = (shoulderY + handY) / 2;
  ctx.beginPath(); ctx.moveTo(midArmX, midArmY); ctx.lineTo(handX, handY); ctx.stroke();
  // Glove
  ctx.fillStyle = "#333";
  ctx.beginPath(); ctx.arc(handX, handY, 2.5 * S, 0, Math.PI * 2); ctx.fill();

  // Head
  const headX = torsoEX + 3 * S, headY = torsoEY - 7 * S;
  ctx.fillStyle = C.skin;
  ctx.beginPath(); ctx.arc(headX, headY, 5.5 * S, 0, Math.PI * 2); ctx.fill();

  // Sunglasses
  ctx.fillStyle = "#222";
  ctx.beginPath();
  ctx.ellipse(headX + 3 * S, headY + 0.5 * S, 4 * S, 2 * S, 0, 0, Math.PI * 2);
  ctx.fill();

  // Helmet
  ctx.fillStyle = C.helmet;
  ctx.beginPath();
  ctx.ellipse(headX + 1 * S, headY - 3 * S, 7 * S, 5 * S, 0.15, 0, Math.PI * 2);
  ctx.fill();
  // Helmet vents
  ctx.strokeStyle = "rgba(0,0,0,0.2)";
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(headX - 3 * S + i * 3 * S, headY - 6 * S);
    ctx.lineTo(headX - 2 * S + i * 3 * S, headY - 2 * S);
    ctx.stroke();
  }

  ctx.restore();
}

// ─── Main Component ──────────────────────────────────────────────────
export default function Scene3D({ speed, cadence, gradient, elevation, power, elapsedTime }: Scene3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({
    scroll: 0,
    crankAngle: 0,
    bobPhase: 0,
    particles: [] as Particle[],
    motes: [] as Particle[],
    speedLines: [] as SpeedLine[],
    clouds: [] as Cloud[],
    stars: [] as { x: number; y: number; size: number; twinkle: number }[],
    treeSeed: [] as { offset: number; type: "pine" | "oak"; scale: number; side: number }[],
    lastTime: 0,
    initialized: false,
  });

  const propsRef = useRef({ speed, cadence, gradient, elevation, power, elapsedTime });
  propsRef.current = { speed, cadence, gradient, elevation, power, elapsedTime };

  const initScene = useCallback((W: number, H: number) => {
    const state = stateRef.current;
    if (state.initialized) return;
    state.initialized = true;

    // Stars
    for (let i = 0; i < 120; i++) {
      state.stars.push({
        x: Math.random() * W,
        y: Math.random() * H * 0.35,
        size: 0.5 + Math.random() * 1.5,
        twinkle: Math.random() * Math.PI * 2,
      });
    }

    // Trees
    for (let i = 0; i < 50; i++) {
      state.treeSeed.push({
        offset: i * 140 + Math.random() * 80,
        type: Math.random() > 0.4 ? "pine" : "oak",
        scale: 0.5 + Math.random() * 0.7,
        side: i % 2 === 0 ? -1 : 1,
      });
    }

    // Clouds
    for (let i = 0; i < 8; i++) {
      state.clouds.push({
        x: Math.random() * W,
        y: H * 0.05 + Math.random() * H * 0.2,
        width: 60 + Math.random() * 120,
        height: 20 + Math.random() * 30,
        speed: 0.1 + Math.random() * 0.3,
        alpha: 0.2 + Math.random() * 0.4,
      });
    }

    // Light motes
    for (let i = 0; i < 20; i++) {
      state.motes.push(createMote(W, H));
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: false })!;
    let animFrame = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const render = (timestamp: number) => {
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      const state = stateRef.current;
      const props = propsRef.current;

      initScene(W, H);

      const dt = state.lastTime ? Math.min(0.1, (timestamp - state.lastTime) / 1000) : 0.016;
      state.lastTime = timestamp;

      // Update
      state.scroll += props.speed * 0.8 * dt * 60;
      state.crankAngle += ((props.cadence / 60) * Math.PI * 2) * dt;
      state.bobPhase += ((props.cadence / 60) * Math.PI * 2) * dt;

      // Sky phase (cycles through golden hour colors)
      const skyLen = SKY_PHASES.top.length;
      const timePhase = ((props.elapsedTime * 0.008) + 4) % skyLen; // Start at golden hour
      const skyIdx = Math.floor(timePhase);
      const skyFrac = timePhase - skyIdx;
      const topColor = lerpColor(
        SKY_PHASES.top[skyIdx % skyLen],
        SKY_PHASES.top[(skyIdx + 1) % skyLen],
        skyFrac,
      );
      const botColor = lerpColor(
        SKY_PHASES.bottom[skyIdx % skyLen],
        SKY_PHASES.bottom[(skyIdx + 1) % skyLen],
        skyFrac,
      );

      // ═══════════════════════════════════════════════════════════════
      // SKY
      // ═══════════════════════════════════════════════════════════════
      const skyGrad = ctx.createLinearGradient(0, 0, 0, H * 0.65);
      skyGrad.addColorStop(0, topColor);
      skyGrad.addColorStop(1, botColor);
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, W, H);

      // ═══════════════════════════════════════════════════════════════
      // STARS (visible in darker sky phases)
      // ═══════════════════════════════════════════════════════════════
      const ah = parseInt(topColor.slice(1), 16);
      const skyBrightness = ((ah >> 16) & 0xff) + ((ah >> 8) & 0xff) + (ah & 0xff);
      if (skyBrightness < 200) {
        const starAlpha = Math.max(0, 1 - skyBrightness / 200);
        for (const star of state.stars) {
          star.twinkle += dt * (1 + Math.random() * 0.5);
          const a = starAlpha * (0.3 + 0.5 * (0.5 + 0.5 * Math.sin(star.twinkle)));
          ctx.fillStyle = `rgba(255, 255, 240, ${a})`;
          ctx.beginPath();
          ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // SUN
      // ═══════════════════════════════════════════════════════════════
      const sunAngle = (props.elapsedTime * 0.003) % (Math.PI * 2);
      const sunX = W * 0.6 + Math.cos(sunAngle) * W * 0.25;
      const sunY = H * 0.12 + Math.sin(sunAngle * 0.5) * H * 0.08;

      // Sun glow (big atmospheric glow)
      const glowR = 120;
      const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, glowR);
      glow.addColorStop(0, "rgba(255, 200, 80, 0.35)");
      glow.addColorStop(0.2, "rgba(255, 160, 60, 0.15)");
      glow.addColorStop(0.5, "rgba(255, 120, 40, 0.05)");
      glow.addColorStop(1, "rgba(255, 100, 30, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(sunX, sunY, glowR, 0, Math.PI * 2);
      ctx.fill();

      // Sun body
      ctx.fillStyle = "#fff8e0";
      ctx.beginPath();
      ctx.arc(sunX, sunY, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,240,200,0.5)";
      ctx.beginPath();
      ctx.arc(sunX, sunY, 28, 0, Math.PI * 2);
      ctx.fill();

      // ═══════════════════════════════════════════════════════════════
      // CLOUDS
      // ═══════════════════════════════════════════════════════════════
      for (const cloud of state.clouds) {
        cloud.x -= cloud.speed * dt * 20;
        if (cloud.x + cloud.width < -50) {
          cloud.x = W + 50 + Math.random() * 100;
          cloud.y = H * 0.05 + Math.random() * H * 0.2;
        }
        drawCloud(ctx, cloud);
      }

      // ═══════════════════════════════════════════════════════════════
      // FAR MOUNTAINS
      // ═══════════════════════════════════════════════════════════════
      drawMountainRange(ctx, W, H, H * 0.40, H * 0.14, COLORS.mountain1, COLORS.mountain1Light, 0, state.scroll, 0.008);
      drawMountainRange(ctx, W, H, H * 0.44, H * 0.11, COLORS.mountain2, COLORS.mountain2Light, 5, state.scroll, 0.015);

      // ═══════════════════════════════════════════════════════════════
      // HILLS
      // ═══════════════════════════════════════════════════════════════
      drawMountainRange(ctx, W, H, H * 0.50, H * 0.09, COLORS.hill1, COLORS.hill1Light, 10, state.scroll, 0.04);
      drawMountainRange(ctx, W, H, H * 0.54, H * 0.07, COLORS.hill2, COLORS.hill2Light, 15, state.scroll, 0.08);

      // ═══════════════════════════════════════════════════════════════
      // GROUND
      // ═══════════════════════════════════════════════════════════════
      const groundY = H * 0.56;
      const groundGrad = ctx.createLinearGradient(0, groundY, 0, H);
      groundGrad.addColorStop(0, "#2a6a2a");
      groundGrad.addColorStop(0.2, "#246024");
      groundGrad.addColorStop(0.5, "#1e501e");
      groundGrad.addColorStop(1, "#163016");
      ctx.fillStyle = groundGrad;
      ctx.fillRect(0, groundY, W, H - groundY);

      // Grass texture (subtle horizontal lines)
      ctx.strokeStyle = "rgba(40,100,40,0.15)";
      ctx.lineWidth = 0.5;
      for (let y = groundY; y < H; y += 8) {
        const offset = (state.scroll * 0.1 + y * 3) % W;
        ctx.beginPath();
        for (let x = -offset % 20; x < W; x += 20) {
          ctx.moveTo(x, y);
          ctx.lineTo(x + 12, y + 1);
        }
        ctx.stroke();
      }

      // ═══════════════════════════════════════════════════════════════
      // BACKGROUND TREES
      // ═══════════════════════════════════════════════════════════════
      const windPhase = timestamp * 0.0008;
      for (const tree of state.treeSeed) {
        const scrolledX = ((tree.offset - state.scroll * 0.12) % (W + 300)) - 150;
        const wrappedX = scrolledX < -150 ? scrolledX + W + 300 : scrolledX;
        const treeY = groundY + 6 + Math.abs(tree.side) * 4;
        const xPos = tree.side > 0 ? wrappedX + W * 0.25 : wrappedX + W * 0.15;

        if (xPos < -60 || xPos > W + 60) continue;

        const wp = windPhase + tree.offset * 0.01;
        if (tree.type === "pine") {
          drawPineTree(ctx, xPos, treeY, tree.scale * 0.7, wp, true);
        } else {
          drawOakTree(ctx, xPos, treeY, tree.scale * 0.7, wp, true);
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // ROAD
      // ═══════════════════════════════════════════════════════════════
      const roadTop = H * 0.58;
      const roadBottom = H;
      const roadTopW = W * 0.14;
      const roadBottomW = W * 0.65;
      const roadCX = W * 0.5;
      const roadShift = -props.gradient * 3;

      // Road surface
      const roadGrad = ctx.createLinearGradient(0, roadTop, 0, roadBottom);
      roadGrad.addColorStop(0, "#2a2a35");
      roadGrad.addColorStop(0.3, "#383840");
      roadGrad.addColorStop(0.7, "#444448");
      roadGrad.addColorStop(1, "#4a4a50");
      ctx.fillStyle = roadGrad;
      ctx.beginPath();
      ctx.moveTo(roadCX - roadTopW / 2 + roadShift, roadTop);
      ctx.lineTo(roadCX + roadTopW / 2 + roadShift, roadTop);
      ctx.lineTo(roadCX + roadBottomW / 2, roadBottom);
      ctx.lineTo(roadCX - roadBottomW / 2, roadBottom);
      ctx.closePath();
      ctx.fill();

      // Road edge lines
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(roadCX - roadTopW / 2 + roadShift, roadTop);
      ctx.lineTo(roadCX - roadBottomW / 2, roadBottom);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(roadCX + roadTopW / 2 + roadShift, roadTop);
      ctx.lineTo(roadCX + roadBottomW / 2, roadBottom);
      ctx.stroke();

      // Shoulder lines (yellow)
      ctx.strokeStyle = "rgba(255,200,50,0.2)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([10, 15]);
      ctx.beginPath();
      ctx.moveTo(roadCX - roadTopW * 0.35 + roadShift, roadTop);
      ctx.lineTo(roadCX - roadBottomW * 0.35, roadBottom);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(roadCX + roadTopW * 0.35 + roadShift, roadTop);
      ctx.lineTo(roadCX + roadBottomW * 0.35, roadBottom);
      ctx.stroke();
      ctx.setLineDash([]);

      // Center dashes (perspective)
      const dashCount = 20;
      const dashScroll = (state.scroll * 0.5) % 40;
      for (let i = 0; i < dashCount; i++) {
        const t1 = (i * 40 + dashScroll) / (dashCount * 40);
        const t2 = (i * 40 + dashScroll + 16) / (dashCount * 40);
        if (t1 > 1 || t2 < 0) continue;

        const ct1 = Math.max(0, Math.min(1, t1));
        const ct2 = Math.max(0, Math.min(1, t2));
        const p = 2.5;
        const y1 = roadTop + (roadBottom - roadTop) * Math.pow(ct1, p);
        const y2 = roadTop + (roadBottom - roadTop) * Math.pow(ct2, p);
        const w1 = lerp(roadTopW, roadBottomW, Math.pow(ct1, p)) * 0.018;
        const w2 = lerp(roadTopW, roadBottomW, Math.pow(ct2, p)) * 0.018;
        const x1 = roadCX + lerp(roadShift, 0, Math.pow(ct1, p));
        const x2 = roadCX + lerp(roadShift, 0, Math.pow(ct2, p));
        const alpha = 0.3 + Math.pow(ct1, 1.5) * 0.6;

        ctx.fillStyle = `rgba(255, 200, 50, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(x1 - w1, y1);
        ctx.lineTo(x1 + w1, y1);
        ctx.lineTo(x2 + w2, y2);
        ctx.lineTo(x2 - w2, y2);
        ctx.closePath();
        ctx.fill();
      }

      // ═══════════════════════════════════════════════════════════════
      // FOREGROUND TREES
      // ═══════════════════════════════════════════════════════════════
      for (const tree of state.treeSeed) {
        const scrolledX = ((tree.offset * 1.5 - state.scroll * 0.25) % (W + 400)) - 200;
        const wrappedX = scrolledX < -200 ? scrolledX + W + 400 : scrolledX;
        const side = tree.side;

        const roadEdgeX = side > 0
          ? roadCX + roadBottomW * 0.37 + 40
          : roadCX - roadBottomW * 0.37 - 40;

        const treeX = roadEdgeX + side * (15 + Math.abs(wrappedX % 50));
        const treeY = H * 0.87 + (wrappedX % 12);

        if (treeX < -100 || treeX > W + 100) continue;

        const wp = windPhase + tree.offset * 0.015;
        const sc = tree.scale * 1.3;
        if (tree.type === "pine") {
          drawPineTree(ctx, treeX, treeY, sc, wp, true);
        } else {
          drawOakTree(ctx, treeX, treeY, sc, wp, true);
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // CYCLIST
      // ═══════════════════════════════════════════════════════════════
      drawCyclist(
        ctx, W * 0.47, H * 0.71,
        state.crankAngle, props.gradient, props.speed,
        state.bobPhase,
      );

      // ═══════════════════════════════════════════════════════════════
      // DUST PARTICLES
      // ═══════════════════════════════════════════════════════════════
      if (props.speed > 5 && state.particles.length < 60) {
        if (Math.random() < 0.3 + props.speed * 0.01) {
          state.particles.push(createDustParticle(W, H, props.speed));
        }
      }
      for (let i = state.particles.length - 1; i >= 0; i--) {
        const p = state.particles[i];
        p.x += p.vx; p.y += p.vy; p.life++;
        if (p.life > p.maxLife || p.x < -20) { state.particles.splice(i, 1); continue; }
        const lr = p.life / p.maxLife;
        const a = p.alpha * (1 - lr) * Math.min(1, p.life / 5);
        ctx.fillStyle = `rgba(220, 210, 190, ${a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 + lr * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }

      // ═══════════════════════════════════════════════════════════════
      // LIGHT MOTES (golden particles in air)
      // ═══════════════════════════════════════════════════════════════
      if (state.motes.length < 20 && Math.random() < 0.03) {
        state.motes.push(createMote(W, H));
      }
      for (let i = state.motes.length - 1; i >= 0; i--) {
        const m = state.motes[i];
        m.x += m.vx + Math.sin(timestamp * 0.0008 + i * 1.7) * 0.15;
        m.y += m.vy + Math.cos(timestamp * 0.001 + i * 2.1) * 0.1;
        m.life++;
        if (m.life > m.maxLife) { state.motes.splice(i, 1); continue; }
        const lr = m.life / m.maxLife;
        const pulse = Math.sin(lr * Math.PI) * (0.5 + 0.5 * Math.sin(timestamp * 0.002 + i));
        const a = pulse * 0.5;
        if (a > 0.03) {
          const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.size * 4);
          g.addColorStop(0, `rgba(255, 220, 120, ${a})`);
          g.addColorStop(0.5, `rgba(255, 200, 80, ${a * 0.3})`);
          g.addColorStop(1, "rgba(255,180,60,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(m.x, m.y, m.size * 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // SPEED LINES
      // ═══════════════════════════════════════════════════════════════
      if (props.speed > 25) {
        if (state.speedLines.length < 25 && Math.random() < (props.speed - 25) * 0.02) {
          state.speedLines.push({
            x: W + 10,
            y: H * 0.3 + Math.random() * H * 0.35,
            len: 20 + Math.random() * 40 + (props.speed - 25) * 2,
            speed: 8 + Math.random() * 6 + props.speed * 0.2,
            alpha: 0.15 + Math.random() * 0.25,
          });
        }
      }
      for (let i = state.speedLines.length - 1; i >= 0; i--) {
        const sl = state.speedLines[i];
        sl.x -= sl.speed;
        if (sl.x + sl.len < 0) { state.speedLines.splice(i, 1); continue; }
        const g = ctx.createLinearGradient(sl.x, sl.y, sl.x + sl.len, sl.y);
        g.addColorStop(0, `rgba(255, 255, 255, ${sl.alpha})`);
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(sl.x, sl.y);
        ctx.lineTo(sl.x + sl.len, sl.y);
        ctx.stroke();
      }

      // ═══════════════════════════════════════════════════════════════
      // VIGNETTE (softer)
      // ═══════════════════════════════════════════════════════════════
      const vignette = ctx.createRadialGradient(W / 2, H / 2, W * 0.3, W / 2, H / 2, W * 0.8);
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(1, "rgba(0,0,0,0.3)");
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, W, H);

      // ═══════════════════════════════════════════════════════════════
      // GRADIENT INDICATOR
      // ═══════════════════════════════════════════════════════════════
      if (Math.abs(props.gradient) > 1.5) {
        const text = `${props.gradient > 0 ? "▲" : "▼"} ${Math.abs(props.gradient).toFixed(1)}%`;
        ctx.font = "bold 14px -apple-system, sans-serif";
        ctx.fillStyle = props.gradient > 3 ? "rgba(231,76,60,0.7)" : props.gradient < -3 ? "rgba(74,158,255,0.7)" : "rgba(255,255,255,0.4)";
        ctx.textAlign = "center";
        ctx.fillText(text, W * 0.5, roadTop - 10);
      }

      animFrame = requestAnimationFrame(render);
    };

    animFrame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animFrame);
      window.removeEventListener("resize", resize);
    };
  }, [initScene]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height: "100%",
        display: "block",
        background: "#0a0e1a",
      }}
    />
  );
}
