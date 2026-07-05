import { useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

/*
 * VEGA — a holographic reactive core (the honest "JARVIS" avatar).
 *  A glowing icosahedron with a particle shell and two counter-rotating rings,
 *  in the app's cosmic red/ink palette. Three visual states:
 *    idle     — slow drift, calm.
 *    thinking — faster spin, brighter, the core tightens (AI is working).
 *    speaking — the core pulses/spikes on a noisy envelope, particles energise.
 *  Reacts to the pointer with a gentle parallax. Not a rigged talking face —
 *  that's a future upgrade; this is fully achievable and sells the feeling.
 *
 *  Perf: DPR capped at 2, modest particle count, frameloop pauses when the
 *  modal is closed (the whole <Canvas> unmounts, disposing GPU resources), and
 *  prefers-reduced-motion drops it to a still, low-energy state.
 */

export type VegaState = 'idle' | 'thinking' | 'speaking';

const RED = new THREE.Color('#ff4634');
const RED_DEEP = new THREE.Color('#b01206');

const ENERGY: Record<VegaState, number> = { idle: 0.16, thinking: 0.55, speaking: 0.9 };

function Core({ state, reduced }: { state: VegaState; reduced: boolean }) {
  const group = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  const ringA = useRef<THREE.Mesh>(null);
  const ringB = useRef<THREE.Mesh>(null);
  const shell = useRef<THREE.Points>(null);
  const coreMat = useRef<THREE.MeshStandardMaterial>(null);
  const energy = useRef(ENERGY.idle);
  const { pointer } = useThree();

  // Particle shell — points scattered on a sphere, generated once.
  const positions = useMemo(() => {
    const N = reduced ? 220 : 620;
    const arr = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = Math.random(), v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const r = 1.55 + Math.random() * 0.35;
      arr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      arr[i * 3 + 2] = r * Math.cos(phi);
    }
    return arr;
  }, [reduced]);

  useFrame((_s, dt) => {
    const t = _s.clock.elapsedTime;
    // Ease the energy envelope toward the target for the current state; while
    // speaking, ride a noisy oscillation so the core "talks" without real audio.
    const target = ENERGY[state] * (state === 'speaking' && !reduced
      ? 0.6 + 0.6 * Math.abs(Math.sin(t * 9.3) * 0.6 + Math.sin(t * 5.1) * 0.4)
      : 1);
    energy.current += (target - energy.current) * Math.min(1, dt * (state === 'speaking' ? 14 : 4));
    const e = energy.current;

    if (group.current) {
      // gentle pointer parallax + slow drift
      const px = reduced ? 0 : pointer.x * 0.35;
      const py = reduced ? 0 : pointer.y * 0.3;
      group.current.rotation.y += ((px) - group.current.rotation.y) * 0.05 + (reduced ? 0 : dt * 0.15);
      group.current.rotation.x += ((-py) - group.current.rotation.x) * 0.05;
      group.current.position.y = reduced ? 0 : Math.sin(t * 0.8) * 0.05;
    }
    if (core.current) {
      const s = 1 + e * 0.32;
      core.current.scale.setScalar(s);
      core.current.rotation.x += dt * (0.15 + e * 0.6);
      core.current.rotation.y += dt * (0.2 + e * 0.8);
    }
    if (coreMat.current) coreMat.current.emissiveIntensity = 0.7 + e * 2.2;
    if (halo.current) {
      halo.current.scale.setScalar(2.1 + e * 0.7);
      const hm = halo.current.material as THREE.MeshBasicMaterial;
      hm.opacity = 0.05 + e * 0.14;
    }
    if (ringA.current) ringA.current.rotation.z += dt * (0.3 + e * 1.4);
    if (ringB.current) ringB.current.rotation.z -= dt * (0.2 + e * 1.1);
    if (shell.current) {
      shell.current.rotation.y += dt * (0.1 + e * 0.5);
      shell.current.scale.setScalar(1 + e * 0.18);
      const pm = shell.current.material as THREE.PointsMaterial;
      pm.opacity = 0.35 + e * 0.5;
    }
  });

  return (
    <group ref={group}>
      {/* soft additive halo — fakes bloom without postprocessing */}
      <mesh ref={halo}>
        <icosahedronGeometry args={[0.9, 2]} />
        <meshBasicMaterial color={RED} transparent opacity={0.1} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

      {/* the glowing core */}
      <mesh ref={core}>
        <icosahedronGeometry args={[0.72, 1]} />
        <meshStandardMaterial
          ref={coreMat}
          color={RED_DEEP}
          emissive={RED}
          emissiveIntensity={1}
          roughness={0.3}
          metalness={0.6}
          flatShading
        />
      </mesh>

      {/* two counter-rotating rings */}
      <mesh ref={ringA} rotation={[Math.PI / 2.4, 0, 0]}>
        <torusGeometry args={[1.18, 0.014, 12, 96]} />
        <meshBasicMaterial color={RED} transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh ref={ringB} rotation={[Math.PI / 1.7, Math.PI / 5, 0]}>
        <torusGeometry args={[1.4, 0.01, 12, 96]} />
        <meshBasicMaterial color={'#ffd27a'} transparent opacity={0.35} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

      {/* particle shell */}
      <points ref={shell}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} count={positions.length / 3} />
        </bufferGeometry>
        <pointsMaterial
          color={RED}
          size={0.03}
          transparent
          opacity={0.5}
          sizeAttenuation
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>

      <ambientLight intensity={0.4} />
      <pointLight position={[3, 3, 4]} intensity={18} color={RED} distance={12} />
      <pointLight position={[-3, -2, 2]} intensity={8} color={'#ffd27a'} distance={10} />
    </group>
  );
}

export default function VegaAvatar({ state = 'idle', className }: { state?: VegaState; className?: string }) {
  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return (
    <div className={className}>
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0, 0, 5], fov: 42 }}
        frameloop={reduced ? 'demand' : 'always'}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        style={{ background: 'transparent' }}
      >
        <Core state={state} reduced={!!reduced} />
      </Canvas>
    </div>
  );
}
