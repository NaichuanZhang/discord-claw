import React, { useRef, useMemo, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Sky, Environment, Float, Trail } from "@react-three/drei";
import * as THREE from "three";

// ═══════════════════════════════════════════════════════════════════════
// Procedural Road
// ═══════════════════════════════════════════════════════════════════════

function Road({ scrollOffset }: { scrollOffset: number }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const geometry = useMemo(() => {
    const points: THREE.Vector3[] = [];
    const SEGMENTS = 200;
    const LENGTH = 400;
    for (let i = 0; i < SEGMENTS; i++) {
      const t = (i / SEGMENTS) * LENGTH;
      const x = Math.sin(t * 0.01) * 30 + Math.sin(t * 0.005) * 50;
      const y = Math.sin(t * 0.008) * 8 + Math.sin(t * 0.003) * 15;
      const z = -t;
      points.push(new THREE.Vector3(x, y, z));
    }
    const curve = new THREE.CatmullRomCurve3(points);
    const geo = new THREE.TubeGeometry(curve, 500, 4, 8, false);
    // Flatten to road — squash Y of the tube to make a flat ribbon
    const pos = geo.attributes.position;
    const normals = geo.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const nx = normals.getX(i);
      const ny = normals.getY(i);
      // Keep only horizontal normals → flat road surface
      if (ny > 0.3) {
        pos.setY(i, pos.getY(i) + 0.1);
      } else if (ny < -0.3) {
        pos.setY(i, pos.getY(i) - 0.2);
      }
    }
    pos.needsUpdate = true;
    return geo;
  }, []);

  const roadMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: "#333333",
      roughness: 0.9,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });
  }, []);

  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.position.z = (scrollOffset % 400);
    }
  });

  return <mesh ref={meshRef} geometry={geometry} material={roadMaterial} />;
}

// ═══════════════════════════════════════════════════════════════════════
// Road Markings (center line dashes)
// ═══════════════════════════════════════════════════════════════════════

