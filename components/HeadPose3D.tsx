'use client';

import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Text, Line } from '@react-three/drei';
import * as THREE from 'three';

function AxisLine({ start, end, color }: { start: [number, number, number]; end: [number, number, number]; color: string }) {
  return <Line points={[start, end]} color={color} lineWidth={1.5} dashed dashSize={0.15} gapSize={0.08} />;
}

function CurvedArrowWithTip({ axis, radius, color, segments = 40 }: { axis: 'x' | 'y' | 'z'; radius: number; color: string; segments?: number }) {
  const { points, tipPos, tipRot } = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    const startAngle = -Math.PI * 0.38;
    const endAngle = Math.PI * 0.38;
    for (let i = 0; i <= segments; i++) {
      const t = startAngle + (endAngle - startAngle) * (i / segments);
      if (axis === 'y') pts.push(new THREE.Vector3(Math.cos(t) * radius, 0, Math.sin(t) * radius));
      else if (axis === 'x') pts.push(new THREE.Vector3(0, Math.cos(t) * radius, Math.sin(t) * radius));
      else pts.push(new THREE.Vector3(Math.cos(t) * radius, Math.sin(t) * radius, 0));
    }
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    const dir = new THREE.Vector3().subVectors(last, prev).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const e = new THREE.Euler().setFromQuaternion(q);
    return { points: pts, tipPos: [last.x, last.y, last.z] as [number, number, number], tipRot: e };
  }, [axis, radius, segments]);

  return (
    <group>
      <Line points={points} color={color} lineWidth={2.5} />
      <mesh position={tipPos} rotation={tipRot}>
        <coneGeometry args={[0.04, 0.14, 6]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
}

function HeadModel({ euler }: { euler: THREE.Euler }) {
  const skin = '#c4a882';
  const skinLight = '#d4b896';
  const skinDark = '#a08968';
  const eyeWhite = '#f0ece6';
  const lipColor = '#b07060';
  const hairColor = '#1a1008';

  return (
    <group rotation={euler}>
      <mesh position={[0, 0.2, -0.05]} scale={[1, 1.12, 1]}>
        <sphereGeometry args={[0.78, 32, 32]} />
        <meshStandardMaterial color={skin} roughness={0.75} metalness={0.02} />
      </mesh>
      <mesh position={[0, -0.1, 0.2]} scale={[0.92, 0.85, 0.8]}>
        <sphereGeometry args={[0.72, 24, 24]} />
        <meshStandardMaterial color={skin} roughness={0.75} metalness={0.02} />
      </mesh>
      <mesh position={[0, -0.55, 0.18]} scale={[0.72, 0.6, 0.7]}>
        <sphereGeometry args={[0.55, 20, 20]} />
        <meshStandardMaterial color={skin} roughness={0.75} metalness={0.02} />
      </mesh>
      <mesh position={[0, -0.78, 0.28]}>
        <sphereGeometry args={[0.2, 16, 16]} />
        <meshStandardMaterial color={skin} roughness={0.75} />
      </mesh>
      <mesh position={[0, 0.5, -0.12]} scale={[1.04, 0.95, 1.02]}>
        <sphereGeometry args={[0.72, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.58]} />
        <meshStandardMaterial color={hairColor} roughness={0.95} />
      </mesh>
      <mesh position={[0, -1.05, -0.05]}>
        <cylinderGeometry args={[0.24, 0.28, 0.55, 16]} />
        <meshStandardMaterial color={skinDark} roughness={0.75} />
      </mesh>
      <mesh position={[0, 0.22, 0.6]} scale={[1, 0.35, 0.4]}>
        <sphereGeometry args={[0.42, 16, 8]} />
        <meshStandardMaterial color={skin} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0, 0.7]} scale={[0.28, 0.7, 0.45]}>
        <sphereGeometry args={[0.18, 12, 12]} />
        <meshStandardMaterial color={skinLight} roughness={0.65} />
      </mesh>
      <mesh position={[0, -0.18, 0.82]}>
        <sphereGeometry args={[0.1, 12, 12]} />
        <meshStandardMaterial color={skinLight} roughness={0.6} />
      </mesh>
      <mesh position={[-0.06, -0.24, 0.78]}>
        <sphereGeometry args={[0.05, 8, 8]} />
        <meshStandardMaterial color={skinDark} roughness={0.8} />
      </mesh>
      <mesh position={[0.06, -0.24, 0.78]}>
        <sphereGeometry args={[0.05, 8, 8]} />
        <meshStandardMaterial color={skinDark} roughness={0.8} />
      </mesh>
      <mesh position={[-0.27, 0.1, 0.58]}>
        <sphereGeometry args={[0.17, 16, 16]} />
        <meshStandardMaterial color={skinDark} roughness={0.8} />
      </mesh>
      <mesh position={[0.27, 0.1, 0.58]}>
        <sphereGeometry args={[0.17, 16, 16]} />
        <meshStandardMaterial color={skinDark} roughness={0.8} />
      </mesh>
      <group position={[-0.27, 0.1, 0.64]}>
        <mesh><sphereGeometry args={[0.13, 16, 16]} /><meshStandardMaterial color={eyeWhite} roughness={0.2} /></mesh>
        <mesh position={[0, 0, 0.08]}><sphereGeometry args={[0.07, 16, 16]} /><meshStandardMaterial color="#4a6050" roughness={0.3} /></mesh>
        <mesh position={[0, 0, 0.12]}><sphereGeometry args={[0.035, 12, 12]} /><meshStandardMaterial color="#0a0a0a" /></mesh>
      </group>
      <group position={[0.27, 0.1, 0.64]}>
        <mesh><sphereGeometry args={[0.13, 16, 16]} /><meshStandardMaterial color={eyeWhite} roughness={0.2} /></mesh>
        <mesh position={[0, 0, 0.08]}><sphereGeometry args={[0.07, 16, 16]} /><meshStandardMaterial color="#4a6050" roughness={0.3} /></mesh>
        <mesh position={[0, 0, 0.12]}><sphereGeometry args={[0.035, 12, 12]} /><meshStandardMaterial color="#0a0a0a" /></mesh>
      </group>
      <mesh position={[-0.27, 0.28, 0.66]} rotation={[0.15, 0, 0.08]} scale={[1, 0.3, 0.4]}>
        <boxGeometry args={[0.26, 0.06, 0.08]} /><meshStandardMaterial color={hairColor} roughness={0.95} />
      </mesh>
      <mesh position={[0.27, 0.28, 0.66]} rotation={[0.15, 0, -0.08]} scale={[1, 0.3, 0.4]}>
        <boxGeometry args={[0.26, 0.06, 0.08]} /><meshStandardMaterial color={hairColor} roughness={0.95} />
      </mesh>
      <mesh position={[0, -0.42, 0.62]} scale={[1.2, 0.5, 0.7]}>
        <sphereGeometry args={[0.12, 12, 8]} />
        <meshStandardMaterial color={lipColor} roughness={0.5} />
      </mesh>
      <mesh position={[0, -0.48, 0.6]} scale={[1, 0.45, 0.6]}>
        <sphereGeometry args={[0.11, 12, 8]} />
        <meshStandardMaterial color={lipColor} roughness={0.5} />
      </mesh>
      <mesh position={[-0.78, 0.02, -0.05]} scale={[0.35, 1, 0.55]}>
        <sphereGeometry args={[0.2, 12, 12]} />
        <meshStandardMaterial color={skinDark} roughness={0.75} />
      </mesh>
      <mesh position={[0.78, 0.02, -0.05]} scale={[0.35, 1, 0.55]}>
        <sphereGeometry args={[0.2, 12, 12]} />
        <meshStandardMaterial color={skinDark} roughness={0.75} />
      </mesh>
    </group>
  );
}

