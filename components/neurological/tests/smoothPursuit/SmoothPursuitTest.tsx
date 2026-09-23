'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useTestRunner } from '../../TestRunnerContext';
import { useNeuroGaze } from '../../NeuroGazeContext';
import {
  ANALYSIS_SKIP_CYCLES,
  DEFAULT_AMPLITUDE_FRAC,
  DEFAULT_CYCLES,
  DEFAULT_DOT_COLOR,
  DEFAULT_DOT_SIZE_PX,
  DEFAULT_FREQUENCY_HZ,
  DEFAULT_START_FIXATION_MS,
  GAZE_SAMPLE_INTERVAL_MS,
} from './constants';
import { neuroLiveGazeRef } from '@/lib/neuroLiveGaze';
import { analysePursuit, type PursuitAnalysis } from '@/lib/oculomotorMetrics';

export interface SmoothPursuitResult {
  startTime: number;
  endTime: number;
  /** First painted frame of the motion (performance.now clock). */
  motionStart: number;
  frequencyHz: number;
  cycles: number;
  amplitudePx: number;
  centerX: number;
  centerY: number;
  /** 10 Hz smoothed gaze with the target position, for previews. `t` = s from motionStart. */
  gazeSamples: Array<{ t: number; x: number; y: number; targetX: number }>;
  viewportWidth: number;
  viewportHeight: number;
  metrics: PursuitAnalysis;
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.max(min, Math.min(max, n)) : fallback;
}

export default function SmoothPursuitTest() {
  const { config, completeTest, getGazeFrames } = useTestRunner();
  useNeuroGaze();

  const frequencyHz = num(config.frequencyHz, DEFAULT_FREQUENCY_HZ, 0.1, 1);
  const cycles = Math.round(num(config.cycles, DEFAULT_CYCLES, 2, 12));
  const amplitudeFrac = num(config.amplitudeFrac, DEFAULT_AMPLITUDE_FRAC, 0.1, 0.4);
  const startFixationMs = num(config.startFixationMs, DEFAULT_START_FIXATION_MS, 300, 3000);
  const dotSizePx = Math.round(num(config.dotSizePx, DEFAULT_DOT_SIZE_PX, 8, 48));
  const dotColor = /^#[0-9A-Fa-f]{6}$/.test(String(config.dotColor ?? '')) ? String(config.dotColor) : DEFAULT_DOT_COLOR;
  const gazeIntervalMs = Math.max(16, Number(config.gazeSampleIntervalMs) || GAZE_SAMPLE_INTERVAL_MS);

  const [viewport] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1440,
    h: typeof window !== 'undefined' ? window.innerHeight : 900,
  }));
  const cx = viewport.w / 2;
  const cy = viewport.h / 2;
  const amplitudePx = amplitudeFrac * viewport.w;
  const periodMs = 1000 / frequencyHz;
  const motionMs = cycles * periodMs;

  const dotRef = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState(false);
  const completeRef = useRef(completeTest);
  completeRef.current = completeTest;
  const getFramesRef = useRef(getGazeFrames);
  getFramesRef.current = getGazeFrames;

  useEffect(() => {
    const startTime = performance.now();
    let motionStart: number | null = null;
    let raf = 0;
    const samples: SmoothPursuitResult['gazeSamples'] = [];
    const w = (2 * Math.PI) / periodMs;
    const targetAt = (t: number) => cx + amplitudePx * Math.sin(w * (t - (motionStart ?? t)));

    // Position is set on the element directly each frame — no React render per frame.
    const frame = (ts: number) => {
      if (motionStart === null && ts - startTime >= startFixationMs) motionStart = ts;
      const x = motionStart === null ? cx : targetAt(ts);
      if (dotRef.current) dotRef.current.style.transform = `translate(${x - dotSizePx / 2}px, ${cy - dotSizePx / 2}px)`;
      if (motionStart !== null && ts - motionStart >= motionMs) {
        finish(ts, motionStart);
        return;
      }
      raf = requestAnimationFrame(frame);
    };

    const sampler = setInterval(() => {
      if (motionStart === null) return;
      const now = performance.now();
      const g = neuroLiveGazeRef.current;
      samples.push({ t: (now - motionStart) / 1000, x: g.x, y: g.y, targetX: targetAt(now) });
    }, gazeIntervalMs);

    const finish = (end: number, t0: number) => {
      clearInterval(sampler);
      setDone(true);
      const metrics = analysePursuit(
        getFramesRef.current(),
        'x',
        t0 + ANALYSIS_SKIP_CYCLES * periodMs,
        t0 + motionMs,
        t0,
        frequencyHz,
        amplitudePx,
      );
      const result: SmoothPursuitResult = {
        startTime,
        endTime: end,
        motionStart: t0,
        frequencyHz,
        cycles,
        amplitudePx,
        centerX: cx,
        centerY: cy,
        gazeSamples: samples,
        viewportWidth: viewport.w,
        viewportHeight: viewport.h,
        metrics,
      };
      completeRef.current({ testId: 'smooth_pursuit', ...result, metrics: { ...metrics } });
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(sampler);
    };
    // Parameters are fixed for the life of one run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (done) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950">
        <p className="text-gray-400">Test complete. Saving…</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-gray-950" role="region" aria-label="Smooth pursuit: follow the moving dot">
      <p className="text-center text-gray-400 text-sm pt-4 pb-2">Follow the dot with your eyes.</p>
      <div
        ref={dotRef}
        className="absolute left-0 top-0 rounded-full"
        style={{
          width: dotSizePx,
          height: dotSizePx,
          backgroundColor: dotColor,
          transform: `translate(${cx - dotSizePx / 2}px, ${cy - dotSizePx / 2}px)`,
        }}
        aria-hidden
      />
    </div>
  );
}
