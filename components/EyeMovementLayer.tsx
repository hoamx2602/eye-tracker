import React, { useEffect, useRef, useMemo, useState } from 'react';
import { EyeMovementKind } from '../types';

interface EyeMovementLayerProps {
  kind: EyeMovementKind;
  /** Ref updated each frame with current dot position in screen pixels (for data collection) */
  targetRef: React.MutableRefObject<{ x: number; y: number } | null>;
  onComplete: () => void;
}

const COUNTDOWN_MS = 2000;

const EyeMovementLayer: React.FC<EyeMovementLayerProps> = ({ kind, targetRef, onComplete }) => {
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const completedRef = useRef(false);
  const [pos, setPos] = useState<{ x: number; y: number; scale: number }>({ x: 50, y: 50, scale: 1 });
  const [countdown, setCountdown] = useState(Math.ceil(COUNTDOWN_MS / 1000));

  const durationMs = useMemo(() => {
    switch (kind) {
      case 'wiggling': return 20000;
      case 'horizontal': return 8000;
      case 'vertical': return 8000;
      case 'forward_backward': return 7000;
      case 'diagonal': return 9000;
      case 'h_pattern': return 10000;
      default: return 8000;
    }
  }, [kind]);

    const path = useMemo(() => {
    const pad = 12;
    const min = pad;
    const max = 100 - pad;
    const center = 50;
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const easeInOut = (t: number) => 0.5 - Math.cos(Math.PI * t) / 2;

    // Precompute arc-length table for wiggling (Lissajous) so speed is constant.
    // High resolution (10k samples) + Simpson's rule for accurate integration.
    let wigglingTable: { s: number[]; totalLen: number; n: number; twoLoops: number; a: number; b: number } | null = null;
    if (kind === 'wiggling') {
      const amplitude = max - center;
      const a = amplitude;
      const b = amplitude;
      const n = 10000;
      const twoLoops = 4 * Math.PI;
      const speed = (ang: number) =>
        Math.sqrt(a * a * Math.cos(ang) * Math.cos(ang) + 4 * b * b * Math.cos(2 * ang) * Math.cos(2 * ang));
      const dt = twoLoops / n;
      const sTable: number[] = new Array(n + 1);
      sTable[0] = 0;
      for (let i = 1; i <= n; i++) {
        const a0 = (i - 1) * dt;
        const aMid = a0 + dt / 2;
        const a1 = i * dt;
        sTable[i] = sTable[i - 1]! + (dt / 6) * (speed(a0) + 4 * speed(aMid) + speed(a1));
      }
      wigglingTable = { s: sTable, totalLen: sTable[n]!, n, twoLoops, a, b };
    }

    function segment(t: number, n: number) {
      const clamped = Math.max(0, Math.min(0.999999, t));
      const idx = Math.floor(clamped * n);
      const localT = clamped * n - idx;
      return { idx, localT };
    }

    return (t: number): { x: number; y: number; scale: number } => {
      const e = easeInOut(Math.max(0, Math.min(1, t)));

      if (kind === 'horizontal') {
        const x = lerp(min, max, 0.5 - Math.cos(2 * Math.PI * e) / 2);
        return { x, y: center, scale: 1 };
      }

      if (kind === 'vertical') {
        const y = lerp(min, max, 0.5 - Math.cos(2 * Math.PI * e) / 2);
        return { x: center, y, scale: 1 };
      }

      if (kind === 'forward_backward') {
        const pulse = 0.5 - Math.cos(2 * Math.PI * e) / 2;
        const scale = 0.4 + pulse * 4.0;
        return { x: center, y: center, scale };
      }

      // Wiggling: Lissajous shape, arc-length parameterized (binary search for constant speed).
      if (kind === 'wiggling' && wigglingTable) {
        const { s: sTable, totalLen, n: wN, twoLoops, a, b } = wigglingTable;
        const linearT = Math.max(0, Math.min(1, t));
        const s = linearT * totalLen;
        let lo = 0, hi = wN;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (sTable[mid]! < s) lo = mid + 1;
          else hi = mid;
        }
        const i = Math.max(0, lo - 1);
        const s0 = sTable[i]!;
        const s1 = sTable[i + 1] ?? totalLen;
        const frac = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
        const ang = (i + frac) * (twoLoops / wN);
        const x = center + a * Math.sin(ang);
        const y = center + b * Math.sin(2 * ang);
        return { x, y, scale: 1 };
      }

      if (kind === 'diagonal') {
        const { idx, localT } = segment(e, 4);
        const lt = easeInOut(localT);
        const tl = { x: min, y: min };
        const tr = { x: max, y: min };
        const bl = { x: min, y: max };
        const br = { x: max, y: max };
        const pairs: Array<[{ x: number; y: number }, { x: number; y: number }]> = [
          [tl, br], [tr, bl], [bl, tr], [br, tl],
        ];
        const [aPt, bPt] = pairs[idx]!;
        return { x: lerp(aPt.x, bPt.x, lt), y: lerp(aPt.y, bPt.y, lt), scale: 1 };
      }

      // h_pattern: left vertical (down), cross (to right), right vertical (up)
      {
        const leftX = min;
        const rightX = max;
        const topY = min;
        const midY = center;
        const botY = max;
        const { idx, localT } = segment(e, 3);
        const lt = easeInOut(localT);
        if (idx === 0) return { x: leftX, y: lerp(topY, botY, lt), scale: 1 };
        if (idx === 1) return { x: lerp(leftX, rightX, lt), y: midY, scale: 1 };
        return { x: rightX, y: lerp(botY, topY, lt), scale: 1 };
      }
    };
  }, [kind]);

  useEffect(() => {
    startRef.current = null;
    completedRef.current = false;
    setCountdown(Math.ceil(COUNTDOWN_MS / 1000));
    targetRef.current = null;

    const tick = (now: number) => {
      if (startRef.current == null) startRef.current = now;
      const totalElapsed = now - startRef.current;

      // Countdown phase
      if (totalElapsed < COUNTDOWN_MS) {
        const remaining = Math.ceil((COUNTDOWN_MS - totalElapsed) / 1000);
        setCountdown(remaining);
        setPos({ x: 50, y: 50, scale: 1 });
        targetRef.current = null;
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      setCountdown(0);

      // Animation phase
      const animElapsed = totalElapsed - COUNTDOWN_MS;
      const t = Math.max(0, Math.min(1, animElapsed / durationMs));
      const p = path(t);
      setPos(p);

      targetRef.current = {
        x: (p.x / 100) * window.innerWidth,
        y: (p.y / 100) * window.innerHeight,
      };

      if (t >= 1) {
        if (!completedRef.current) {
          completedRef.current = true;
          targetRef.current = null;
          onComplete();
        }
        return;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      targetRef.current = null;
    };
  }, [durationMs, path, kind, onComplete, targetRef]);

  const kindLabel = kind.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return (
    <div className="absolute inset-0 z-50 bg-black bg-opacity-95 flex items-center justify-center cursor-none">
      <div className="absolute top-10 left-0 right-0 text-center text-gray-400 font-mono pointer-events-none select-none">
        <h2 className="text-xl font-bold mb-2">Calibration Mode</h2>
        <p className="text-sm text-cyan-400 font-bold uppercase tracking-widest mb-2">Exercise: {kindLabel}</p>
        <p className="text-sm">Follow the dot with your eyes. Keep your head still.</p>
      </div>

      {/* Countdown overlay */}
      {countdown > 0 && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center">
          <p className="text-gray-500 text-sm mb-2">Get Ready</p>
          <div className="text-6xl font-bold text-white animate-pulse">{countdown}</div>
          <p className="text-gray-600 text-xs mt-4 uppercase tracking-widest">{kindLabel}</p>
        </div>
      )}

      {/* Animated dot */}
      <div
        className="absolute rounded-full bg-red-500"
        style={{
          left: `${pos.x}%`,
          top: `${pos.y}%`,
          width: '20px',
          height: '20px',
          transform: `translate(-50%, -50%) scale(${pos.scale})`,
          boxShadow: '0 0 15px rgba(255, 0, 0, 0.7)',
          opacity: countdown > 0 ? 0.3 : 1,
          transition: countdown > 0 ? 'opacity 0.3s' : 'none',
        }}
      >
        <div className="absolute inset-0 rounded-full border-2 border-white opacity-50" />
        <div className="absolute inset-[6px] rounded-full bg-black" />
      </div>
    </div>
  );
};

export default EyeMovementLayer;
