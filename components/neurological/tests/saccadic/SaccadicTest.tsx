'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTestRunner } from '../../TestRunnerContext';
import { useNeuroGaze } from '../../NeuroGazeContext';
import {
  AOI_RADIUS_PX,
  DEFAULT_TARGET_DURATION_MS,
  DEFAULT_TOTAL_CYCLES,
  GAZE_SAMPLE_INTERVAL_MS,
  type SaccadicTargetSide,
} from './constants';
import { getTargetPosition } from './utils';
import { neuroLiveGazeRef } from '@/lib/neuroLiveGaze';

const SACCADIC_RESULT_LS_KEY = 'neuro_saccadic_result_v1';

export interface SaccadicCycleResult {
  targetSide: SaccadicTargetSide;
  onsetTime: number;
  firstFixationTime?: number;
  latencyMs?: number;
  gazeSamples: Array<{ t: number; x: number; y: number }>;
}

export type SaccadicScanningPoint = { t: number; x: number; y: number };

export interface SaccadicResult {
  startTime: number;
  endTime: number;
  cycles: SaccadicCycleResult[];
  /** Toàn bộ mẫu gaze; `t` = giây từ `startTime` bài test (giống visual_search / anti_saccade). */
  scanningPath?: SaccadicScanningPoint[];
  gazePath?: SaccadicScanningPoint[];
  saccadeLatencyMs?: number[];
  fixationAccuracy?: number;
  correctiveSaccades?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  metrics?: {
    avgLatency?: number;
    fixationAccuracy?: number;
    correctiveSaccadeCount?: number;
  };
}

/** Gộp các cycle (t tương đối từng chu kỳ) thành một đường thời gian từ lúc bắt đầu test. */
export function buildSaccadicScanningPath(
  cycles: SaccadicCycleResult[],
  testStartMs: number
): SaccadicScanningPoint[] {
  const out: SaccadicScanningPoint[] = [];
  for (const cy of cycles) {
    const offsetSec = (cy.onsetTime - testStartMs) / 1000;
    for (const s of cy.gazeSamples ?? []) {
      out.push({ t: offsetSec + s.t, x: s.x, y: s.y });
    }
  }
  return out;
}

function getViewport(): { w: number; h: number } {
  if (typeof window === 'undefined') return { w: 1920, h: 1080 };
  return { w: window.innerWidth, h: window.innerHeight };
}

/**
 * Count re-entries into AOI after first fixation (simple corrective saccade heuristic).
 */
function countCorrectiveSaccades(
  samples: Array<{ t: number; x: number; y: number }>,
  targetX: number,
  targetY: number,
  firstFixationIndex: number
): number {
  if (firstFixationIndex < 0 || firstFixationIndex >= samples.length) return 0;
  let count = 0;
  let wasInside = true;
  for (let i = firstFixationIndex + 1; i < samples.length; i++) {
    const inAOI = Math.hypot(samples[i].x - targetX, samples[i].y - targetY) <= AOI_RADIUS_PX;
    if (!wasInside && inAOI) count++;
    wasInside = inAOI;
  }
  return count;
}

