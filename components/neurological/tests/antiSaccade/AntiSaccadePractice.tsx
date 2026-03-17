'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_MOVEMENT_DURATION_MS,
  OPPOSITE_DIRECTION,
  PRACTICE_TRIALS,
  RECT_HALF_PX,
  TRAVEL_DISTANCE_PX,
  type AntiSaccadeDirection,
} from './constants';
import { generateTrialDirections } from './utils';

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

const DEFAULT_RESTART_DELAY_SEC = 3;
const RESTART_DELAY_MIN = 1;
const RESTART_DELAY_MAX = 4;

function getRestartDelaySec(config?: Record<string, unknown>): number {
  const v = Number(config?.practiceRestartDelaySec);
  if (!Number.isFinite(v)) return DEFAULT_RESTART_DELAY_SEC;
  return Math.max(RESTART_DELAY_MIN, Math.min(RESTART_DELAY_MAX, Math.round(v)));
}

function getMovementDurationMs(config?: Record<string, unknown>): number {
  const v = Number(config?.movementDurationMs);
  if (!Number.isFinite(v) || v < 500) return DEFAULT_MOVEMENT_DURATION_MS;
  return Math.min(10000, v);
}

const DIM_OPACITY_MIN = 0.2;
const DIM_OPACITY_MAX = 0.9;
const DIM_OPACITY_DEFAULT = 0.6;

function getDimRectOpacity(config?: Record<string, unknown>): number {
  const v = Number(config?.dimRectOpacity);
  if (!Number.isFinite(v)) return DIM_OPACITY_DEFAULT;
  return Math.max(DIM_OPACITY_MIN, Math.min(DIM_OPACITY_MAX, v));
}

/**
 * Practice: a few anti-saccade trials, same visual, no recording.
 * Sau khi hết 3 trial, đếm ngược practiceRestartDelaySec (từ config, 1–4 s) rồi tự chạy lại.
 */
export default function AntiSaccadePractice({ config }: { config?: Record<string, unknown> }) {
  const restartDelaySec = getRestartDelaySec(config);
  const movementDurationMs = getMovementDurationMs(config);
  const dimOpacity = getDimRectOpacity(config);
  const directionsRef = useRef(generateTrialDirections(PRACTICE_TRIALS));
  const [trialIndex, setTrialIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [restartIn, setRestartIn] = useState<number | null>(null);
  const movementStartRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const direction = directionsRef.current[trialIndex];
  const primaryOff = direction ? offset(direction, progress, TRAVEL_DISTANCE_PX) : { x: 0, y: 0 };
  const dimOff = direction ? offset(OPPOSITE_DIRECTION[direction], progress, TRAVEL_DISTANCE_PX) : { x: 0, y: 0 };

  // Movement animation (tốc độ = config.movementDurationMs)
  useEffect(() => {
    if (restartIn !== null) return;
    movementStartRef.current = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const elapsed = now - movementStartRef.current;
      const p = Math.min(1, elapsed / movementDurationMs);
      setProgress(p);
      if (p >= 1) {
        if (trialIndex + 1 >= PRACTICE_TRIALS) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          intervalRef.current = null;
          setRestartIn(restartDelaySec);
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
      intervalRef.current = null;
    };
  }, [trialIndex, restartIn, movementDurationMs]);

  // Countdown then restart
  useEffect(() => {
    if (restartIn === null || restartIn <= 0) return;
    const t = setInterval(() => {
      setRestartIn((prev) => {
        if (prev === null || prev <= 0) return null;
        const next = prev - 1;
        if (next === 0) {
          directionsRef.current = generateTrialDirections(PRACTICE_TRIALS);
          setTrialIndex(0);
          setProgress(0);
          movementStartRef.current = performance.now();
          return null;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [restartIn]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[300px]">
      {restartIn !== null ? (
        <p className="text-gray-400 text-sm mb-4">
          Tự động chạy lại mô phỏng sau <strong className="text-amber-400">{restartIn}</strong> giây…
        </p>
      ) : (
        <p className="text-gray-400 text-sm mb-4">
          Follow the <strong className="text-slate-300">dim</strong> rectangle with your eyes. Trial {trialIndex + 1} of {PRACTICE_TRIALS}.
        </p>
      )}
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
          className="absolute bg-slate-500 rounded-lg border border-slate-400"
          style={{
            left: CENTER - RECT_HALF_PX + dimOff.x,
            top: CENTER - RECT_HALF_PX / 2 + dimOff.y,
            width: RECT_HALF_PX * 2,
            height: RECT_HALF_PX,
            opacity: dimOpacity,
          }}
        />
      </div>
    </div>
  );
}
