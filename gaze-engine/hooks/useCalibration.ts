'use client';

/**
 * useCalibration — manages the calibration state machine.
 *
 * State machine:
 *   idle → collecting → (all points done) → training → done
 *                                                    ↘ error
 *
 * The hook is engine-agnostic: it calls engine.calibrate() with
 * CalibrationSample[] built by CalibrationStore.
 */

import { useCallback, useRef, useState } from 'react';
import { useGazeContext } from '../providers/GazeProvider';
import { CalibrationStore } from '../services/CalibrationStore';
import type { CleanCalibrationOptions } from '../services/CalibrationStore';
import type { LOOCVMetrics } from '../core/IGazeEngine';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CalibrationState = 'idle' | 'collecting' | 'training' | 'done' | 'error';

export interface CalibrationResult {
  loocv: LOOCVMetrics;
  sampleCount: number;
}

export interface UseCalibrationReturn {
  state: CalibrationState;
  result: CalibrationResult | null;
  error: string | null;
  store: CalibrationStore;

  /** Call when the user starts looking at a new calibration point. */
  beginPoint: (screenX: number, screenY: number, label?: string) => void;

  /**
   * Push a feature vector captured from the current point.
   * Call this on each video frame during the dwell period.
   */
  pushSample: (featureVector: number[]) => void;

  /**
   * Finish collection and train the engine's regression model.
   * Resolves with LOOCV metrics on success.
   */
  train: (opts?: CleanCalibrationOptions) => Promise<CalibrationResult>;

  /**
   * Re-train with updated feature flags using stored raw features.
   * No camera input needed — instant re-evaluation.
   */
  reEvaluate: (opts?: CleanCalibrationOptions) => Promise<CalibrationResult>;

  /** Reset to idle, clearing all collected data. */
  reset: () => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useCalibration(): UseCalibrationReturn {
  const { engine, markCalibrated, resetCalibration } = useGazeContext();
  const [state, setState]   = useState<CalibrationState>('idle');
  const [result, setResult] = useState<CalibrationResult | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const storeRef = useRef(new CalibrationStore());

  const beginPoint = useCallback((x: number, y: number, label?: string) => {
    if (state !== 'collecting' && state !== 'idle') return;
    setState('collecting');
    storeRef.current.addPoint(x, y, label);
  }, [state]);

  const pushSample = useCallback((vec: number[]) => {
    storeRef.current.pushVector(vec);
  }, []);

  const train = useCallback(async (opts?: CleanCalibrationOptions): Promise<CalibrationResult> => {
    if (!engine) throw new Error('No engine active');
    setState('training');
    setError(null);
    try {
      const samples = storeRef.current.buildSamples(opts);
      if (samples.length < 5) throw new Error(`Too few calibration points (${samples.length}, need ≥5)`);

      const loocv = await engine.calibrate(samples);
      const res: CalibrationResult = { loocv, sampleCount: samples.length };
      setResult(res);
      setState('done');
      markCalibrated();
      return res;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setState('error');
      throw err;
    }
  }, [engine, markCalibrated]);

  const reEvaluate = useCallback(async (opts?: CleanCalibrationOptions): Promise<CalibrationResult> => {
    if (!engine?.reEvaluate) throw new Error('Engine does not support re-evaluation');
    setState('training');
    try {
      const samples = storeRef.current.rebuildWithFlags(opts?.flags ?? {}, opts);
      const loocv = await engine.reEvaluate(samples);
      const res: CalibrationResult = { loocv, sampleCount: samples.length };
      setResult(res);
      setState('done');
      return res;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setState('error');
      throw err;
    }
  }, [engine]);

  const reset = useCallback(() => {
    storeRef.current.reset();
    setState('idle');
    setResult(null);
    setError(null);
    resetCalibration();
  }, [resetCalibration]);

  return {
    state, result, error,
    store: storeRef.current,
    beginPoint, pushSample, train, reEvaluate, reset,
  };
}