export default function SaccadicTest() {
  const { config, completeTest } = useTestRunner();
  useNeuroGaze();

  const totalCycles = Math.max(2, Math.min(40, Number(config.totalCycles) ?? DEFAULT_TOTAL_CYCLES));
  const targetDurationMs = Math.max(400, Number(config.targetDurationMs) ?? DEFAULT_TARGET_DURATION_MS);
  const targetDotSizePx = Math.max(16, Math.min(64, Number(config.targetDotSizePx) ?? 64));
  const targetDotColor = /^#[0-9A-Fa-f]{6}$/.test(String(config.targetDotColor ?? '')) ? String(config.targetDotColor) : '#f59e0b';

  const viewport = getViewport();
  const startTimeRef = useRef(0);
  const [cycleIndex, setCycleIndex] = useState(0);
  const cycleStartRef = useRef(0);
  const firstFixationTimeRef = useRef<number | null>(null);
  const cycleGazeSamplesRef = useRef<Array<{ t: number; x: number; y: number }>>([]);
  const cyclesResultsRef = useRef<SaccadicCycleResult[]>([]);

  const targetSide: SaccadicTargetSide = cycleIndex % 2 === 0 ? 'left' : 'right';
  const targetPos = useMemo(
    () => getTargetPosition(targetSide, viewport.w, viewport.h),
    [targetSide, viewport.w, viewport.h]
  );

  useEffect(() => {
    startTimeRef.current = performance.now();
    cycleStartRef.current = performance.now();
    firstFixationTimeRef.current = null;
    cycleGazeSamplesRef.current = [];
    cyclesResultsRef.current = [];
    try {
      localStorage.setItem(
        SACCADIC_RESULT_LS_KEY,
        JSON.stringify({
          savedAt: new Date().toISOString(),
          status: 'in_progress',
          saccadeLatencyMs: [],
          fixationAccuracy: 0,
          correctiveSaccades: 0,
        })
      );
    } catch (_) {}
  }, []);

  useEffect(() => {
    if (cycleIndex >= totalCycles) return;

    const interval = setInterval(() => {
      const now = performance.now();
      const elapsed = now - cycleStartRef.current;
      const pos = getTargetPosition(
        cycleIndex % 2 === 0 ? 'left' : 'right',
        viewport.w,
        viewport.h
      );
      const g = neuroLiveGazeRef.current;
      const tRel = (now - cycleStartRef.current) / 1000;
      cycleGazeSamplesRef.current.push({ t: tRel, x: g.x, y: g.y });

      const inAOI = Math.hypot(g.x - pos.x, g.y - pos.y) <= AOI_RADIUS_PX;
      if (inAOI && firstFixationTimeRef.current === null) {
        firstFixationTimeRef.current = now;
      }

      if (elapsed >= targetDurationMs) {
        const onsetTime = cycleStartRef.current;
        const firstFix = firstFixationTimeRef.current;
        const side: SaccadicTargetSide = cycleIndex % 2 === 0 ? 'left' : 'right';
        cyclesResultsRef.current.push({
          targetSide: side,
          onsetTime,
          firstFixationTime: firstFix ?? undefined,
          latencyMs: firstFix != null ? firstFix - onsetTime : undefined,
          gazeSamples: [...cycleGazeSamplesRef.current],
        });

        if (cycleIndex + 1 >= totalCycles) {
          const endTime = performance.now();
          const cycles = cyclesResultsRef.current;
          const withLatency = cycles.filter((c) => c.latencyMs != null);
          const avgLatency =
            withLatency.length > 0
              ? withLatency.reduce((s, c) => s + (c.latencyMs ?? 0), 0) / withLatency.length
              : undefined;
          const fixationAccuracy =
            cycles.length > 0 ? (withLatency.length / cycles.length) * 100 : undefined;
          let correctiveSaccadeCount = 0;
          cycles.forEach((cy) => {
            const posCycle = getTargetPosition(cy.targetSide, viewport.w, viewport.h);
            const firstFixIdx = cy.gazeSamples.findIndex(
              (s) => Math.hypot(s.x - posCycle.x, s.y - posCycle.y) <= AOI_RADIUS_PX
            );
            if (firstFixIdx >= 0) {
              correctiveSaccadeCount += countCorrectiveSaccades(
                cy.gazeSamples,
                posCycle.x,
                posCycle.y,
                firstFixIdx
              );
            }
          });
          const saccadeLatencyMs = withLatency
            .map((c) => c.latencyMs)
            .filter((v): v is number => typeof v === 'number');
          try {
            localStorage.setItem(
              SACCADIC_RESULT_LS_KEY,
              JSON.stringify({
                savedAt: new Date().toISOString(),
                saccadeLatencyMs,
                fixationAccuracy: fixationAccuracy ?? null,
                correctiveSaccades: correctiveSaccadeCount,
              })
            );
          } catch (_) {}
          const testStart = startTimeRef.current;
          const scanningPath = buildSaccadicScanningPath(cycles, testStart);
          completeTest({
            testId: 'saccadic',
            startTime: testStart,
            endTime,
            cycles,
            scanningPath,
            gazePath: scanningPath,
            saccadeLatencyMs,
            fixationAccuracy,
            correctiveSaccades: correctiveSaccadeCount,
            viewportWidth: viewport.w,
            viewportHeight: viewport.h,
            metrics: {
              avgLatency,
              fixationAccuracy,
              correctiveSaccadeCount,
            },
          });
          return;
        }

        setCycleIndex((i) => i + 1);
        cycleStartRef.current = performance.now();
        firstFixationTimeRef.current = null;
        cycleGazeSamplesRef.current = [];
      }
    }, GAZE_SAMPLE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [cycleIndex, totalCycles, targetDurationMs, viewport.w, viewport.h, completeTest]);

  if (cycleIndex >= totalCycles) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950">
        <p className="text-gray-400">Test complete. Saving…</p>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-gray-950"
      role="region"
      aria-label="Saccadic: look at the target when it appears"
    >
      <p className="text-center text-gray-400 text-sm pt-4 pb-2">
        Look at the target.
      </p>
      <div
        className="absolute rounded-full shadow-lg border-4 border-amber-300"
        style={{
          left: targetPos.x - targetDotSizePx / 2,
          top: targetPos.y - targetDotSizePx / 2,
          width: targetDotSizePx,
          height: targetDotSizePx,
          backgroundColor: targetDotColor,
        }}
        aria-hidden
      />
    </div>
  );
}
