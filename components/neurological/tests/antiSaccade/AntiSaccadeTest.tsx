'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTestRunner } from '../../TestRunnerContext';
import { useNeuroGaze } from '../../NeuroGazeContext';
import {
  AOI_RADIUS_PX,
  DEFAULT_INTERVAL_BETWEEN_TRIALS_MS,
  DEFAULT_MOVEMENT_DURATION_MS,
  DEFAULT_TRIAL_COUNT,
  GAZE_SAMPLE_INTERVAL_MS,
  RECT_HALF_PX,
  TRAVEL_DISTANCE_PX,
  STIMULUS_SHAPE_OPTIONS,
  RECT_COLOR_PALETTE,
  type AntiSaccadeDirection,
  type AntiSaccadeRectColor,
  type AntiSaccadeStimulusShape,
} from './constants';
import StimulusShape from './StimulusShape';
import { dimPosition, generateTrialDirections, primaryPosition } from './utils';
import { neuroLiveGazeRef } from '@/lib/neuroLiveGaze';

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function degFromRad(r: number): number {
  return (r * 180) / Math.PI;
}

/** Shortest signed difference between two directions in degrees. */
function shortestAngularDiffDeg(fromDeg: number, toDeg: number): number {
  let d = fromDeg - toDeg;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

function isHorizontalDirection(d: AntiSaccadeDirection): boolean {
  return d === 'left' || d === 'right';
}

const VALID_SHAPES = new Set(STIMULUS_SHAPE_OPTIONS.map((o) => o.value));

function getStimulusShape(config: Record<string, unknown>): AntiSaccadeStimulusShape {
  const v = String(config?.stimulusShape ?? 'rectangle').toLowerCase();
  return VALID_SHAPES.has(v as AntiSaccadeStimulusShape) ? (v as AntiSaccadeStimulusShape) : 'rectangle';
}

function getRectColor(config: Record<string, unknown> | undefined, key: string, defaultColor: AntiSaccadeRectColor): AntiSaccadeRectColor {
  const v = String(config?.[key] ?? defaultColor).toLowerCase();
  if (/^#([0-9A-Fa-f]{6})$/.test(v)) return v as AntiSaccadeRectColor;
  if (Object.prototype.hasOwnProperty.call(RECT_COLOR_PALETTE, v)) return v as AntiSaccadeRectColor;
  return defaultColor;
}

export interface AntiSaccadeTrialResult {
  direction: AntiSaccadeDirection;
  startTime: number;
  firstCorrectGazeTime?: number;
  latencyMs?: number;
  gazeSamples: Array<{ t: number; x: number; y: number }>;
  /** Mean gaze position during movement phase */
  gazeMean?: { x: number; y: number };
  /** Direction from screen center to mean gaze (°), 0 = +x, 90 = up (negative y in screen coords — atan2 handles) */
  gazeDirectionDeg?: number;
  /** Direction from center to correct anti-saccade target (dim AOI at end of travel) */
  targetDirectionDeg?: number;
  /** Signed angular error: gazeDirectionDeg − targetDirectionDeg wrapped to [−180, 180] */
  angularErrorDeg?: number;
}

/** Một điểm gaze; `t` = giây từ `startTime` của bài test (cùng quy ước visual_search.scanningPath). */
export type AntiSaccadeScanningPoint = { t: number; x: number; y: number };

export interface AntiSaccadeResult {
  startTime: number;
  endTime: number;
  trials: AntiSaccadeTrialResult[];
  /** Toàn bộ mẫu gaze nối theo thời gian — dùng replay/debug, tương đương visual_search.scanningPath */
  scanningPath?: AntiSaccadeScanningPoint[];
  /** Alias của scanningPath (giống visual_search). */
  gazePath?: AntiSaccadeScanningPoint[];
  metrics?: {
    avgLatency?: number;
    directionAccuracy?: number;
    fixationStability?: number;
  };
}

/** Gộp từng trial (t tương đối từng lần chuyển động) thành một đường thời gian từ lúc bắt đầu test. */
export function buildAntiSaccadeScanningPath(
  trials: AntiSaccadeTrialResult[],
  testStartMs: number
): AntiSaccadeScanningPoint[] {
  const out: AntiSaccadeScanningPoint[] = [];
  for (const tr of trials) {
    const offsetSec = (tr.startTime - testStartMs) / 1000;
    for (const s of tr.gazeSamples ?? []) {
      out.push({ t: offsetSec + s.t, x: s.x, y: s.y });
    }
  }
  return out;
}

function getCenter(): { x: number; y: number } {
  if (typeof window === 'undefined') return { x: 960, y: 540 };
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

/** Distance from screen center to near edge (used for real test).
 *  edgeMarginPx: minimum gap (px) between stimulus edge and screen edge — should match
 *  the calibration boundary (~4% of viewport) to avoid gaze model extrapolation. */
function getTravelToEdges(edgeMarginPx: number): { travelX: number; travelY: number } {
  if (typeof window === 'undefined') return { travelX: TRAVEL_DISTANCE_PX, travelY: TRAVEL_DISTANCE_PX };
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  // Clamp travel so the stimulus center stops at least edgeMarginPx from screen edge
  const travelX = Math.max(TRAVEL_DISTANCE_PX, Math.min(cx - edgeMarginPx, window.innerWidth - cx - edgeMarginPx));
  const travelY = Math.max(TRAVEL_DISTANCE_PX, Math.min(cy - edgeMarginPx, window.innerHeight - cy - edgeMarginPx));
  return { travelX, travelY };
}

export default function AntiSaccadeTest() {
  const { config, completeTest } = useTestRunner();
  useNeuroGaze();

  const trialCount = Math.max(2, Math.min(30, Number(config.trialCount) ?? DEFAULT_TRIAL_COUNT));
  const speedPxPerSec = (() => {
    const v = Number(config.movementSpeedPxPerSec);
    return Number.isFinite(v) && v > 0 ? Math.min(500, v) : 0;
  })();
  const fallbackDurationMs = Math.max(500, Number(config.movementDurationMs) ?? DEFAULT_MOVEMENT_DURATION_MS);
  const intervalMs = Math.max(200, Number(config.intervalBetweenTrialsMs) ?? DEFAULT_INTERVAL_BETWEEN_TRIALS_MS);
  const dimRectOpacity = (() => {
    const v = Number(config.dimRectOpacity);
    return Number.isFinite(v) ? Math.max(0, Math.min(0.9, v)) : 0.1;
  })();
  const showDimRect = dimRectOpacity > 0;
  const stimulusShape = getStimulusShape(config);
  const primaryRectColor = getRectColor(config, 'primaryRectColor', 'red');
  const dimRectColor = getRectColor(config, 'dimRectColor', 'blue');
  const gazeIntervalMs = Math.max(16, Number(config.gazeSampleIntervalMs) || GAZE_SAMPLE_INTERVAL_MS);
  /** Minimum px from screen edge where stimuli can appear — read from global config. */
  const edgePaddingPx = Math.max(0, Number(config.edgePaddingPx) || 80);

  const directions = useMemo(() => generateTrialDirections(trialCount), [trialCount]);
  const startTimeRef = useRef(0);
  const [trialIndex, setTrialIndex] = useState(0);
  const [phase, setPhase] = useState<'moving' | 'between'>('moving');
  const [visualStarted, setVisualStarted] = useState(false);
  const movementStartRef = useRef(0);
  const firstCorrectGazeTimeRef = useRef<number | null>(null);
  const trialGazeSamplesRef = useRef<Array<{ t: number; x: number; y: number }>>([]);
  const trialsResultsRef = useRef<AntiSaccadeTrialResult[]>([]);
  const betweenStartRef = useRef(0);

  const center = getCenter();
  const { travelX, travelY } = getTravelToEdges(edgePaddingPx);
  const direction = directions[trialIndex];
  const travelPx = direction ? (isHorizontalDirection(direction) ? travelX : travelY) : TRAVEL_DISTANCE_PX;

  const trialDurationMs =
    speedPxPerSec > 0
      ? Math.max(300, Math.min(15000, (1000 * travelPx) / speedPxPerSec))
      : fallbackDurationMs;

  const primaryEndPos = useMemo(
    () => (direction ? primaryPosition(direction, center.x, center.y, 1, travelPx) : center),
    [direction, center.x, center.y, travelPx]
  );
  const dimEndPos = useMemo(
    () => (direction ? dimPosition(direction, center.x, center.y, 1, travelPx) : center),
    [direction, center.x, center.y, travelPx]
  );

  const primaryTranslate = { x: primaryEndPos.x - center.x, y: primaryEndPos.y - center.y };
  const dimTranslate = { x: dimEndPos.x - center.x, y: dimEndPos.y - center.y };

  useEffect(() => {
    startTimeRef.current = performance.now();
    movementStartRef.current = performance.now();
    firstCorrectGazeTimeRef.current = null;
    trialGazeSamplesRef.current = [];
    trialsResultsRef.current = [];
  }, []);

  // Visual movement is driven by CSS transitions (no React setState per frame).
  // We only toggle visualStarted at the start of each trial movement phase.
  useEffect(() => {
    if (phase !== 'moving') return;
    if (trialIndex >= trialCount) return;
    setVisualStarted(false);
    const raf = requestAnimationFrame(() => setVisualStarted(true));
    return () => cancelAnimationFrame(raf);
  }, [phase, trialIndex, trialCount]);

  useEffect(() => {
    if (trialIndex >= trialCount) return;

    const interval = setInterval(() => {
      const now = performance.now();
      const dir = directions[trialIndex];
      if (!dir) return;

      if (phase === 'moving') {
        const elapsed = now - movementStartRef.current;
        const p = Math.min(1, elapsed / trialDurationMs);

        const dimPosNow = dimPosition(dir, center.x, center.y, p, travelPx);
        const g = neuroLiveGazeRef.current;
        const tRel = (now - movementStartRef.current) / 1000;
        trialGazeSamplesRef.current.push({ t: tRel, x: g.x, y: g.y });

        const inDimAOI = Math.hypot(g.x - dimPosNow.x, g.y - dimPosNow.y) <= AOI_RADIUS_PX;
        if (inDimAOI && firstCorrectGazeTimeRef.current === null) {
          firstCorrectGazeTimeRef.current = now;
        }

        if (p >= 1) {
          const trialStart = movementStartRef.current;
          const firstCorrect = firstCorrectGazeTimeRef.current;
          const gs = [...trialGazeSamplesRef.current];
          const dimPos = dimPosition(dir, center.x, center.y, 1, travelPx);
          const gazeMean =
            gs.length > 0
              ? { x: mean(gs.map((s) => s.x)), y: mean(gs.map((s) => s.y)) }
              : undefined;
          const gazeDirectionDeg =
            gazeMean != null ? degFromRad(Math.atan2(gazeMean.y - center.y, gazeMean.x - center.x)) : undefined;
          const targetDirectionDeg = degFromRad(
            Math.atan2(dimPos.y - center.y, dimPos.x - center.x)
          );
          const angularErrorDeg =
            gazeDirectionDeg != null
              ? shortestAngularDiffDeg(gazeDirectionDeg, targetDirectionDeg)
              : undefined;
          trialsResultsRef.current.push({
            direction: dir,
            startTime: trialStart,
            firstCorrectGazeTime: firstCorrect ?? undefined,
            latencyMs: firstCorrect != null ? firstCorrect - trialStart : undefined,
            gazeSamples: gs,
            gazeMean,
            gazeDirectionDeg,
            targetDirectionDeg,
            angularErrorDeg,
          });
          setPhase('between');
          betweenStartRef.current = now;
        }
      } else {
        if (now - betweenStartRef.current >= intervalMs) {
          if (trialIndex + 1 >= trialCount) {
            const endTime = performance.now();
            const trials = trialsResultsRef.current;
            const withLatency = trials.filter((t) => t.latencyMs != null);
            const avgLatency =
              withLatency.length > 0
                ? withLatency.reduce((s, t) => s + (t.latencyMs ?? 0), 0) / withLatency.length
                : undefined;
            const directionAccuracy =
              trials.length > 0 ? (withLatency.length / trials.length) * 100 : undefined;
            const fixationStability = undefined;
            const testStart = startTimeRef.current;
            const scanningPath = buildAntiSaccadeScanningPath(trials, testStart);
            completeTest({
              testId: 'anti_saccade',
              startTime: testStart,
              endTime,
              trials,
              scanningPath,
              gazePath: scanningPath,
              metrics: { avgLatency, directionAccuracy, fixationStability },
              viewportWidth: typeof window !== 'undefined' ? window.innerWidth : undefined,
              viewportHeight: typeof window !== 'undefined' ? window.innerHeight : undefined,
            });
            return;
          }
          setTrialIndex((i) => i + 1);
          setPhase('moving');
          movementStartRef.current = performance.now();
          firstCorrectGazeTimeRef.current = null;
          trialGazeSamplesRef.current = [];
        }
      }
    }, gazeIntervalMs);

    return () => clearInterval(interval);
  }, [trialIndex, trialCount, phase, directions, speedPxPerSec, fallbackDurationMs, intervalMs, gazeIntervalMs, center.x, center.y, trialDurationMs, travelPx, completeTest]);

  if (trialIndex >= trialCount) {
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
      aria-label="Anti-saccade: look opposite direction from the primary square"
    >
      <p className="text-center text-gray-400 text-sm pt-4 pb-2">
        Look in the opposite direction from the <strong className="text-gray-300">primary</strong> square
        {showDimRect ? (
          <>
            . Follow the <strong className="text-gray-300">dim</strong> square instead.
          </>
        ) : null}
      </p>
      {direction ? (
        <>
          {!visualStarted && showDimRect ? (
            <StimulusShape
              shape={stimulusShape}
              left={isHorizontalDirection(direction) ? center.x - RECT_HALF_PX : center.x - RECT_HALF_PX / 2}
              top={isHorizontalDirection(direction) ? center.y - RECT_HALF_PX / 2 : center.y - RECT_HALF_PX}
              width={isHorizontalDirection(direction) ? RECT_HALF_PX * 2 : RECT_HALF_PX}
              height={isHorizontalDirection(direction) ? RECT_HALF_PX : RECT_HALF_PX * 2}
              isPrimary={false}
              primaryColor={primaryRectColor}
              dimColor={dimRectColor}
              opacity={dimRectOpacity}
              ariaHidden
            />
          ) : null}

          <StimulusShape
            shape={stimulusShape}
            left={center.x - RECT_HALF_PX / 2}
            top={center.y - RECT_HALF_PX / 2}
            width={RECT_HALF_PX}
            height={RECT_HALF_PX}
            isPrimary={true}
            primaryColor={primaryRectColor}
            dimColor={dimRectColor}
            opacity={visualStarted ? 1 : 0}
            ariaHidden
            style={{
              transition: visualStarted ? `transform ${trialDurationMs}ms linear` : 'none',
              transform: `translate(${visualStarted ? primaryTranslate.x : 0}px, ${visualStarted ? primaryTranslate.y : 0}px)`,
            }}
          />

          {showDimRect && (
            <StimulusShape
              shape={stimulusShape}
              left={center.x - RECT_HALF_PX / 2}
              top={center.y - RECT_HALF_PX / 2}
              width={RECT_HALF_PX}
              height={RECT_HALF_PX}
              isPrimary={false}
              primaryColor={primaryRectColor}
              dimColor={dimRectColor}
              opacity={visualStarted ? dimRectOpacity : 0}
              ariaHidden
              style={{
                transition: visualStarted ? `transform ${trialDurationMs}ms linear` : 'none',
                transform: `translate(${visualStarted ? dimTranslate.x : 0}px, ${visualStarted ? dimTranslate.y : 0}px)`,
              }}
            />
          )}
        </>
      ) : null}
    </div>
  );
}
