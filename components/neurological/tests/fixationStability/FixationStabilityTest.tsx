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
import { computeBceaForSamples } from '@/lib/bivariateEllipse';
import { neuroLiveGazeRef } from '@/lib/neuroLiveGaze';

const FIXATION_STABILITY_RESULT_LS_KEY = 'neuro_fixation_stability_result_v1';

export interface FixationStabilityResult {
  startTime: number;
  endTime: number;
  durationMs: number;
  gazeSamples: Array<{ t: number; x: number; y: number }>;
  /** Viewport at run time — for replaying gaze / ellipse in screen space */
  viewportWidth?: number;
  viewportHeight?: number;
  microSaccades?: number;
  gazeDispersion?: number;
  deviationFromCenter?: number;
  /** Bivariate Contour Ellipse Area (px²) */
  bcea68Px2?: number;
  bcea95Px2?: number;
  metrics?: {
    microSaccadeCount?: number;
    dispersionPx?: number;
    meanDeviationPx?: number;
    bcea68Px2?: number;
    bcea95Px2?: number;
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
  useNeuroGaze();
  const completeTestRef = useRef(completeTest);
  completeTestRef.current = completeTest;

  const durationSec = Math.max(
    MIN_DURATION_SEC,
    Math.min(MAX_DURATION_SEC, Number(config.durationSec) ?? DEFAULT_DURATION_SEC)
  );
  const blinkIntervalMs = Math.max(0, Number(config.blinkIntervalMs) ?? DEFAULT_BLINK_INTERVAL_MS);
  const centerDotSizePx = Math.max(6, Math.min(64, Number(config.centerDotSizePx) ?? 12));
  const centerDotColor = /^#[0-9A-Fa-f]{6}$/.test(String(config.centerDotColor ?? '')) ? String(config.centerDotColor) : '#f59e0b';
  const gazeIntervalMs = Math.max(16, Number(config.gazeSampleIntervalMs) || GAZE_SAMPLE_INTERVAL_MS);

  const center = getCenter();
  const startTimeRef = useRef(0);
  const gazeSamplesRef = useRef<Array<{ t: number; x: number; y: number }>>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [blinkVisible, setBlinkVisible] = useState(true);

  useEffect(() => {
    startTimeRef.current = performance.now();
    gazeSamplesRef.current = [];
    try {
      localStorage.setItem(
        FIXATION_STABILITY_RESULT_LS_KEY,
        JSON.stringify({
          savedAt: new Date().toISOString(),
          status: 'in_progress',
          microSaccades: 0,
          gazeDispersion: 0,
          deviationFromCenter: 0,
        })
      );
    } catch (_) {}

    intervalRef.current = setInterval(() => {
      const now = performance.now();
      const t = (now - startTimeRef.current) / 1000;
      const g = neuroLiveGazeRef.current;
      gazeSamplesRef.current.push({ t, x: g.x, y: g.y });
    }, gazeIntervalMs);

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
      const xy = samples.map((s) => ({ x: s.x, y: s.y }));
      const b68 = computeBceaForSamples(xy, '68');
      const b95 = computeBceaForSamples(xy, '95');
      const bcea68Px2 = b68.areaPx2;
      const bcea95Px2 = b95.areaPx2;
      const vw = typeof window !== 'undefined' ? window.innerWidth : undefined;
      const vh = typeof window !== 'undefined' ? window.innerHeight : undefined;
      try {
        localStorage.setItem(
          FIXATION_STABILITY_RESULT_LS_KEY,
          JSON.stringify({
            savedAt: new Date().toISOString(),
            microSaccades: microSaccadeCount,
            gazeDispersion: dispersionPx,
            deviationFromCenter: meanDeviationPx,
            bcea68Px2,
            bcea95Px2,
          })
        );
      } catch (_) {}

      completeTestRef.current({
        testId: 'fixation_stability',
        startTime: startTimeRef.current,
        endTime,
        durationMs: endTime - startTimeRef.current,
        gazeSamples: samples,
        viewportWidth: vw,
        viewportHeight: vh,
        microSaccades: microSaccadeCount,
        gazeDispersion: dispersionPx,
        deviationFromCenter: meanDeviationPx,
        bcea68Px2,
        bcea95Px2,
        metrics: {
          microSaccadeCount,
          dispersionPx,
          meanDeviationPx,
          bcea68Px2,
          bcea95Px2,
        },
      });
    }, durationSec * 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (endTimeoutRef.current) clearTimeout(endTimeoutRef.current);
    };
  }, [durationSec]);

  useEffect(() => {
    if (blinkIntervalMs <= 0) return;
    const id = setInterval(() => setBlinkVisible((v) => !v), blinkIntervalMs);
    return () => clearInterval(id);
  }, [blinkIntervalMs]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gray-950"
      role="region"
      aria-label="Fixation stability: keep gaze on the dot"
    >
      <div
        className="absolute rounded-full shadow-lg"
        style={{
          left: center.x - centerDotSizePx / 2,
          top: center.y - centerDotSizePx / 2,
          width: centerDotSizePx,
          height: centerDotSizePx,
          backgroundColor: centerDotColor,
          opacity: blinkVisible ? 1 : 0.35,
          transition: 'opacity 0.1s ease',
        }}
        aria-hidden
      />
    </div>
  );
}