function RoadMarkings({ scrollOffset }: { scrollOffset: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const dashes = useMemo(() => {
    const items = [];
    for (let i = 0; i < 80; i++) {
      items.push({
        z: -i * 5,
        x: Math.sin((-i * 5) * 0.01) * 30 + Math.sin((-i * 5) * 0.005) * 50,
        y: Math.sin((-i * 5) * 0.008) * 8 + Math.sin((-i * 5) * 0.003) * 15 + 0.35,
      });
    }
    return items;
  }, []);

  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.position.z = (scrollOffset % 10);
    }
  });

  return (
    <group ref={groupRef}>
      {dashes.map((d, i) => (
        <mesh key={i} position={[d.x, d.y, d.z]}>
          <boxGeometry args={[0.15, 0.02, 2]} />
          <meshStandardMaterial color="#ffcc33" emissive="#ffcc33" emissiveIntensity={0.3} />
        </mesh>
      ))}
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Cyclist (procedural 3D)
// ═══════════════════════════════════════════════════════════════════════

function Cyclist({ cadence, speed }: { cadence: number; speed: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const crankRef = useRef<THREE.Group>(null);
  const leftPedalRef = useRef<THREE.Group>(null);
  const rightPedalRef = useRef<THREE.Group>(null);
  const bodyBobRef = useRef(0);

  useFrame((_, delta) => {
    // Crank rotation based on cadence (RPM → radians/sec)
    const radsPerSec = (cadence / 60) * Math.PI * 2;
    if (crankRef.current) {
      crankRef.current.rotation.z += radsPerSec * delta;
    }
    // Body bob
    bodyBobRef.current += delta * (cadence / 60) * Math.PI * 2;
    if (groupRef.current) {
      groupRef.current.position.y = Math.sin(bodyBobRef.current * 2) * 0.03 + 1.8;
      // Slight lean into effort
      groupRef.current.rotation.z = Math.sin(bodyBobRef.current) * 0.015;
    }
    // Pedal counter-rotation (stay level)
    if (leftPedalRef.current && crankRef.current) {
      leftPedalRef.current.rotation.z = -crankRef.current.rotation.z;
    }
    if (rightPedalRef.current && crankRef.current) {
      rightPedalRef.current.rotation.z = -crankRef.current.rotation.z;
    }
  });

  return (
    <group ref={groupRef} position={[0, 1.8, -3]}>
      {/* Bike Frame */}
      <group>
        {/* Main frame triangle */}
        <mesh position={[0, 0, 0]}>
          {/* Down tube */}
          <mesh position={[0.15, -0.1, 0]} rotation={[0, 0, -0.6]}>
            <cylinderGeometry args={[0.025, 0.025, 0.8, 8]} />
            <meshStandardMaterial color="#e74c3c" metalness={0.8} roughness={0.2} />
          </mesh>
          {/* Top tube */}
          <mesh position={[0, 0.2, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.02, 0.02, 0.7, 8]} />
            <meshStandardMaterial color="#e74c3c" metalness={0.8} roughness={0.2} />
          </mesh>
          {/* Seat tube */}
          <mesh position={[-0.25, 0.05, 0]} rotation={[0, 0, 0.1]}>
            <cylinderGeometry args={[0.02, 0.02, 0.6, 8]} />
            <meshStandardMaterial color="#e74c3c" metalness={0.8} roughness={0.2} />
          </mesh>
          {/* Seat stays */}
          <mesh position={[-0.15, -0.15, 0]} rotation={[0, 0, -0.8]}>
            <cylinderGeometry args={[0.015, 0.015, 0.55, 8]} />
            <meshStandardMaterial color="#c0392b" metalness={0.8} roughness={0.2} />
          </mesh>
          {/* Chain stays */}
          <mesh position={[-0.1, -0.35, 0]} rotation={[0, 0, Math.PI / 2 + 0.2]}>
            <cylinderGeometry args={[0.015, 0.015, 0.5, 8]} />
            <meshStandardMaterial color="#c0392b" metalness={0.8} roughness={0.2} />
          </mesh>
          {/* Fork */}
          <mesh position={[0.35, -0.15, 0]} rotation={[0, 0, 0.15]}>
            <cylinderGeometry args={[0.015, 0.015, 0.5, 8]} />
            <meshStandardMaterial color="#888" metalness={0.9} roughness={0.1} />
          </mesh>
        </mesh>

        {/* Wheels */}
        {/* Rear wheel */}
        <group position={[-0.35, -0.4, 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.32, 0.015, 8, 32]} />
            <meshStandardMaterial color="#111" roughness={0.6} />
          </mesh>
          {/* Hub */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.03, 0.03, 0.02, 16]} />
            <meshStandardMaterial color="#999" metalness={0.9} roughness={0.1} />
          </mesh>
          {/* Spokes */}
          {Array.from({ length: 16 }).map((_, i) => (
            <mesh key={i} rotation={[Math.PI / 2, 0, (i / 16) * Math.PI * 2]}>
              <cylinderGeometry args={[0.002, 0.002, 0.3, 4]} />
              <meshStandardMaterial color="#ccc" metalness={0.9} />
            </mesh>
          ))}
          {/* Tire */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.32, 0.025, 8, 32]} />
            <meshStandardMaterial color="#222" roughness={0.8} />
          </mesh>
        </group>

        {/* Front wheel */}
        <group position={[0.35, -0.4, 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.32, 0.015, 8, 32]} />
            <meshStandardMaterial color="#111" roughness={0.6} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.03, 0.03, 0.02, 16]} />
            <meshStandardMaterial color="#999" metalness={0.9} roughness={0.1} />
          </mesh>
          {Array.from({ length: 16 }).map((_, i) => (
            <mesh key={i} rotation={[Math.PI / 2, 0, (i / 16) * Math.PI * 2]}>
              <cylinderGeometry args={[0.002, 0.002, 0.3, 4]} />
              <meshStandardMaterial color="#ccc" metalness={0.9} />
            </mesh>
          ))}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.32, 0.025, 8, 32]} />
            <meshStandardMaterial color="#222" roughness={0.8} />
          </mesh>
        </group>

        {/* Cranks & pedals */}
        <group ref={crankRef} position={[-0.05, -0.35, 0]}>
          {/* Crank arms */}
          <mesh rotation={[0, 0, 0]}>
            <boxGeometry args={[0.02, 0.3, 0.02]} />
            <meshStandardMaterial color="#888" metalness={0.9} roughness={0.1} />
          </mesh>
          {/* Left pedal */}
          <group ref={leftPedalRef} position={[0, 0.15, 0]}>
            <mesh>
              <boxGeometry args={[0.06, 0.01, 0.04]} />
              <meshStandardMaterial color="#444" />
            </mesh>
          </group>
          {/* Right pedal */}
          <group ref={rightPedalRef} position={[0, -0.15, 0]}>
            <mesh>
              <boxGeometry args={[0.06, 0.01, 0.04]} />
              <meshStandardMaterial color="#444" />
            </mesh>
          </group>
        </group>

        {/* Handlebars */}
        <group position={[0.35, 0.15, 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.1, 0.01, 8, 16, Math.PI]} />
            <meshStandardMaterial color="#333" metalness={0.8} roughness={0.2} />
          </mesh>
          {/* Bar tape */}
          <mesh position={[-0.1, 0, 0.03]}>
            <sphereGeometry args={[0.02, 8, 8]} />
            <meshStandardMaterial color="#e74c3c" />
          </mesh>
          <mesh position={[-0.1, 0, -0.03]}>
            <sphereGeometry args={[0.02, 8, 8]} />
            <meshStandardMaterial color="#e74c3c" />
          </mesh>
        </group>

        {/* Saddle */}
        <group position={[-0.25, 0.35, 0]}>
          <mesh>
            <boxGeometry args={[0.22, 0.03, 0.1]} />
            <meshStandardMaterial color="#222" roughness={0.9} />
          </mesh>
        </group>
      </group>

      {/* Rider body */}
      <group position={[-0.05, 0.25, 0]}>
        {/* Torso (aero position) */}
        <mesh position={[0.1, 0.35, 0]} rotation={[0, 0, 0.5]}>
          <capsuleGeometry args={[0.08, 0.3, 8, 16]} />
          <meshStandardMaterial color="#2980b9" roughness={0.6} />
        </mesh>
        {/* Head */}
        <mesh position={[0.3, 0.5, 0]}>
          <sphereGeometry args={[0.07, 16, 16]} />
          <meshStandardMaterial color="#f5d5a0" roughness={0.8} />
        </mesh>
        {/* Helmet */}
        <mesh position={[0.3, 0.55, 0]} rotation={[0.2, 0, 0.3]}>
          <capsuleGeometry args={[0.06, 0.08, 8, 16]} />
          <meshStandardMaterial color="#e74c3c" roughness={0.3} metalness={0.4} />
        </mesh>
        {/* Arms */}
        <mesh position={[0.25, 0.25, 0.06]} rotation={[0, 0, 0.8]}>
          <capsuleGeometry args={[0.025, 0.25, 4, 8]} />
          <meshStandardMaterial color="#2980b9" roughness={0.6} />
        </mesh>
        <mesh position={[0.25, 0.25, -0.06]} rotation={[0, 0, 0.8]}>
          <capsuleGeometry args={[0.025, 0.25, 4, 8]} />
          <meshStandardMaterial color="#2980b9" roughness={0.6} />
        </mesh>
      </group>
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Terrain — ground, trees, rocks, grass
// ═══════════════════════════════════════════════════════════════════════

