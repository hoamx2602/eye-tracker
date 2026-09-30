'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTestRunner } from '../../TestRunnerContext';
import { useNeuroGaze } from '../../NeuroGazeContext';
import { useNeuroHeadPose } from '../../NeuroHeadPoseContext';
import {
  AOI_RADIUS_PX,
  DEFAULT_INTERVAL_BETWEEN_TRIALS_MS,
  DEFAULT_MOVEMENT_DURATION_MS,
  DEFAULT_TRIAL_COUNT,
  DEFAULT_FIXATION_PAUSE_MS,
  DEFAULT_STEP_DURATION_MS,
  DEFAULT_STEP_FIXATION_MAX_MS,
  DEFAULT_STEP_FIXATION_MIN_MS,
  GAZE_SAMPLE_INTERVAL_MS,
  RECT_HALF_PX,
  TRAVEL_DISTANCE_PX,
  STIMULUS_SHAPE_OPTIONS,
  RECT_COLOR_PALETTE,
  isDimRectInstructable,
  resolveShowReferenceLines,
  resolveParadigm,
  type AntiSaccadeDirection,
  type AntiSaccadeParadigm,
  type AntiSaccadeRectColor,
  type AntiSaccadeStimulusShape,
} from './constants';
import StimulusShape from './StimulusShape';
import ReferenceLines from './ReferenceLines';
import { dimPosition, generateTrialDirections, primaryPosition, randomDurationMs } from './utils';
import { neuroLiveGazeRef } from '@/lib/neuroLiveGaze';
import { detectTrialSaccade, summariseSaccades, type SaccadeSummary, type TrialSaccade } from '@/lib/oculomotorMetrics';
import { useStimulusOnset } from '@/lib/stimulusOnset';

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

export type AntiSaccadeHeadPose = { yaw: number; pitch: number; roll: number };

export interface AntiSaccadeTrialResult {
  direction: AntiSaccadeDirection;
  /** Stimulus onset: first painted frame of the jump (step) or of the movement (moving). */
  startTime: number;
  paradigm?: AntiSaccadeParadigm;
  /** Central fixation before this trial, ms (randomised in the step paradigm). */
  fixationMs?: number;
  /**
   * Per-frame analysis of the first saccade (lib/oculomotorMetrics): `error`
   * means it went towards the bright shape. Independent of calibration offset,
   * unlike the AOI latency and the mean-gaze angle below.
   */
  saccade?: TrialSaccade;
  firstCorrectGazeTime?: number;
  latencyMs?: number;
  gazeSamples: Array<{ t: number; x: number; y: number; head?: AntiSaccadeHeadPose }>;
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
export type AntiSaccadeScanningPoint = { t: number; x: number; y: number; head?: AntiSaccadeHeadPose };

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
    /** Per-frame summary: error rate, correction rate, latency of correct and error saccades. */
    saccades?: SaccadeSummary;
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
      out.push({ t: offsetSec + s.t, x: s.x, y: s.y, head: s.head });
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
  const { config, completeTest, getGazeFrames } = useTestRunner();
  useNeuroGaze();
  const paradigm = resolveParadigm(config);
  const isStep = paradigm === 'step';

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
  const showReferenceLines = resolveShowReferenceLines(config);
  // Below DIM_RECT_TEXT_THRESHOLD the rectangle still renders (showDimRect
  // above) but is too faint to meaningfully ask someone to "follow" — the
  // words describe the task by direction instead. See constants.ts.
  const dimRectInstructable = isDimRectInstructable(config);
  const stimulusShape = getStimulusShape(config);
  const primaryRectColor = getRectColor(config, 'primaryRectColor', 'red');
  const dimRectColor = getRectColor(config, 'dimRectColor', 'blue');
  const gazeIntervalMs = Math.max(16, Number(config.gazeSampleIntervalMs) || GAZE_SAMPLE_INTERVAL_MS);
  /** Minimum px from screen edge where stimuli can appear — read from global config. */
  const edgePaddingPx = Math.max(0, Number(config.edgePaddingPx) || 80);
  /** How long (ms) both rects stay at center before moving apart each trial. */
  const rawFixationPause = Number(config.fixationPauseMs);
  const fixationPauseMs = Math.max(0, Number.isFinite(rawFixationPause) ? rawFixationPause : DEFAULT_FIXATION_PAUSE_MS);
  // Step paradigm: an unpredictable fixation, so the jump cannot be anticipated.
  const stepFixationMinMs = Math.max(300, Number(config.stepFixationMinMs) || DEFAULT_STEP_FIXATION_MIN_MS);
  const stepFixationMaxMs = Math.max(stepFixationMinMs, Number(config.stepFixationMaxMs) || DEFAULT_STEP_FIXATION_MAX_MS);
  const stepDurationMs = Math.max(600, Number(config.stepDurationMs) || DEFAULT_STEP_DURATION_MS);

  const directions = useMemo(() => generateTrialDirections(trialCount, isStep), [trialCount, isStep]);
  const fixationDurations = useMemo(
    () => directions.map(() => (isStep ? randomDurationMs(stepFixationMinMs, stepFixationMaxMs) : fixationPauseMs)),
    [directions, isStep, stepFixationMinMs, stepFixationMaxMs, fixationPauseMs]
  );
  const startTimeRef = useRef(0);
  const [trialIndex, setTrialIndex] = useState(0);
  const [phase, setPhase] = useState<'fixation' | 'moving' | 'between'>('fixation');
  const fixationStartRef = useRef(0);
  const [visualStarted, setVisualStarted] = useState(false);
  const movementStartRef = useRef(0);
  const firstCorrectGazeTimeRef = useRef<number | null>(null);
  const trialGazeSamplesRef = useRef<Array<{ t: number; x: number; y: number; head?: AntiSaccadeHeadPose }>>([]);
  const { headPose } = useNeuroHeadPose();
  const headPoseRef = useRef(headPose);
  headPoseRef.current = headPose;
  const trialsResultsRef = useRef<AntiSaccadeTrialResult[]>([]);
  const betweenStartRef = useRef(0);

