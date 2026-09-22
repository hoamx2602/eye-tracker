'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTestRunner } from '../../TestRunnerContext';
import { useNeuroGaze } from '../../NeuroGazeContext';
import { useNeuroHeadPose } from '../../NeuroHeadPoseContext';
import {
  DEFAULT_AOI_RADIUS_PX,
  DEFAULT_NUMBER_COUNT,
  DEFAULT_CONFIRM_MODE,
  DEFAULT_CLICK_HOLD_DURATION_MS,
  GAZE_PATH_INTERVAL_MS,
  DWELL_CONFIRM_MS,
} from './constants';
import type { VisualSearchConfirmMode } from './constants';
import { generateNumberPositions } from './utils';
import {
  HoldRingKeyframes,
  TargetButton,
  confirmModeInstruction,
  useHoldConfirm,
  type ConfirmDetail,
} from './TargetButton';
import { neuroDebugLog } from '@/lib/neuroDebugLog';
import { neuroLiveGazeRef } from '@/lib/neuroLiveGaze';

const VISUAL_SEARCH_RESULT_LS_KEY = 'neuro_visual_search_result_v1';

// SVG progress ring: circumference of r=26 circle inside 56×56 button

export interface NumberPosition {
  number: number;
  x: number;
  y: number;
}

export interface VisualSearchFixation {
  number: number;
  timestamp: number;
  gazeX: number;
  gazeY: number;
  /** How this fixation was recorded. */
  source?: 'aoi' | 'pointer';
  /** Viewport client coordinates for pointer confirmations (when `source === 'pointer'`). */
  pointerX?: number;
  pointerY?: number;
  /** Duration ms between pointer down and up (pointer confirmations only). */
  holdDurationMs?: number;
  /** Head pose at the moment of this fixation. */
  head?: { yaw: number; pitch: number; roll: number };
}

export interface VisualSearchResult {
  startTime: number;
  endTime: number;
  numberPositions: NumberPosition[];
  fixations: VisualSearchFixation[];
  sequence: number[];
  completionTimeMs: number;
  gazePath: Array<{ t: number; x: number; y: number }>;
  gazeFixationPerNumber: Record<number, number>;
  gazeSequence: number[];
  scanningPath: Array<{ t: number; x: number; y: number }>;
  viewportWidth?: number;
  viewportHeight?: number;
  stimulusBounds?: { left: number; top: number; width: number; height: number };
  confirmMode?: VisualSearchConfirmMode;
  clickHoldDurationMs?: number;
}

