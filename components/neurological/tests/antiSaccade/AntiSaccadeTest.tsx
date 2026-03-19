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
}

export interface AntiSaccadeResult {
  startTime: number;
  endTime: number;
  trials: AntiSaccadeTrialResult[];
  metrics?: {
    avgLatency?: number;
    directionAccuracy?: number;
    fixationStability?: number;
  };
}

const EDGE_MARGIN_PX = 24;

function getCenter(): { x: number; y: number } {
  if (typeof window === 'undefined') return { x: 960, y: 540 };
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

/** Distance from screen center to near edge (used for real test). */
function getTravelToEdges(): { travelX: number; travelY: number } {
  if (typeof window === 'undefined') return { travelX: TRAVEL_DISTANCE_PX, travelY: TRAVEL_DISTANCE_PX };
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  const travelX = Math.max(TRAVEL_DISTANCE_PX, Math.min(cx - EDGE_MARGIN_PX, window.innerWidth - cx - EDGE_MARGIN_PX));
  const travelY = Math.max(TRAVEL_DISTANCE_PX, Math.min(cy - EDGE_MARGIN_PX, window.innerHeight - cy - EDGE_MARGIN_PX));
  return { travelX, travelY };
}

export default function AntiSaccadeTest() {
  const { config, completeTest } = useTestRunner();
  const { gaze } = useNeuroGaze();
  const gazeRef = useRef(gaze);
  gazeRef.current = gaze;

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
  const { travelX, travelY } = getTravelToEdges();
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
        const g = gazeRef.current;
        const tRel = (now - movementStartRef.current) / 1000;
        trialGazeSamplesRef.current.push({ t: tRel, x: g.x, y: g.y });

        const inDimAOI = Math.hypot(g.x - dimPosNow.x, g.y - dimPosNow.y) <= AOI_RADIUS_PX;
        if (inDimAOI && firstCorrectGazeTimeRef.current === null) {
          firstCorrectGazeTimeRef.current = now;
        }

        if (p >= 1) {
          const trialStart = movementStartRef.current;
          const firstCorrect = firstCorrectGazeTimeRef.current;
          trialsResultsRef.current.push({
            direction: dir,
            startTime: trialStart,
            firstCorrectGazeTime: firstCorrect ?? undefined,
            latencyMs: firstCorrect != null ? firstCorrect - trialStart : undefined,
            gazeSamples: [...trialGazeSamplesRef.current],
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
            completeTest({
              testId: 'anti_saccade',
              startTime: startTimeRef.current,
              endTime,
              trials,
              metrics: { avgLatency, directionAccuracy, fixationStability },
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
    }, GAZE_SAMPLE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [trialIndex, trialCount, phase, directions, speedPxPerSec, fallbackDurationMs, intervalMs, center.x, center.y, trialDurationMs, travelPx, completeTest]);

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
