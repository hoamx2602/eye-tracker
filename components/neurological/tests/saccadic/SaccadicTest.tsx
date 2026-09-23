'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTestRunner } from '../../TestRunnerContext';
import { useNeuroGaze } from '../../NeuroGazeContext';
import { useNeuroHeadPose } from '../../NeuroHeadPoseContext';
import {
  AOI_RADIUS_PX,
  DEFAULT_FIXATION_MAX_MS,
  DEFAULT_FIXATION_MIN_MS,
  DEFAULT_TARGET_DURATION_MS,
  DEFAULT_TOTAL_CYCLES,
  FIXATION_DOT_SIZE_PX,
  GAZE_SAMPLE_INTERVAL_MS,
  type SaccadicTargetSide,
} from './constants';
import { balancedSides, getTargetPosition, randomFixationMs } from './utils';
import { neuroLiveGazeRef } from '@/lib/neuroLiveGaze';
import { detectTrialSaccade, summariseSaccades, type SaccadeSummary, type TrialSaccade } from '@/lib/oculomotorMetrics';
import { useStimulusOnset } from '@/lib/stimulusOnset';

const SACCADIC_RESULT_LS_KEY = 'neuro_saccadic_result_v1';

export type SaccadicHeadPose = { yaw: number; pitch: number; roll: number };

export interface SaccadicCycleResult {
  targetSide: SaccadicTargetSide;
  /** Time the target reached the screen (performance.now clock; see lib/stimulusOnset). */
  onsetTime: number;
  /** How long the central fixation point was shown before this target (randomised). */
  fixationMs?: number;
  firstFixationTime?: number;
  /**
   * Saccade latency, ms: velocity onset of the primary saccade on the per-frame
   * gaze (lib/oculomotorMetrics). Set only when that saccade went towards the
   * target — anticipations, wrong-way and lost trials have none.
   */
  latencyMs?: number;
  /** Time until the smoothed 10 Hz gaze first entered the AOI — the pre-2026-09 latency, kept for comparison. */
  aoiEntryLatencyMs?: number;
  /** Per-frame saccade analysis of this cycle. */
  saccade?: TrialSaccade;
  gazeSamples: Array<{ t: number; x: number; y: number; head?: SaccadicHeadPose }>;
}

