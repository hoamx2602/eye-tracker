'use client';

import React, { useEffect, useRef, useState } from 'react';
import { DEFAULT_TARGET_DURATION_MS, LEFT_TARGET_X_FRACTION, RIGHT_TARGET_X_FRACTION, type SaccadicTargetSide } from './constants';

/**
 * Practice: a few saccadic cycles (left/right), no recording.
 *
 * Laid out inside the practice gate rather than over it. As a full-screen
 * layer it covered the amber banner, frame and watermark, so this was the one
 * practice round that looked exactly like the recorded test — the opposite of
 * what the practice framing is for.
 */
export default function SaccadicPractice() {
  const [cycleIndex, setCycleIndex] = useState(0);
  const cycleStartRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const targetSide: SaccadicTargetSide = cycleIndex % 2 === 0 ? 'left' : 'right';
  // Percentage of the practice area, mirroring the fractions the real test
  // uses across the full viewport.
  const targetLeftPct =
    (targetSide === 'left' ? LEFT_TARGET_X_FRACTION : RIGHT_TARGET_X_FRACTION) * 100;

  useEffect(() => {
    cycleStartRef.current = performance.now();
    const id = setInterval(() => {
      const elapsed = performance.now() - cycleStartRef.current;
      if (elapsed >= DEFAULT_TARGET_DURATION_MS) {
        setCycleIndex((i) => i + 1);
        cycleStartRef.current = performance.now();
      }
    }, 50);
    intervalRef.current = id;
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [cycleIndex]);

  return (
    <div
      className="flex flex-col items-center justify-center min-h-[280px] w-full"
      role="region"
      aria-label="Saccadic practice: look at the target when it appears"
    >
      <p className="text-center text-gray-400 text-sm mb-4">
        A target appears on one side, then the other. Look at it as soon as it appears.
      </p>
      <div className="relative w-full max-w-2xl h-64">
        <div
          className="absolute w-16 h-16 rounded-full bg-amber-400 border-4 border-amber-300 shadow-lg"
          style={{
            left: `${targetLeftPct}%`,
            top: '50%',
            transform: 'translate(-50%, -50%)',
            transition: 'left 0.06s linear',
          }}
          aria-hidden
        />
      </div>
    </div>
  );
}
