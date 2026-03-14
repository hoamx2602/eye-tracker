'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useTestRunner } from '../../TestRunnerContext';
import { useNeuroGaze } from '../../NeuroGazeContext';
import {
  DEFAULT_BLINK_INTERVAL_MS,
  DEFAULT_DURATION_SEC,
  GAZE_SAMPLE_INTERVAL_MS,
  MAX_DURATION_SEC,
  MIN_DURATION_SEC,
} from './constants';

export interface FixationStabilityResult {
  startTime: number;
  endTime: number;
  durationMs: number;
  gazeSamples: Array<{ t: number; x: number; y: number }>;
  metrics?: {
    microSaccadeCount?: number;
    dispersionPx?: number;
    meanDeviationPx?: number;
  };
}

function getCenter(): { x: number; y: number } {
  if (typeof window === 'undefined') return { x: 960, y: 540 };
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

/** Standard deviation of array of numbers. */
function std(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Approximate micro-saccade count: number of gaze jumps above velocity threshold (px/s). */
function countMicroSaccades(
  samples: Array<{ t: number; x: number; y: number }>,
  velocityThresholdPxPerSec: number
): number {
  if (samples.length < 2) return 0;
  let count = 0;
  for (let i = 1; i < samples.length; i++) {
    const dt = (samples[i].t - samples[i - 1].t) * 1000; // ms
    if (dt <= 0) continue;
    const dx = samples[i].x - samples[i - 1].x;
    const dy = samples[i].y - samples[i - 1].y;
    const velPxPerSec = (Math.hypot(dx, dy) / dt) * 1000;
    if (velPxPerSec >= velocityThresholdPxPerSec) count++;
  }
  return count;
}

export default function FixationStabilityTest() {
  const { config, completeTest } = useTestRunner();
  const { gaze } = useNeuroGaze();
  const gazeRef = useRef(gaze);
  gazeRef.current = gaze;

  const durationSec = Math.max(
    MIN_DURATION_SEC,
    Math.min(MAX_DURATION_SEC, Number(config.durationSec) ?? DEFAULT_DURATION_SEC)
  );
  const blinkIntervalMs = Math.max(0, Number(config.blinkIntervalMs) ?? DEFAULT_BLINK_INTERVAL_MS);

  const startTimeRef = useRef(0);
  const gazeSamplesRef = useRef<Array<{ t: number; x: number; y: number }>>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [blinkVisible, setBlinkVisible] = useState(true);

  useEffect(() => {
    startTimeRef.current = performance.now();
    gazeSamplesRef.current = [];

    intervalRef.current = setInterval(() => {
      const now = performance.now();
      const t = (now - startTimeRef.current) / 1000;
      const g = gazeRef.current;
      gazeSamplesRef.current.push({ t, x: g.x, y: g.y });
      setElapsedSec(Math.min(durationSec, t));
    }, GAZE_SAMPLE_INTERVAL_MS);

    endTimeoutRef.current = setTimeout(() => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      const endTime = performance.now();
      const samples = gazeSamplesRef.current;
      const c = getCenter();
      const cx = c.x;
      const cy = c.y;
      const distances = samples.map((s) => Math.hypot(s.x - cx, s.y - cy));
      const meanDeviationPx =
        distances.length > 0 ? distances.reduce((a, b) => a + b, 0) / distances.length : 0;
      const dispersionPx = std(distances);
      const microSaccadeCount = countMicroSaccades(samples, 50);

      completeTest({
        testId: 'fixation_stability',
        startTime: startTimeRef.current,
        endTime,
        durationMs: endTime - startTimeRef.current,
        gazeSamples: samples,
        metrics: {
          microSaccadeCount,
          dispersionPx,
          meanDeviationPx,
        },
      });
    }, durationSec * 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (endTimeoutRef.current) clearTimeout(endTimeoutRef.current);
    };
  }, [durationSec, completeTest]);

  useEffect(() => {
    if (blinkIntervalMs <= 0) return;
    const id = setInterval(() => setBlinkVisible((v) => !v), blinkIntervalMs);
    return () => clearInterval(id);
  }, [blinkIntervalMs]);

  const remaining = Math.max(0, Math.ceil(durationSec - elapsedSec));

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gray-950"
      role="region"
      aria-label="Fixation stability: keep gaze on the dot"
    >
      <p className="text-gray-400 text-sm mb-4">
        Keep your gaze on the dot. Time remaining: <span className="font-mono text-white">{remaining}</span> s
      </p>
      <div
        className="w-3 h-3 rounded-full bg-amber-400 shadow-lg"
        style={{
          opacity: blinkVisible ? 1 : 0.35,
          transition: 'opacity 0.1s ease',
        }}
        aria-hidden
      />
    </div>
  );
}