export type SaccadicScanningPoint = { t: number; x: number; y: number; head?: SaccadicHeadPose };

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
    /** Per-frame saccade summary: latency of correct trials, anticipations, lost trials. */
    saccades?: SaccadeSummary;
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
      out.push({ t: offsetSec + s.t, x: s.x, y: s.y, head: s.head });
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
  const { config, completeTest, getGazeFrames } = useTestRunner();
  useNeuroGaze();

  const totalCycles = Math.max(2, Math.min(40, Number(config.totalCycles) || DEFAULT_TOTAL_CYCLES));
  const targetDurationMs = Math.max(400, Number(config.targetDurationMs) || DEFAULT_TARGET_DURATION_MS);
  const fixationMinMs = Math.max(300, Number(config.fixationMinMs) || DEFAULT_FIXATION_MIN_MS);
  const fixationMaxMs = Math.max(fixationMinMs, Number(config.fixationMaxMs) || DEFAULT_FIXATION_MAX_MS);
  const targetDotSizePx = Math.max(16, Math.min(64, Number(config.targetDotSizePx) || 64));
  const targetDotColor = /^#[0-9A-Fa-f]{6}$/.test(String(config.targetDotColor ?? '')) ? String(config.targetDotColor) : '#f59e0b';
  const gazeIntervalMs = Math.max(16, Number(config.gazeSampleIntervalMs) || GAZE_SAMPLE_INTERVAL_MS);
  const edgePaddingPx = Math.max(0, Number(config.edgePaddingPx) || 0);

  const viewport = getViewport();
  const center = { x: viewport.w / 2, y: viewport.h / 2 };
  // Side and fixation time are both unpredictable: a fixed left/right rhythm
  // lets the participant time the jump in advance, which measures anticipation,
  // not the reflexive saccade.
  const sides = useMemo(() => balancedSides(totalCycles), [totalCycles]);
  const fixationDurations = useMemo(
    () => sides.map(() => randomFixationMs(fixationMinMs, fixationMaxMs)),
    [sides, fixationMinMs, fixationMaxMs]
  );

  const startTimeRef = useRef(0);
  const [cycleIndex, setCycleIndex] = useState(0);
  const [phase, setPhase] = useState<'fixation' | 'target'>('fixation');
  const cycleStartRef = useRef(0);
  const firstFixationTimeRef = useRef<number | null>(null);
  const cycleGazeSamplesRef = useRef<Array<{ t: number; x: number; y: number; head?: SaccadicHeadPose }>>([]);
  const cyclesResultsRef = useRef<SaccadicCycleResult[]>([]);
  const { headPose } = useNeuroHeadPose();
  const headPoseRef = useRef(headPose);
  headPoseRef.current = headPose;

  const targetSide: SaccadicTargetSide = sides[cycleIndex] ?? 'left';
  const targetPos = useMemo(
    () => getTargetPosition(targetSide, viewport.w, viewport.h, edgePaddingPx),
    [targetSide, viewport.w, viewport.h, edgePaddingPx]
  );

  useStimulusOnset(cycleIndex, phase === 'target', useCallback((t: number) => {
    cycleStartRef.current = t;
  }, []));

  useEffect(() => {
    startTimeRef.current = performance.now();
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

  const finish = useCallback(() => {
    const endTime = performance.now();
    const cycles = cyclesResultsRef.current;
    const frames = getGazeFrames();
    for (const cy of cycles) {
      const pos = getTargetPosition(cy.targetSide, viewport.w, viewport.h, edgePaddingPx);
      const saccade = detectTrialSaccade(
        frames,
        cy.onsetTime,
        'x',
        pos.x < center.x ? -1 : 1,
        Math.abs(pos.x - center.x),
      );
      cy.saccade = saccade;
      cy.latencyMs = saccade.outcome === 'correct' && saccade.latencyMs !== null
        ? Math.round(saccade.latencyMs)
        : undefined;
    }
    const saccades = summariseSaccades(cycles.map((c) => c.saccade!));
    const withLatency = cycles.filter((c) => c.latencyMs != null);
    const avgLatency =
      withLatency.length > 0
        ? withLatency.reduce((s, c) => s + (c.latencyMs ?? 0), 0) / withLatency.length
        : undefined;
    // AOI-based accuracy, as before: the share of targets the gaze reached.
    const fixationAccuracy =
      cycles.length > 0 ? (cycles.filter((c) => c.aoiEntryLatencyMs != null).length / cycles.length) * 100 : undefined;
    let correctiveSaccadeCount = 0;
    cycles.forEach((cy) => {
      const posCycle = getTargetPosition(cy.targetSide, viewport.w, viewport.h, edgePaddingPx);
      const firstFixIdx = cy.gazeSamples.findIndex(
        (s) => Math.hypot(s.x - posCycle.x, s.y - posCycle.y) <= AOI_RADIUS_PX
      );
      if (firstFixIdx >= 0) {
        correctiveSaccadeCount += countCorrectiveSaccades(cy.gazeSamples, posCycle.x, posCycle.y, firstFixIdx);
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
        saccades,
      },
    });
  }, [completeTest, getGazeFrames, viewport.w, viewport.h, edgePaddingPx, center.x]);

  // Phase clock: central fixation for a random time, then the target.
  useEffect(() => {
    if (cycleIndex >= totalCycles) return;
    if (phase === 'fixation') {
      const id = setTimeout(() => {
        cycleStartRef.current = performance.now(); // replaced by the paint time (useStimulusOnset)
        firstFixationTimeRef.current = null;
        cycleGazeSamplesRef.current = [];
        setPhase('target');
      }, fixationDurations[cycleIndex]);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => {
      const onsetTime = cycleStartRef.current;
      const firstFix = firstFixationTimeRef.current;
      cyclesResultsRef.current.push({
        targetSide,
        onsetTime,
        fixationMs: fixationDurations[cycleIndex],
        firstFixationTime: firstFix ?? undefined,
        aoiEntryLatencyMs: firstFix != null ? Math.round(firstFix - onsetTime) : undefined,
        gazeSamples: [...cycleGazeSamplesRef.current],
      });
      if (cycleIndex + 1 >= totalCycles) {
        setCycleIndex(totalCycles);
        finish();
        return;
      }
      setCycleIndex((i) => i + 1);
      setPhase('fixation');
    }, targetDurationMs);
    return () => clearTimeout(id);
  }, [cycleIndex, phase, totalCycles, targetDurationMs, fixationDurations, targetSide, finish]);

  // 10 Hz smoothed samples for the result previews and the AOI comparison.
  // Timing metrics come from the per-frame stream instead.
  useEffect(() => {
    if (cycleIndex >= totalCycles || phase !== 'target') return;
    const interval = setInterval(() => {
      const now = performance.now();
      const g = neuroLiveGazeRef.current;
      const hp = headPoseRef.current;
      cycleGazeSamplesRef.current.push({
        t: (now - cycleStartRef.current) / 1000,
        x: g.x,
        y: g.y,
        ...(hp && { head: { yaw: hp.yaw, pitch: hp.pitch, roll: hp.roll } }),
      });
      const inAOI = Math.hypot(g.x - targetPos.x, g.y - targetPos.y) <= AOI_RADIUS_PX;
      if (inAOI && firstFixationTimeRef.current === null) firstFixationTimeRef.current = now;
    }, gazeIntervalMs);
    return () => clearInterval(interval);
  }, [cycleIndex, phase, totalCycles, gazeIntervalMs, targetPos.x, targetPos.y]);

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
        Look at the centre dot. When a target appears, look at it.
      </p>
      {phase === 'fixation' ? (
        <div
          className="absolute rounded-full bg-gray-200"
          style={{
            left: center.x - FIXATION_DOT_SIZE_PX / 2,
            top: center.y - FIXATION_DOT_SIZE_PX / 2,
            width: FIXATION_DOT_SIZE_PX,
            height: FIXATION_DOT_SIZE_PX,
          }}
          aria-hidden
        />
      ) : (
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
      )}
    </div>
  );
}