function Terrain({ scrollOffset }: { scrollOffset: number }) {
  const groupRef = useRef<THREE.Group>(null);

  const trees = useMemo(() => {
    const items = [];
    for (let i = 0; i < 120; i++) {
      const z = -i * 8 - Math.random() * 5;
      const roadX = Math.sin(z * 0.01) * 30 + Math.sin(z * 0.005) * 50;
      const side = i % 2 === 0 ? 1 : -1;
      const offset = 6 + Math.random() * 25;
      const x = roadX + side * offset;
      const roadY = Math.sin(z * 0.008) * 8 + Math.sin(z * 0.003) * 15;
      const y = roadY;
      const height = 2 + Math.random() * 4;
      const trunkH = height * 0.5;
      const crownR = height * 0.35 + Math.random() * 0.5;
      const type = Math.random() > 0.3 ? "pine" : "oak";
      items.push({ x, y, z, height, trunkH, crownR, type, key: i });
    }
    return items;
  }, []);

  const rocks = useMemo(() => {
    const items = [];
    for (let i = 0; i < 40; i++) {
      const z = -i * 20 - Math.random() * 15;
      const roadX = Math.sin(z * 0.01) * 30 + Math.sin(z * 0.005) * 50;
      const side = Math.random() > 0.5 ? 1 : -1;
      const x = roadX + side * (5 + Math.random() * 20);
      const roadY = Math.sin(z * 0.008) * 8 + Math.sin(z * 0.003) * 15;
      const scale = 0.3 + Math.random() * 0.8;
      items.push({ x, y: roadY, z, scale, key: i });
    }
    return items;
  }, []);

  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.position.z = (scrollOffset % 64);
    }
  });

  return (
    <group ref={groupRef}>
      {/* Trees */}
      {trees.map((t) => (
        <group key={t.key} position={[t.x, t.y, t.z]}>
          {/* Trunk */}
          <mesh position={[0, t.trunkH / 2, 0]}>
            <cylinderGeometry args={[0.08, 0.12, t.trunkH, 6]} />
            <meshStandardMaterial color="#5c3a1e" roughness={0.9} />
          </mesh>
          {/* Crown */}
          {t.type === "pine" ? (
            <>
              <mesh position={[0, t.trunkH + t.crownR * 0.5, 0]}>
                <coneGeometry args={[t.crownR, t.crownR * 2, 8]} />
                <meshStandardMaterial color="#1a5c2a" roughness={0.8} />
              </mesh>
              <mesh position={[0, t.trunkH + t.crownR * 1.3, 0]}>
                <coneGeometry args={[t.crownR * 0.7, t.crownR * 1.4, 8]} />
                <meshStandardMaterial color="#1e6b30" roughness={0.8} />
              </mesh>
            </>
          ) : (
            <mesh position={[0, t.trunkH + t.crownR * 0.3, 0]}>
              <sphereGeometry args={[t.crownR, 8, 8]} />
              <meshStandardMaterial color="#2d7a3a" roughness={0.8} />
            </mesh>
          )}
        </group>
      ))}

      {/* Rocks */}
      {rocks.map((r) => (
        <mesh key={r.key} position={[r.x, r.y + r.scale * 0.3, r.z]} rotation={[Math.random(), Math.random(), 0]}>
          <dodecahedronGeometry args={[r.scale, 0]} />
          <meshStandardMaterial color="#555" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Ground Plane
// ═══════════════════════════════════════════════════════════════════════

function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1, 0]} receiveShadow>
      <planeGeometry args={[500, 1000]} />
      <meshStandardMaterial color="#1a3a1a" roughness={1} />
    </mesh>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Mountains (backdrop)
// ═══════════════════════════════════════════════════════════════════════

function Mountains() {
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(600, 80, 128, 32);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const noise =
        Math.sin(x * 0.02) * 15 +
        Math.sin(x * 0.05 + 1) * 8 +
        Math.sin(x * 0.1 + 2) * 4 +
        Math.cos(x * 0.03 + y * 0.1) * 10;
      pos.setZ(i, Math.max(0, noise + y * 0.3));
    }
    geo.computeVertexNormals();
    return geo;
  }, []);

  return (
    <group position={[0, 10, -300]}>
      <mesh geometry={geometry} rotation={[0, 0, 0]}>
        <meshStandardMaterial color="#1a2040" roughness={0.9} />
      </mesh>
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Particles (dust, atmosphere)
// ═══════════════════════════════════════════════════════════════════════

function Particles({ speed }: { speed: number }) {
  const pointsRef = useRef<THREE.Points>(null);
  const COUNT = 500;

  const [positions, velocities] = useMemo(() => {
    const pos = new Float32Array(COUNT * 3);
    const vel = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 60;
      pos[i * 3 + 1] = Math.random() * 15;
      pos[i * 3 + 2] = Math.random() * -50;
      vel[i * 3] = (Math.random() - 0.5) * 0.02;
      vel[i * 3 + 1] = (Math.random() - 0.5) * 0.01;
      vel[i * 3 + 2] = 0.05 + Math.random() * 0.1;
    }
    return [pos, vel];
  }, []);

  useFrame((_, delta) => {
    if (!pointsRef.current) return;
    const pos = pointsRef.current.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const speedFactor = Math.max(0.5, speed / 30);

    for (let i = 0; i < COUNT; i++) {
      arr[i * 3] += velocities[i * 3] * speedFactor;
      arr[i * 3 + 1] += velocities[i * 3 + 1];
      arr[i * 3 + 2] += velocities[i * 3 + 2] * speedFactor;

      // Reset particles that pass camera
      if (arr[i * 3 + 2] > 5) {
        arr[i * 3] = (Math.random() - 0.5) * 60;
        arr[i * 3 + 1] = Math.random() * 15;
        arr[i * 3 + 2] = -50 - Math.random() * 20;
      }
    }
    pos.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={COUNT}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.08}
        color="#ffffff"
        transparent
        opacity={0.4}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Fireflies (accent particles near trees)
// ═══════════════════════════════════════════════════════════════════════

function Fireflies() {
  const pointsRef = useRef<THREE.Points>(null);
  const COUNT = 80;

  const [positions] = useMemo(() => {
    const pos = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 50;
      pos[i * 3 + 1] = 0.5 + Math.random() * 5;
      pos[i * 3 + 2] = Math.random() * -40;
    }
    return [pos];
  }, []);

  useFrame(({ clock }) => {
    if (!pointsRef.current) return;
    const pos = pointsRef.current.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const t = clock.getElapsedTime();

    for (let i = 0; i < COUNT; i++) {
      arr[i * 3] += Math.sin(t * 0.5 + i) * 0.005;
      arr[i * 3 + 1] += Math.sin(t * 0.7 + i * 1.3) * 0.003;
    }
    pos.needsUpdate = true;

    // Pulse opacity
    const mat = pointsRef.current.material as THREE.PointsMaterial;
    mat.opacity = 0.3 + Math.sin(t * 2) * 0.2;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={COUNT}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.15}
        color="#ffee88"
        transparent
        opacity={0.5}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Speed Lines (at high speeds)
// ═══════════════════════════════════════════════════════════════════════

function SpeedLines({ speed }: { speed: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const lines = useMemo(() => {
    const items = [];
    for (let i = 0; i < 30; i++) {
      items.push({
        x: (Math.random() - 0.5) * 8,
        y: Math.random() * 4 + 0.5,
        z: -Math.random() * 15 - 2,
      });
    }
    return items;
  }, []);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    groupRef.current.children.forEach((child, i) => {
      child.position.z += speed * 0.02 * delta * 60;
      if (child.position.z > 5) {
        child.position.z = -15 - Math.random() * 10;
        child.position.x = (Math.random() - 0.5) * 8;
        child.position.y = Math.random() * 4 + 0.5;
      }
    });
  });

  if (speed < 25) return null;

  const opacity = Math.min(0.6, (speed - 25) / 30);
  const lineLength = 0.5 + (speed - 25) * 0.05;

  return (
    <group ref={groupRef}>
      {lines.map((l, i) => (
        <mesh key={i} position={[l.x, l.y, l.z]}>
          <boxGeometry args={[0.01, 0.01, lineLength]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={opacity} />
        </mesh>
      ))}
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Camera Controller
// ═══════════════════════════════════════════════════════════════════════

function CameraController({ speed, gradient }: { speed: number; gradient: number }) {
  const { camera } = useThree();
  const targetFov = useRef(60);

  useFrame((_, delta) => {
    // Dynamic FOV based on speed
    const desiredFov = 55 + Math.min(20, speed * 0.3);
    targetFov.current += (desiredFov - targetFov.current) * delta * 2;
    (camera as THREE.PerspectiveCamera).fov = targetFov.current;
    camera.updateProjectionMatrix();

    // Subtle camera tilt based on gradient
    const targetRotX = gradient * 0.01;
    camera.rotation.x += (targetRotX - camera.rotation.x) * delta;
  });

  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// Fog & Atmosphere
// ═══════════════════════════════════════════════════════════════════════

function AtmosphericFog() {
  const { scene } = useThree();
  useEffect(() => {
    scene.fog = new THREE.FogExp2("#0a1520", 0.004);
    return () => { scene.fog = null; };
  }, [scene]);
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// Main 3D Scene export
// ═══════════════════════════════════════════════════════════════════════

interface Scene3DProps {
  speed: number;
  cadence: number;
  gradient: number;
  elevation: number;
  power: number;
  elapsedTime: number;
}

export default function Scene3D({ speed, cadence, gradient, elevation, power, elapsedTime }: Scene3DProps) {
  const scrollOffsetRef = useRef(0);
  const scrollOffset = scrollOffsetRef.current;

  // Update scroll outside of React state for performance
  useEffect(() => {
    const interval = setInterval(() => {
      scrollOffsetRef.current += speed * 0.015;
    }, 16);
    return () => clearInterval(interval);
  }, [speed]);

  // Dynamic sun position based on elapsed time
  const sunPosition = useMemo((): [number, number, number] => {
    const timeAngle = (elapsedTime * 0.002) % (Math.PI * 2);
    return [
      Math.cos(timeAngle) * 200,
      60 + Math.sin(timeAngle) * 50,
      -100,
    ];
  }, [Math.floor(elapsedTime / 5)]); // Only recompute every 5 seconds

  return (
    <Canvas
      camera={{ position: [0, 3, 5], fov: 60, near: 0.1, far: 500 }}
      style={{ width: "100%", height: "100%", background: "#000" }}
      dpr={[1, 1.5]}
    >
      <AtmosphericFog />
      <CameraController speed={speed} gradient={gradient} />

      {/* Lighting */}
      <ambientLight intensity={0.3} color="#4466aa" />
      <directionalLight
        position={sunPosition}
        intensity={1.5}
        color="#ffeedd"
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <pointLight position={[0, 2, -2]} intensity={0.5} color="#ff6622" distance={10} />
      <hemisphereLight args={["#446688", "#1a3a1a", 0.4]} />

      {/* Sky */}
      <Sky
        sunPosition={sunPosition}
        turbidity={8}
        rayleigh={2}
        mieCoefficient={0.005}
        mieDirectionalG={0.8}
      />

      {/* World */}
      <Ground />
      <Mountains />
      <Road scrollOffset={scrollOffset} />
      <RoadMarkings scrollOffset={scrollOffset} />
      <Terrain scrollOffset={scrollOffset} />

      {/* Cyclist */}
      <Cyclist cadence={cadence} speed={speed} />

      {/* Atmosphere & particles */}
      <Particles speed={speed} />
      <Fireflies />
      <SpeedLines speed={speed} />
    </Canvas>
  );
}
