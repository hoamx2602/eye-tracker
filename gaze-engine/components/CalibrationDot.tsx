'use client';

/**
 * CalibrationDot — single animated calibration target.
 *
 * Two capture modes:
 *   TIMER     — dot pulses and auto-captures after `dwellMs`
 *   CLICK_HOLD — user holds the dot until the progress ring fills
 */

import React, { useEffect, useRef, useState } from 'react';

export type CalibrationMode = 'TIMER' | 'CLICK_HOLD';

export interface CalibrationDotProps {
  x: number;
  y: number;
  /** Mode controlling how capture is triggered. */
  mode: CalibrationMode;
  /** Time in ms until capture fires (TIMER mode) or ring fills (CLICK_HOLD). */
  dwellMs: number;
  /** Called every animation frame with progress 0→1 during active capture. */
  onProgress?: (progress: number) => void;
  /** Called once when capture completes. */
  onCapture: () => void;
  /** Dot size in px. Default 24. */
  size?: number;
  index?: number;
  total?: number;
}

export default function CalibrationDot({
  x, y, mode, dwellMs, onProgress, onCapture, size = 24, index, total,
}: CalibrationDotProps) {
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(mode === 'TIMER'); // auto-start for TIMER
  const startRef = useRef<number | null>(null);
  const rafRef = useRef(0);
  const firedRef = useRef(false);

  useEffect(() => {
    firedRef.current = false;
    setProgress(0);
    if (mode === 'TIMER') setHolding(true);
  }, [x, y, mode]);

  useEffect(() => {
    if (!holding) { cancelAnimationFrame(rafRef.current); return; }

    const tick = (now: number) => {
      if (!startRef.current) startRef.current = now;
      const elapsed = now - startRef.current;
      const p = Math.min(1, elapsed / dwellMs);
      setProgress(p);
      onProgress?.(p);
      if (p >= 1 && !firedRef.current) {
        firedRef.current = true;
        onCapture();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    startRef.current = null;
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [holding, dwellMs, onProgress, onCapture]);

  // Progress ring geometry
  const r = size / 2;
  const strokeWidth = 3;
  const svgSize = size + strokeWidth * 2;
  const cx = svgSize / 2;
  const circumference = 2 * Math.PI * r;

  // Interpolate colour: red (progress=0) → green (progress=1)
  const hue = Math.round(progress * 120); // 0=red, 120=green
  const dotColor = `hsl(${hue},90%,55%)`;

  const handlers = mode === 'CLICK_HOLD'
    ? {
        onMouseDown:  () => setHolding(true),
        onMouseUp:    () => { setHolding(false); startRef.current = null; },
        onMouseLeave: () => { setHolding(false); startRef.current = null; },
        onTouchStart: () => setHolding(true),
        onTouchEnd:   () => { setHolding(false); startRef.current = null; },
      }
    : {};

  return (
    <div
      style={{
        position: 'fixed',
        left: x - svgSize / 2,
        top:  y - svgSize / 2,
        width: svgSize,
        height: svgSize,
        cursor: mode === 'CLICK_HOLD' ? 'pointer' : 'default',
        userSelect: 'none',
      }}
      {...handlers}
    >
      <svg width={svgSize} height={svgSize}>
        {/* Progress ring */}
        <circle
          cx={cx} cy={cx} r={r}
          fill="none"
          stroke="rgba(255,255,255,0.2)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={cx} cy={cx} r={r}
          fill="none"
          stroke={dotColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          strokeLinecap="round"
          style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%', transition: 'stroke 0.1s' }}
        />
        {/* Centre dot — pulses when active */}
        <circle
          cx={cx} cy={cx} r={r * 0.35}
          fill={dotColor}
          style={{ transform: `scale(${1 + progress * 0.25})`, transformOrigin: '50% 50%', transition: 'transform 0.05s' }}
        />
      </svg>
      {index !== undefined && total !== undefined && (
        <div
          style={{ position: 'absolute', top: svgSize + 4, left: '50%', transform: 'translateX(-50%)', color: 'rgba(255,255,255,0.6)', fontSize: 11, whiteSpace: 'nowrap' }}
        >
          {index + 1} / {total}
        </div>
      )}
    </div>
  );
}
