import React, { useEffect, useRef, useMemo, useState } from 'react';
import { EyeMovementKind } from '../types';

interface EyeMovementLayerProps {
  kind: EyeMovementKind;
  /** Ref updated each frame with current dot position in screen pixels (for data collection) */
  targetRef: React.MutableRefObject<{ x: number; y: number } | null>;
  onComplete: () => void;
}

const COUNTDOWN_MS = 2000;
const PAD = 12;
const MIN = PAD;
const MAX = 100 - PAD;
const CENTER = 50;
const RANGE = MAX - MIN;

const TARGET_SPEED = 25;

const H_PAUSE_MS = 1000;
const ENDPOINT_PAUSE_MS = 1000;

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

const EyeMovementLayer: React.FC<EyeMovementLayerProps> = ({ kind, targetRef, onComplete }) => {
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const completedRef = useRef(false);
  const dotRef = useRef<HTMLDivElement>(null);
  const lastCountdownRef = useRef(-1);
  const viewportRef = useRef({ width: 0, height: 0 });
  const [countdown, setCountdown] = useState(Math.ceil(COUNTDOWN_MS / 1000));

  const { path, durationMs } = useMemo(() => {
    const tl = { x: MIN, y: MIN };
    const tr = { x: MAX, y: MIN };
    const bl = { x: MIN, y: MAX };
    const br = { x: MAX, y: MAX };
    const midL = { x: MIN, y: CENTER };
    const midR = { x: MAX, y: CENTER };

    // --- Horizontal: 2 rounds — pause left → move right → pause → move left → (repeat) ---
    if (kind === 'horizontal') {
      const oneMoveMs = (RANGE / TARGET_SPEED) * 1000;
      const totalMoveMs = 4 * oneMoveMs; // 4 moves (2 rounds)
      const totalPauseMs = 5 * ENDPOINT_PAUSE_MS; // 5 pauses
      const dur = totalMoveMs + totalPauseMs;
      const pauseFrac = ENDPOINT_PAUSE_MS / dur;
      const moveFrac = oneMoveMs / dur;
      const segs: Array<{ type: 'pause'; pos: { x: number; y: number }; durFrac: number } | { type: 'move'; from: { x: number; y: number }; to: { x: number; y: number }; durFrac: number }> = [
        { type: 'pause', pos: { x: MIN, y: CENTER }, durFrac: pauseFrac },
        { type: 'move', from: { x: MIN, y: CENTER }, to: { x: MAX, y: CENTER }, durFrac: moveFrac },
        { type: 'pause', pos: { x: MAX, y: CENTER }, durFrac: pauseFrac },
        { type: 'move', from: { x: MAX, y: CENTER }, to: { x: MIN, y: CENTER }, durFrac: moveFrac },
        { type: 'pause', pos: { x: MIN, y: CENTER }, durFrac: pauseFrac },
        { type: 'move', from: { x: MIN, y: CENTER }, to: { x: MAX, y: CENTER }, durFrac: moveFrac },
        { type: 'pause', pos: { x: MAX, y: CENTER }, durFrac: pauseFrac },
        { type: 'move', from: { x: MAX, y: CENTER }, to: { x: MIN, y: CENTER }, durFrac: moveFrac },
        { type: 'pause', pos: { x: MIN, y: CENTER }, durFrac: pauseFrac },
      ];
      const fn = (t: number) => {
        const lt = Math.max(0, Math.min(1, t));
        let acc = 0;
        for (const seg of segs) {
          if (lt <= acc + seg.durFrac) {
            const local = seg.durFrac > 0 ? (lt - acc) / seg.durFrac : 0;
            if (seg.type === 'pause') return { ...seg.pos, scale: 1 };
            return { x: lerp(seg.from.x, seg.to.x, local), y: lerp(seg.from.y, seg.to.y, local), scale: 1 };
          }
          acc += seg.durFrac;
        }
        return { x: MIN, y: CENTER, scale: 1 };
      };
      return { path: fn, durationMs: dur };
    }

    // --- Vertical: 2 rounds — pause top → move down → pause → move up → (repeat) ---
    if (kind === 'vertical') {
      const oneMoveMs = (RANGE / TARGET_SPEED) * 1000;
      const totalMoveMs = 4 * oneMoveMs; // 4 moves (2 rounds)
      const totalPauseMs = 5 * ENDPOINT_PAUSE_MS; // 5 pauses
      const dur = totalMoveMs + totalPauseMs;
      const pauseFrac = ENDPOINT_PAUSE_MS / dur;
      const moveFrac = oneMoveMs / dur;
      const segs: Array<{ type: 'pause'; pos: { x: number; y: number }; durFrac: number } | { type: 'move'; from: { x: number; y: number }; to: { x: number; y: number }; durFrac: number }> = [
        { type: 'pause', pos: { x: CENTER, y: MIN }, durFrac: pauseFrac },
        { type: 'move', from: { x: CENTER, y: MIN }, to: { x: CENTER, y: MAX }, durFrac: moveFrac },
        { type: 'pause', pos: { x: CENTER, y: MAX }, durFrac: pauseFrac },
        { type: 'move', from: { x: CENTER, y: MAX }, to: { x: CENTER, y: MIN }, durFrac: moveFrac },
        { type: 'pause', pos: { x: CENTER, y: MIN }, durFrac: pauseFrac },
        { type: 'move', from: { x: CENTER, y: MIN }, to: { x: CENTER, y: MAX }, durFrac: moveFrac },
        { type: 'pause', pos: { x: CENTER, y: MAX }, durFrac: pauseFrac },
        { type: 'move', from: { x: CENTER, y: MAX }, to: { x: CENTER, y: MIN }, durFrac: moveFrac },
        { type: 'pause', pos: { x: CENTER, y: MIN }, durFrac: pauseFrac },
      ];
      const fn = (t: number) => {
        const lt = Math.max(0, Math.min(1, t));
        let acc = 0;
        for (const seg of segs) {
          if (lt <= acc + seg.durFrac) {
            const local = seg.durFrac > 0 ? (lt - acc) / seg.durFrac : 0;
            if (seg.type === 'pause') return { ...seg.pos, scale: 1 };
            return { x: lerp(seg.from.x, seg.to.x, local), y: lerp(seg.from.y, seg.to.y, local), scale: 1 };
          }
          acc += seg.durFrac;
        }
        return { x: CENTER, y: MIN, scale: 1 };
      };
      return { path: fn, durationMs: dur };
    }

    // --- Forward / backward: zoom in/out at center ---
    if (kind === 'forward_backward') {
      const dur = 7000;
      const easeInOut = (t: number) => 0.5 - Math.cos(Math.PI * t) / 2;
      const fn = (t: number) => {
        const e = easeInOut(Math.max(0, Math.min(1, t)));
        const pulse = 0.5 - Math.cos(2 * Math.PI * e) / 2;
        const scale = 0.4 + pulse * 4.0;
        return { x: CENTER, y: CENTER, scale };
      };
      return { path: fn, durationMs: dur };
    }

    // --- Wiggling: Lissajous, arc-length parameterized ---
    if (kind === 'wiggling') {
      const amplitude = MAX - CENTER;
      const a = amplitude;
      const b = amplitude;
      const n = 10000;
      const oneLoop = 2 * Math.PI;
      const speedFn = (ang: number) =>
        Math.sqrt(a * a * Math.cos(ang) * Math.cos(ang) + 4 * b * b * Math.cos(2 * ang) * Math.cos(2 * ang));
      const dt = oneLoop / n;
      const sTable: number[] = new Array(n + 1);
      sTable[0] = 0;
      for (let i = 1; i <= n; i++) {
        const a0 = (i - 1) * dt;
        const aMid = a0 + dt / 2;
        const a1 = i * dt;
        sTable[i] = sTable[i - 1]! + (dt / 6) * (speedFn(a0) + 4 * speedFn(aMid) + speedFn(a1));
      }
      const totalLen = sTable[n]!;
      const dur = (totalLen / TARGET_SPEED) * 1000;

      const fn = (t: number) => {
        const linearT = Math.max(0, Math.min(1, t));
        const s = linearT * totalLen;
        let lo = 0, hi = n;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (sTable[mid]! < s) lo = mid + 1;
          else hi = mid;
        }
        const i = Math.max(0, lo - 1);
        const s0 = sTable[i]!;
        const s1 = sTable[i + 1] ?? totalLen;
        const frac = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
        const ang = (i + frac) * (oneLoop / n);
        return { x: CENTER + a * Math.sin(ang), y: CENTER + b * Math.sin(2 * ang), scale: 1 };
      };
      return { path: fn, durationMs: dur };
    }

    // --- Diagonal: TL→BR, BR→TL, TL→TR, TR→BL, BL→TR with 1s pause at each endpoint ---
    if (kind === 'diagonal') {
      const segs: Array<[{ x: number; y: number }, { x: number; y: number }]> = [
        [tl, br], [br, tl], [tl, tr], [tr, bl], [bl, tr],
      ];
      const lengths = segs.map(([a, b]) => dist(a, b));
      const totalMoveMs = (lengths.reduce((s, l) => s + l, 0) / TARGET_SPEED) * 1000;
      const totalPauseMs = 6 * ENDPOINT_PAUSE_MS; // start + after each of 5 segments
      const dur = totalMoveMs + totalPauseMs;

      type Seg = { type: 'pause'; pos: { x: number; y: number }; durFrac: number } | { type: 'move'; from: { x: number; y: number }; to: { x: number; y: number }; durFrac: number };
      const timeline: Seg[] = [];
      for (let i = 0; i < segs.length; i++) {
        timeline.push({ type: 'pause', pos: segs[i]![0], durFrac: ENDPOINT_PAUSE_MS / dur });
        timeline.push({ type: 'move', from: segs[i]![0], to: segs[i]![1], durFrac: (lengths[i]! / TARGET_SPEED * 1000) / dur });
      }
      timeline.push({ type: 'pause', pos: segs[segs.length - 1]![1], durFrac: ENDPOINT_PAUSE_MS / dur });

      const fn = (t: number) => {
        const lt = Math.max(0, Math.min(1, t));
        let acc = 0;
        for (const seg of timeline) {
          if (lt <= acc + seg.durFrac) {
            const local = seg.durFrac > 0 ? (lt - acc) / seg.durFrac : 0;
            if (seg.type === 'pause') return { ...seg.pos, scale: 1 };
            return { x: lerp(seg.from.x, seg.to.x, local), y: lerp(seg.from.y, seg.to.y, local), scale: 1 };
          }
          acc += seg.durFrac;
        }
        return { ...segs[segs.length - 1]![1], scale: 1 };
      };
      return { path: fn, durationMs: dur };
    }

    // --- H-pattern: pause 1s at each keypoint, move linearly between them ---
    // TL → BL → midL → midR → BR → TR (draws an H)
    {
      const waypoints = [tl, bl, midL, midR, br, tr];
      const moveLengths: number[] = [];
      for (let i = 0; i < waypoints.length - 1; i++) {
        moveLengths.push(dist(waypoints[i]!, waypoints[i + 1]!));
      }
      const totalMoveDist = moveLengths.reduce((s, l) => s + l, 0);
      const moveTimeMs = (totalMoveDist / TARGET_SPEED) * 1000;
      const pauseCount = waypoints.length; // pause at each waypoint
      const totalPauseMs = pauseCount * H_PAUSE_MS;
      const dur = moveTimeMs + totalPauseMs;

      // Build timeline: [pause, move, pause, move, ..., pause]
      type Seg = { type: 'pause'; pos: { x: number; y: number }; durFrac: number }
               | { type: 'move'; from: { x: number; y: number }; to: { x: number; y: number }; durFrac: number };
      const timeline: Seg[] = [];
      for (let i = 0; i < waypoints.length; i++) {
        timeline.push({ type: 'pause', pos: waypoints[i]!, durFrac: H_PAUSE_MS / dur });
        if (i < waypoints.length - 1) {
          const moveDur = (moveLengths[i]! / TARGET_SPEED) * 1000;
          timeline.push({ type: 'move', from: waypoints[i]!, to: waypoints[i + 1]!, durFrac: moveDur / dur });
        }
      }

      const fn = (t: number) => {
        const lt = Math.max(0, Math.min(1, t));
        let acc = 0;
        for (const seg of timeline) {
          if (lt <= acc + seg.durFrac) {
            const local = seg.durFrac > 0 ? (lt - acc) / seg.durFrac : 0;
            if (seg.type === 'pause') {
              return { x: seg.pos.x, y: seg.pos.y, scale: 1 };
            }
            return { x: lerp(seg.from.x, seg.to.x, local), y: lerp(seg.from.y, seg.to.y, local), scale: 1 };
          }
          acc += seg.durFrac;
        }
        const last = waypoints[waypoints.length - 1]!;
        return { x: last.x, y: last.y, scale: 1 };
      };
      return { path: fn, durationMs: dur };
    }
  }, [kind]);

  useEffect(() => {
    const updateViewport = () => {
      viewportRef.current = {
        width: window.innerWidth,
        height: window.innerHeight,
      };
    };
    updateViewport();
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  useEffect(() => {
    startRef.current = null;
    completedRef.current = false;
    lastCountdownRef.current = -1;
    setCountdown(Math.ceil(COUNTDOWN_MS / 1000));
    targetRef.current = null;

    const tick = (now: number) => {
      if (startRef.current == null) startRef.current = now;
      const totalElapsed = now - startRef.current;
      const dot = dotRef.current;

      if (totalElapsed < COUNTDOWN_MS) {
        const remaining = Math.ceil((COUNTDOWN_MS - totalElapsed) / 1000);
        if (remaining !== lastCountdownRef.current) {
          lastCountdownRef.current = remaining;
          setCountdown(remaining);
        }
        if (dot) {
          const cx = viewportRef.current.width * 0.5;
          const cy = viewportRef.current.height * 0.5;
          dot.style.transform = `translate3d(${cx}px, ${cy}px, 0) translate(-50%, -50%) scale(1)`;
          dot.style.opacity = '0.3';
        }
        targetRef.current = null;
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      if (lastCountdownRef.current !== 0) {
        lastCountdownRef.current = 0;
        setCountdown(0);
      }

      const animElapsed = totalElapsed - COUNTDOWN_MS;
      const t = Math.max(0, Math.min(1, animElapsed / durationMs));
      const p = path(t);
      const w = viewportRef.current.width || window.innerWidth;
      const h = viewportRef.current.height || window.innerHeight;
      const px = (p.x / 100) * w;
      const py = (p.y / 100) * h;

      if (dot) {
        dot.style.transform = `translate3d(${px}px, ${py}px, 0) translate(-50%, -50%) scale(${p.scale})`;
        dot.style.opacity = '1';
      }

      targetRef.current = {
        x: px,
        y: py,
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

      {countdown > 0 && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center">
          <p className="text-gray-500 text-sm mb-2">Get Ready</p>
          <div className="text-6xl font-bold text-white animate-pulse">{countdown}</div>
          <p className="text-gray-600 text-xs mt-4 uppercase tracking-widest">{kindLabel}</p>
        </div>
      )}

      <div
        ref={dotRef}
        className="rounded-full bg-red-500"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '20px',
          height: '20px',
          transform: 'translate3d(-50%, -50%, 0) scale(1)',
          boxShadow: '0 0 15px rgba(255, 0, 0, 0.7)',
          opacity: 0,
          willChange: 'transform, opacity',
          contain: 'layout style paint',
        }}
      >
        <div className="absolute inset-0 rounded-full border-2 border-white opacity-50" />
        <div className="absolute inset-[6px] rounded-full bg-black" />
      </div>
    </div>
  );
};

export default EyeMovementLayer;