function ContextLossHandler({ onLost }: { onLost: () => void }) {
  const { gl } = useThree();
  useEffect(() => {
    const canvas = gl.domElement;
    const handler = () => onLost();
    canvas.addEventListener('webglcontextlost', handler);
    return () => canvas.removeEventListener('webglcontextlost', handler);
  }, [gl, onLost]);
  return null;
}

function Scene({ pitchRad, yawRad, rollRad, pitchDeg, yawDeg, rollDeg, onContextLost }: {
  pitchRad: number; yawRad: number; rollRad: number;
  pitchDeg: number; yawDeg: number; rollDeg: number;
  onContextLost: () => void;
}) {
  const axisLen = 2.2;
  const euler = useMemo(() => new THREE.Euler(pitchRad, yawRad, rollRad, 'YXZ'), [pitchRad, yawRad, rollRad]);

  return (
    <>
      <ContextLossHandler onLost={onContextLost} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[2, 3, 5]} intensity={1.1} />
      <directionalLight position={[-3, -1, 2]} intensity={0.25} />
      <hemisphereLight args={['#b1c4de', '#3d2817', 0.3]} />
      <HeadModel euler={euler} />
      <AxisLine start={[0, -axisLen, 0]} end={[0, axisLen, 0]} color="#22c55e" />
      <mesh position={[0, axisLen, 0]}><coneGeometry args={[0.06, 0.2, 8]} /><meshBasicMaterial color="#22c55e" /></mesh>
      <Text position={[0.2, axisLen + 0.15, 0]} fontSize={0.22} color="#22c55e" anchorX="left" anchorY="middle" font={undefined}>Y</Text>
      <AxisLine start={[-axisLen, 0, 0]} end={[axisLen, 0, 0]} color="#22d3ee" />
      <mesh position={[axisLen, 0, 0]} rotation={[0, 0, -Math.PI / 2]}><coneGeometry args={[0.06, 0.2, 8]} /><meshBasicMaterial color="#22d3ee" /></mesh>
      <Text position={[axisLen + 0.15, 0.2, 0]} fontSize={0.22} color="#22d3ee" anchorX="left" anchorY="middle" font={undefined}>X</Text>
      <AxisLine start={[0, 0, -axisLen]} end={[0, 0, axisLen]} color="#f59e0b" />
      <mesh position={[0, 0, axisLen]} rotation={[Math.PI / 2, 0, 0]}><coneGeometry args={[0.06, 0.2, 8]} /><meshBasicMaterial color="#f59e0b" /></mesh>
      <Text position={[0.2, 0, axisLen + 0.15]} fontSize={0.22} color="#f59e0b" anchorX="left" anchorY="middle" font={undefined}>Z</Text>
      <group position={[0, 1.5, 0]}>
        <CurvedArrowWithTip axis="y" radius={0.6} color="#22c55e" />
        <Text position={[0, 0.35, 0]} fontSize={0.18} color="#22c55e" anchorX="center" anchorY="middle" font={undefined}>{`Yaw ${yawDeg.toFixed(1)}°`}</Text>
      </group>
      <group position={[1.6, 0, 0]}>
        <CurvedArrowWithTip axis="x" radius={0.6} color="#22d3ee" />
        <Text position={[0, 0, 0.9]} fontSize={0.18} color="#22d3ee" anchorX="center" anchorY="middle" font={undefined}>{`Pitch ${pitchDeg.toFixed(1)}°`}</Text>
      </group>
      <group position={[0, 0, 1.6]}>
        <CurvedArrowWithTip axis="z" radius={0.6} color="#f59e0b" />
        <Text position={[0.9, 0, 0]} fontSize={0.18} color="#f59e0b" anchorX="center" anchorY="middle" font={undefined}>{`Roll ${rollDeg.toFixed(1)}°`}</Text>
      </group>
      <OrbitControls enablePan={false} enableZoom minDistance={3} maxDistance={8} />
    </>
  );
}

