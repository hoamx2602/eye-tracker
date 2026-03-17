'use client';

import React, { useEffect, useRef, useState } from 'react';
import { DEFAULT_TARGET_DURATION_MS, type SaccadicTargetSide } from './constants';
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
      className="fixed inset-0 z-50 flex flex-col bg-gray-950"
      role="region"
      aria-label="Saccadic practice: look at the target when it appears"
    >
      <p className="text-center text-gray-400 text-sm pt-4 pb-2">
        Look at the target when it appears.
      </p>
      <div
        className="absolute w-16 h-16 rounded-full bg-amber-400 border-4 border-amber-300 shadow-lg"
        style={{
          left: targetPos.x - 32,
          top: targetPos.y - 32,
        }}
        aria-hidden
      />
    </div>
  );
}
