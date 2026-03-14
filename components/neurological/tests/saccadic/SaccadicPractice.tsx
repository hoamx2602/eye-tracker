'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_TARGET_DURATION_MS,
  PRACTICE_CYCLES,
  type SaccadicTargetSide,
} from './constants';
import { getTargetPosition } from './utils';

function getViewport(): { w: number; h: number } {
  if (typeof window === 'undefined') return { w: 400, h: 300 };
  return { w: window.innerWidth, h: window.innerHeight };
}

/**
 * Practice: a few saccadic cycles (left/right), no recording.
 */
export default function SaccadicPractice() {
  const viewport = getViewport();
  const [cycleIndex, setCycleIndex] = useState(0);
  const cycleStartRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const targetSide: SaccadicTargetSide = cycleIndex % 2 === 0 ? 'left' : 'right';
  const targetPos = getTargetPosition(targetSide, viewport.w, viewport.h);

  useEffect(() => {
    cycleStartRef.current = performance.now();
    const id = setInterval(() => {
      const elapsed = performance.now() - cycleStartRef.current;
      if (elapsed >= DEFAULT_TARGET_DURATION_MS) {
        if (cycleIndex + 1 >= PRACTICE_CYCLES) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          return;
        }
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
    <div className="flex flex-col items-center justify-center min-h-[280px]">
      <p className="text-gray-400 text-sm mb-4">
        Look at the target when it appears. Cycle {cycleIndex + 1} of {PRACTICE_CYCLES} ({targetSide}).
      </p>
      <div className="relative w-full max-w-md h-48">
        <div
          className="absolute w-12 h-12 rounded-full bg-amber-400 border-4 border-amber-300"
          style={{
            left: targetPos.x - 24,
            top: targetPos.y - 24,
          }}
        />
      </div>
    </div>
  );
}