export default function HeadPose3D({ pitchDeg, yawDeg, rollDeg }: {
  pitchDeg: number; yawDeg: number; rollDeg: number;
}) {
  const pitchRad = (pitchDeg * Math.PI) / 180;
  const yawRad = (yawDeg * Math.PI) / 180;
  const rollRad = (rollDeg * Math.PI) / 180;
  const [contextLost, setContextLost] = useState(false);
  const canvasKey = useRef(0);

  const handleContextLost = useCallback(() => setContextLost(true), []);

  const handleRetry = useCallback(() => {
    canvasKey.current += 1;
    setContextLost(false);
  }, []);

  if (contextLost) {
    return (
      <div className="w-full flex flex-col items-center justify-center gap-4" style={{ height: 380 }}>
        <p className="text-slate-400 text-sm text-center">WebGL context lost — too many 3D contexts in the browser.</p>
        <button
          type="button"
          onClick={handleRetry}
          className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium transition"
        >
          Retry 3D view
        </button>
      </div>
    );
  }

  return (
    <div className="w-full" style={{ height: 380 }}>
      <Canvas
        key={canvasKey.current}
        camera={{ position: [0, 0.5, 4.5], fov: 40 }}
        gl={{ antialias: true, powerPreference: 'default', failIfMajorPerformanceCaveat: false }}
        style={{ background: 'transparent' }}
        frameloop="demand"
      >
        <Scene
          pitchRad={pitchRad} yawRad={yawRad} rollRad={rollRad}
          pitchDeg={pitchDeg} yawDeg={yawDeg} rollDeg={rollDeg}
          onContextLost={handleContextLost}
        />
      </Canvas>
      <p className="text-center text-xs text-slate-500 mt-2">Drag to rotate · Scroll to zoom</p>
    </div>
  );
}
