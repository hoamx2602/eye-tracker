'use client';

/**
 * CalibrationScreen — orchestrates the full calibration UI.
 *
 * Generates a grid of target points, cycles through them,
 * calls useCalibration().pushSample() on each video frame,
 * and trains the engine when all points are collected.
 *
 * Stateless with respect to the engine — it delegates entirely to useCalibration().
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import CalibrationDot, { type CalibrationMode } from './CalibrationDot';
import { useCalibration } from '../hooks/useCalibration';
import type { CleanCalibrationOptions } from '../services/CalibrationStore';
import type { CalibrationResult } from '../hooks/useCalibration';

// ─── Grid generation ──────────────────────────────────────────────────────────

function generateGrid(count: number, pad = 0.08): { x: number; y: number }[] {
  const cols = Math.round(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const points: { x: number; y: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (points.length >= count) break;
      points.push({
        x: window.innerWidth  * (pad + (c / (cols - 1)) * (1 - 2 * pad)),
        y: window.innerHeight * (pad + (r / (rows - 1)) * (1 - 2 * pad)),
      });
    }
  }
  return points;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CalibrationScreenProps {
  /** Number of grid points. Default 9. */
  pointCount?: number;
  /** Time the user must dwell on each point (ms). Default 1500. */
  dwellMs?: number;
  /** Capture mode. Default 'TIMER'. */
  mode?: CalibrationMode;
  /** Called with LOOCV metrics when training completes. */
  onComplete?: (result: CalibrationResult) => void;
  /** Called if training fails. */
  onError?: (err: string) => void;
  /** Extra options passed to CalibrationStore.buildSamples(). */
  cleanOpts?: CleanCalibrationOptions;
  /** Feature vector builder called on each frame — provided by parent (needs EyeFeatures). */
  getFeatureVector: () => number[] | null;
}

export default function CalibrationScreen({
  pointCount = 9,
  dwellMs = 1500,
  mode = 'TIMER',
  onComplete,
  onError,
  cleanOpts,
  getFeatureVector,
}: CalibrationScreenProps) {
  const { beginPoint, pushSample, train, state } = useCalibration();

  const [points] = useState(() => generateGrid(pointCount));
  const [current, setCurrent] = useState(0);
  const [done, setDone] = useState(false);

  // rAF-based sample collection while a point is active
  const collectingRef = useRef(false);
  const rafRef = useRef(0);

  const startCollecting = useCallback(() => {
    collectingRef.current = true;
    const tick = () => {
      if (!collectingRef.current) return;
      const vec = getFeatureVector();
      if (vec) pushSample(vec);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [getFeatureVector, pushSample]);

  const stopCollecting = useCallback(() => {
    collectingRef.current = false;
    cancelAnimationFrame(rafRef.current);
  }, []);

  // When current point index changes → begin new point
  // TIMER: start collecting immediately (user should already be looking at the dot)
  // CLICK_HOLD: only register the point target; collecting starts on hold via onHoldStart
  useEffect(() => {
    if (done || current >= points.length) return;
    const p = points[current];
    beginPoint(p.x, p.y, `Point ${current + 1}`);
    if (mode === 'TIMER') {
      startCollecting();
      return stopCollecting;
    }
  }, [current, done]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCapture = useCallback(async () => {
    stopCollecting();
    const next = current + 1;

    if (next < points.length) {
      setCurrent(next);
    } else {
      // All points collected — train
      setDone(true);
      try {
        const result = await train(cleanOpts);
        onComplete?.(result);
      } catch (err) {
        onError?.(err instanceof Error ? err.message : String(err));
      }
    }
  }, [current, points.length, stopCollecting, train, cleanOpts, onComplete, onError]);

  if (done || state === 'training') {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gray-950 text-white gap-4">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-lg font-semibold">Training gaze model…</p>
        <p className="text-sm text-gray-400">This takes a few seconds</p>
      </div>
    );
  }

  const pt = points[current];
  if (!pt) return null;

  return (
    <div className="fixed inset-0 z-50 bg-gray-950">
      <div className="fixed top-6 left-1/2 -translate-x-1/2 text-white/70 text-sm select-none">
        {mode === 'TIMER'
          ? 'Look at each dot until it turns green'
          : 'Hold each dot until the ring fills'}
      </div>
      <CalibrationDot
        key={current}
        x={pt.x}
        y={pt.y}
        mode={mode}
        dwellMs={dwellMs}
        onCapture={handleCapture}
        onHoldStart={mode === 'CLICK_HOLD' ? startCollecting : undefined}
        onHoldEnd={mode === 'CLICK_HOLD' ? stopCollecting : undefined}
        index={current}
        total={points.length}
      />
    </div>
  );
}
