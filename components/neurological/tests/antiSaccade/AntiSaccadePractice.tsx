'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_MOVEMENT_DURATION_MS,
  OPPOSITE_DIRECTION,
  RECT_HALF_PX,
  TRAVEL_DISTANCE_PX,
  type AntiSaccadeDirection,
} from './constants';
import { generateTrialDirections } from './utils';

const PRACTICE_TRIALS = 3;
const BOX_SIZE = 360;
const CENTER = BOX_SIZE / 2;

function offset(d: AntiSaccadeDirection, progress: number, travel: number): { x: number; y: number } {
  const dpx = progress * travel;
  switch (d) {
    case 'left': return { x: -dpx, y: 0 };
    case 'right': return { x: dpx, y: 0 };
    case 'up': return { x: 0, y: -dpx };
    case 'down': return { x: 0, y: dpx };
    default: return { x: 0, y: 0 };
  }
}

/**
 * Practice: a few anti-saccade trials, same visual, no recording.
 */
export default function AntiSaccadePractice() {
  const directions = useRef(generateTrialDirections(PRACTICE_TRIALS)).current;
  const [trialIndex, setTrialIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const movementStartRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const direction = directions[trialIndex];
  const primaryOff = direction ? offset(direction, progress, TRAVEL_DISTANCE_PX) : { x: 0, y: 0 };
  const dimOff = direction ? offset(OPPOSITE_DIRECTION[direction], progress, TRAVEL_DISTANCE_PX) : { x: 0, y: 0 };

  useEffect(() => {
    movementStartRef.current = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const elapsed = now - movementStartRef.current;
      const p = Math.min(1, elapsed / DEFAULT_MOVEMENT_DURATION_MS);
      setProgress(p);
      if (p >= 1) {
        if (trialIndex + 1 >= PRACTICE_TRIALS) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          return;
        }
        setTrialIndex((i) => i + 1);
        setProgress(0);
        movementStartRef.current = performance.now();
      }
    }, 30);
    intervalRef.current = id;
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [trialIndex]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[300px]">
      <p className="text-gray-400 text-sm mb-4">
        Follow the <strong className="text-slate-300">dim</strong> rectangle with your eyes. Trial {trialIndex + 1} of {PRACTICE_TRIALS}.
      </p>
      <div className="relative rounded-xl overflow-hidden bg-gray-900" style={{ width: BOX_SIZE, height: BOX_SIZE }}>
        <div
          className="absolute bg-blue-400 rounded-lg border-2 border-blue-300"
          style={{
            left: CENTER - RECT_HALF_PX + primaryOff.x,
            top: CENTER - RECT_HALF_PX / 2 + primaryOff.y,
            width: RECT_HALF_PX * 2,
            height: RECT_HALF_PX,
          }}
        />
        <div
          className="absolute bg-slate-500 rounded-lg border border-slate-400 opacity-60"
          style={{
            left: CENTER - RECT_HALF_PX + dimOff.x,
            top: CENTER - RECT_HALF_PX / 2 + dimOff.y,
            width: RECT_HALF_PX * 2,
            height: RECT_HALF_PX,
          }}
        />
      </div>
    </div>
  );
}