export default function VisualSearchTest() {
  const { config, completeTest } = useTestRunner();
  const { gazeModelReady } = useNeuroGaze();

  const numberCount = Math.max(6, Math.min(10, Number(config.numberCount) ?? DEFAULT_NUMBER_COUNT));
  const aoiRadiusPx = Math.max(20, Number(config.aoiRadiusPx) ?? DEFAULT_AOI_RADIUS_PX);
  const confirmMode = (['gaze', 'hold', 'click'].includes(config.confirmMode as string)
    ? config.confirmMode
    : DEFAULT_CONFIRM_MODE) as VisualSearchConfirmMode;
  const clickHoldDurationMs = Math.max(
    0,
    Math.min(2000, Number(config.clickHoldDurationMs ?? DEFAULT_CLICK_HOLD_DURATION_MS))
  );
  const gazeIntervalMs = Math.max(16, Number(config.gazeSampleIntervalMs) || GAZE_PATH_INTERVAL_MS);
  const edgePaddingPx = Math.max(0, Number(config.edgePaddingPx) || 0);

  const positions = useMemo(
    () => generateNumberPositions(numberCount, undefined, edgePaddingPx, typeof window !== 'undefined' ? window.innerWidth : 0, typeof window !== 'undefined' ? window.innerHeight : 0),
    [numberCount, edgePaddingPx]
  );

  // ── Data recording refs ────────────────────────────────────────────────────
  const stimulusAreaRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<number>(0);
  const fixationsRef = useRef<VisualSearchFixation[]>([]);
  const { headPose } = useNeuroHeadPose();
  const headPoseRef = useRef(headPose);
  headPoseRef.current = headPose;
  const currentHead = () => {
    const hp = headPoseRef.current;
    return hp ? { yaw: hp.yaw, pitch: hp.pitch, roll: hp.roll } : undefined;
  };
  const sequenceRef = useRef<number[]>([]);
  const gazePathRef = useRef<Array<{ t: number; x: number; y: number }>>([]);
  const lastInNumberRef = useRef<number | null>(null);
  // Legacy pointer ref — used only when confirmMode is 'hold' for fixation recording on release
  const pointerHoldRef = useRef<{ number: number; t0: number; pointerId: number } | null>(null);

  // ── Hold-confirmation state ────────────────────────────────────────────────
  // holdingNumber: which target is currently being held (shows progress ring)
  // confirmedNumbers: targets held for DWELL_CONFIRM_MS (turn green)
  const [confirmedNumbers, setConfirmedNumbers] = useState<ReadonlySet<number>>(new Set());
  /** Targets pressed out of order. Refused on screen, but kept as a measure. */
  const orderErrorsRef = useRef<Array<{ pressed: number; expected: number; timestamp: number }>>([]);
  /** The target briefly flashed red after a refused press. */
  const [wrongNumber, setWrongNumber] = useState<number | null>(null);
  const wrongTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Legacy: record fixation on pointer release (only when confirmMode is 'hold')
  const recordPointerConfirmation = useCallback(
    (number: number, e: React.PointerEvent) => {
      const h = pointerHoldRef.current;
      pointerHoldRef.current = null;
      if (!h || h.number !== number || h.pointerId !== e.pointerId) return;
      const holdMs = performance.now() - h.t0;
      if (clickHoldDurationMs > 0 && holdMs < clickHoldDurationMs) return;
      const g = neuroLiveGazeRef.current;
      const t = performance.now();
      fixationsRef.current.push({
        number,
        timestamp: t,
        gazeX: g.x,
        gazeY: g.y,
        source: 'pointer',
        pointerX: e.clientX,
        pointerY: e.clientY,
        holdDurationMs: Math.round(holdMs),
        head: currentHead(),
      });
      if (!sequenceRef.current.includes(number)) {
        sequenceRef.current.push(number);
      }
    },
    [clickHoldDurationMs]
  );

  // ── Completion logic ──────────────────────────────────────────────────────
  const finishTest = useCallback(() => {
    const endTime = performance.now();
    const g = neuroLiveGazeRef.current;
    const tRel = (endTime - startTimeRef.current) / 1000;
    const pathSnapshot = [...gazePathRef.current, { t: tRel, x: g.x, y: g.y }];
    const rect = stimulusAreaRef.current?.getBoundingClientRect();
    const stimulusBounds = rect
      ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      : undefined;
    const fixationPerNumber = fixationsRef.current.reduce<Record<number, number>>((acc, fx) => {
      acc[fx.number] = (acc[fx.number] ?? 0) + 1;
      return acc;
    }, {});
    const gazeSequence = [...sequenceRef.current];
    const scanningPath = pathSnapshot;
    const completionTimeMs = endTime - startTimeRef.current;
    const payload = {
      testId: 'visual_search',
      startTime: startTimeRef.current,
      endTime,
      numberPositions: positions,
      fixations: [...fixationsRef.current],
      sequence: gazeSequence,
      orderErrors: [...orderErrorsRef.current],
      completionTimeMs,
      gazePath: scanningPath,
      gazeFixationPerNumber: fixationPerNumber,
      gazeSequence,
      scanningPath,
      viewportWidth: typeof window !== 'undefined' ? window.innerWidth : undefined,
      viewportHeight: typeof window !== 'undefined' ? window.innerHeight : undefined,
      stimulusBounds,
      confirmMode,
      clickHoldDurationMs: confirmMode === 'hold' ? clickHoldDurationMs : undefined,
    };
    try {
      localStorage.setItem(
        VISUAL_SEARCH_RESULT_LS_KEY,
        JSON.stringify({
          savedAt: new Date().toISOString(),
          completionTimeMs,
          gazeFixationPerNumber: fixationPerNumber,
          gazeSequence,
          scanningPath,
        })
      );
    } catch (_) {}
    neuroDebugLog('[VisualSearch] complete', {
      scanningPathLen: scanningPath.length,
      fixations: fixationsRef.current.length,
      hasStimulusBounds: Boolean(stimulusBounds),
    });
    completeTest(payload);
  }, [completeTest, positions, confirmMode, clickHoldDurationMs]);

  // ── Pointer handlers ──────────────────────────────────────────────────────
  // The gesture and the visuals live in TargetButton, shared with the practice
  // round; recording stays here, where the gaze refs are.
  /** The next number due, or null once every target is confirmed. */
  const nextExpected = useMemo(() => {
    for (let n = 1; n <= positions.length; n++) {
      if (!confirmedNumbers.has(n)) return n;
    }
    return null;
  }, [confirmedNumbers, positions.length]);

  const handleWrongOrder = useCallback((pressed: number, expected: number) => {
    orderErrorsRef.current.push({ pressed, expected, timestamp: performance.now() });
    setWrongNumber(pressed);
    if (wrongTimerRef.current) clearTimeout(wrongTimerRef.current);
    wrongTimerRef.current = setTimeout(() => setWrongNumber(null), 400);
  }, []);

  useEffect(() => () => {
    if (wrongTimerRef.current) clearTimeout(wrongTimerRef.current);
  }, []);

  const handleConfirm = useCallback(
    (number: number, detail: ConfirmDetail) => {
      const g = neuroLiveGazeRef.current;
      fixationsRef.current.push({
        number,
        timestamp: performance.now(),
        gazeX: g.x,
        gazeY: g.y,
        source: 'pointer',
        ...(detail.pointerX != null ? { pointerX: detail.pointerX } : {}),
        ...(detail.pointerY != null ? { pointerY: detail.pointerY } : {}),
        holdDurationMs: detail.holdDurationMs,
        head: currentHead(),
      });
      if (!sequenceRef.current.includes(number)) {
        sequenceRef.current.push(number);
      }

      // Every mode turns the target green. Gaze mode previously did not, while
      // its own instruction line promised "hold each number until it turns
      // green" — so a participant following the instruction got no feedback at
      // all and had no way to tell which numbers they had already done.
      setConfirmedNumbers((prev) => {
        const next = new Set(prev);
        next.add(number);
        // The last target ends the test. Order is enforced, so reaching the
        // last one means the whole sequence is done — there is nothing left
        // for a participant to decide, and nothing for a key press to add.
        if (next.size >= positions.length) {
          setTimeout(() => finishTest(), 100);
        }
        return next;
      });
    },
    [finishTest, positions.length]
  );

  const { holdingNumber, onPointerDown, onPointerUp, onPointerCancel } = useHoldConfirm({
    confirmMode,
    nextExpected,
    onConfirm: handleConfirm,
    onWrongOrder: handleWrongOrder,
    onPointerDownExtra: (number, e) => {
      // Legacy fixation tracking on release (hold mode only)
      if (confirmMode === 'hold') {
        pointerHoldRef.current = { number, t0: performance.now(), pointerId: e.pointerId };
      }
    },
    onPointerUpExtra: (number, e) => {
      if (confirmMode === 'hold') recordPointerConfirmation(number, e);
    },
  });

  // ── AOI check (gaze recording only — no dwell logic here) ─────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const g = neuroLiveGazeRef.current;
      const rect = stimulusAreaRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      let found: number | null = null;
      for (const pos of positions) {
        const centerX = rect.left + (pos.x / 100) * rect.width;
        const centerY = rect.top + (pos.y / 100) * rect.height;
        if (Math.hypot(g.x - centerX, g.y - centerY) <= aoiRadiusPx) {
          found = pos.number;
          break;
        }
      }
      if (found !== null && found !== lastInNumberRef.current) {
        lastInNumberRef.current = found;
        const t = performance.now();
        fixationsRef.current.push({
          number: found,
          timestamp: t,
          gazeX: g.x,
          gazeY: g.y,
          source: 'aoi',
          head: currentHead(),
        });
        if (!sequenceRef.current.includes(found)) {
          sequenceRef.current.push(found);
        }
      }
      if (found === null) lastInNumberRef.current = null;
    }, 80);
    return () => clearInterval(interval);
  }, [positions, aoiRadiusPx]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-gray-950"
      role="region"
      aria-label="Visual search test: find and confirm the numbers in order"
    >
      <HoldRingKeyframes />

      <p className="text-center text-gray-400 text-sm mt-4 mb-2">
        {confirmModeInstruction(confirmMode, numberCount)}
      </p>

      {!gazeModelReady && (
        <div className="mx-auto mb-2 max-w-xl rounded-lg border border-amber-700/55 bg-amber-950/45 px-3 py-2 text-center text-[11px] leading-relaxed text-amber-100">
          No gaze model in this session yet — screen coordinates are not estimated; only (0,0) is recorded, so scanpath/AOIs are not meaningful. Complete calibration (tracking) before neurological tests.
        </div>
      )}

      <div ref={stimulusAreaRef} className="flex-1 relative min-h-0">
        {positions.map((pos) => {
          const confirmed = confirmedNumbers.has(pos.number);
          const holding = holdingNumber === pos.number;

          return (
            <TargetButton
              key={pos.number}
              number={pos.number}
              x={pos.x}
              y={pos.y}
              confirmed={confirmed}
              holding={holding}
              wrong={wrongNumber === pos.number}
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
            />
          );
        })}
      </div>

    </div>
  );
}
