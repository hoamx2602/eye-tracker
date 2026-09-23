'use client';

import React, { useEffect, useState } from 'react';
import {
  DEFAULT_FIXATION_MAX_MS,
  DEFAULT_FIXATION_MIN_MS,
  DEFAULT_TARGET_DURATION_MS,
  LEFT_TARGET_X_FRACTION,
  RIGHT_TARGET_X_FRACTION,
  type SaccadicTargetSide,
} from './constants';
import { randomFixationMs } from './utils';

/**
 * Practice: the same centre-dot → target sequence as the real test, with the
 * same random side and random wait, no recording.
 *
 * Laid out inside the practice gate rather than over it. As a full-screen
 * layer it covered the amber banner, frame and watermark, so this was the one
 * practice round that looked exactly like the recorded test — the opposite of
 * what the practice framing is for.
 */
export default function SaccadicPractice() {
  const [cycleIndex, setCycleIndex] = useState(0);
  const [phase, setPhase] = useState<'fixation' | 'target'>('fixation');
  const [side, setSide] = useState<SaccadicTargetSide>('left');

  useEffect(() => {
    const id =
      phase === 'fixation'
        ? setTimeout(() => {
            setSide(Math.random() < 0.5 ? 'left' : 'right');
            setPhase('target');
          }, randomFixationMs(DEFAULT_FIXATION_MIN_MS, DEFAULT_FIXATION_MAX_MS))
        : setTimeout(() => {
            setPhase('fixation');
            setCycleIndex((i) => i + 1);
          }, DEFAULT_TARGET_DURATION_MS);
    return () => clearTimeout(id);
  }, [phase, cycleIndex]);

  // Percentage of the practice area, mirroring the fractions the real test
  // uses across the full viewport.
  const targetLeftPct = (side === 'left' ? LEFT_TARGET_X_FRACTION : RIGHT_TARGET_X_FRACTION) * 100;

  return (
    <div
      className="flex flex-col items-center justify-center min-h-[280px] w-full"
      role="region"
      aria-label="Saccadic practice: look at the target when it appears"
    >
      <p className="text-center text-gray-400 text-sm mb-4">
        Look at the centre dot. When a target appears on either side, look at it as quickly as you can.
      </p>
      <div className="relative w-full max-w-2xl h-64">
        {phase === 'fixation' ? (
          <div
            className="absolute w-3.5 h-3.5 rounded-full bg-gray-200"
            style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
            aria-hidden
          />
        ) : (
          <div
            className="absolute w-16 h-16 rounded-full bg-amber-400 border-4 border-amber-300 shadow-lg"
            style={{ left: `${targetLeftPct}%`, top: '50%', transform: 'translate(-50%, -50%)' }}
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}