  const center = getCenter();
  const { travelX, travelY } = getTravelToEdges(edgePaddingPx);
  const direction = directions[trialIndex];
  const travelPx = direction ? (isHorizontalDirection(direction) ? travelX : travelY) : TRAVEL_DISTANCE_PX;

  const trialDurationMs = isStep
    ? stepDurationMs
    : speedPxPerSec > 0
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
    const now = performance.now();
    startTimeRef.current = now;
    fixationStartRef.current = now;
    movementStartRef.current = now;
    firstCorrectGazeTimeRef.current = null;
    trialGazeSamplesRef.current = [];
    trialsResultsRef.current = [];
  }, []);

  // Onset = the first painted frame of the jump / movement, on the gaze frames' clock.
  useStimulusOnset(trialIndex, phase === 'moving' && visualStarted, useCallback((t: number) => {
    movementStartRef.current = t;
  }, []));

  // Visual movement is driven by CSS transitions (no React setState per frame).
  // Fixation phase: rects frozen at center. Moving phase: trigger CSS transition once.
  useEffect(() => {
    if (phase === 'fixation') {
      setVisualStarted(false); // ensure rects stay at center
      return;
    }
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

      if (phase === 'fixation') {
        // Wait fixationPauseMs before starting movement
        if (now - fixationStartRef.current >= (fixationDurations[trialIndex] ?? fixationPauseMs)) {
          movementStartRef.current = now;
          firstCorrectGazeTimeRef.current = null;
          trialGazeSamplesRef.current = [];
          setPhase('moving');
        }
      } else if (phase === 'moving') {
        const elapsed = now - movementStartRef.current;
        const p = Math.min(1, elapsed / trialDurationMs);
        // In the step paradigm the shapes are at their end positions from the onset.
        const posProgress = isStep ? 1 : p;

        const dimPosNow = dimPosition(dir, center.x, center.y, posProgress, travelPx);
        const g = neuroLiveGazeRef.current;
        const tRel = (now - movementStartRef.current) / 1000;
        const hp = headPoseRef.current;
        trialGazeSamplesRef.current.push({
          t: tRel,
          x: g.x,
          y: g.y,
          ...(hp && { head: { yaw: hp.yaw, pitch: hp.pitch, roll: hp.roll } }),
        });

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
            paradigm,
            fixationMs: fixationDurations[trialIndex],
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
        // 'between' phase
        if (now - betweenStartRef.current >= intervalMs) {
          if (trialIndex + 1 >= trialCount) {
            clearInterval(interval);
            const endTime = performance.now();
            const trials = trialsResultsRef.current;
            // First saccade of each trial on the per-frame gaze. The correct
            // direction is away from the primary (bright) shape.
            const frames = getGazeFrames();
            const { travelX: tx, travelY: ty } = getTravelToEdges(edgePaddingPx);
            for (const tr of trials) {
              const horizontal = isHorizontalDirection(tr.direction);
              const awaySign = tr.direction === 'left' || tr.direction === 'up' ? 1 : -1;
              tr.saccade = detectTrialSaccade(frames, tr.startTime, horizontal ? 'x' : 'y', awaySign, horizontal ? tx : ty);
            }
            const saccades = summariseSaccades(trials.map((t) => t.saccade!));
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
              paradigm,
              metrics: { avgLatency, directionAccuracy, fixationStability, saccades },
              viewportWidth: typeof window !== 'undefined' ? window.innerWidth : undefined,
              viewportHeight: typeof window !== 'undefined' ? window.innerHeight : undefined,
            });
            return;
          }
          setTrialIndex((i) => i + 1);
          setPhase('fixation');
          fixationStartRef.current = performance.now();
        }
      }
    }, gazeIntervalMs);

    return () => clearInterval(interval);
  }, [trialIndex, trialCount, phase, directions, fixationDurations, isStep, paradigm, speedPxPerSec, fallbackDurationMs, intervalMs, gazeIntervalMs, fixationPauseMs, center.x, center.y, trialDurationMs, travelPx, edgePaddingPx, completeTest, getGazeFrames]);

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
      {showReferenceLines && <ReferenceLines className="fixed inset-0" />}

      <p className="text-center text-gray-400 text-sm pt-4 pb-2">
        Look in the opposite direction from the{' '}
        <strong className="text-gray-300">
          {RECT_COLOR_PALETTE[primaryRectColor as keyof typeof RECT_COLOR_PALETTE]?.label.toLowerCase() ?? 'primary'}
        </strong>{' '}
        square
        {dimRectInstructable ? (
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
            opacity={visualStarted || phase === 'fixation' ? 1 : 0}
            ariaHidden
            style={{
              transition: visualStarted && !isStep ? `transform ${trialDurationMs}ms linear` : 'none',
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
                transition: visualStarted && !isStep ? `transform ${trialDurationMs}ms linear` : 'none',
                transform: `translate(${visualStarted ? dimTranslate.x : 0}px, ${visualStarted ? dimTranslate.y : 0}px)`,
              }}
            />
          )}
        </>
      ) : null}
    </div>
  );
}
