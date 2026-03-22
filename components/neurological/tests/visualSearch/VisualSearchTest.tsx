'use client';

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTestRunner } from '../../TestRunnerContext';
import { useNeuroGaze } from '../../NeuroGazeContext';
import {
  DEFAULT_AOI_RADIUS_PX,
  DEFAULT_NUMBER_COUNT,
  DEFAULT_ALLOW_CLICK_TARGETS,
  DEFAULT_CLICK_HOLD_DURATION_MS,
  GAZE_PATH_INTERVAL_MS,
} from './constants';
import { generateNumberPositions } from './utils';
import { neuroDebugLog } from '@/lib/neuroDebugLog';
import { neuroLiveGazeRef } from '@/lib/neuroLiveGaze';

const VISUAL_SEARCH_RESULT_LS_KEY = 'neuro_visual_search_result_v1';

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
  /**
   * Vùng lưới số (getBoundingClientRect) — cùng hệ với gaze (viewport px).
   * Dùng để map % trong numberPositions → pixel đúng như lúc test (không phải full viewport).
   */
  stimulusBounds?: { left: number; top: number; width: number; height: number };
  /** Config snapshot for analysis (optional). */
  allowClickTargets?: boolean;
  clickHoldDurationMs?: number;
}

export default function VisualSearchTest() {
  const { config, completeTest } = useTestRunner();
  const { gazeModelReady } = useNeuroGaze();

  const numberCount = Math.max(6, Math.min(10, Number(config.numberCount) ?? DEFAULT_NUMBER_COUNT));
  const aoiRadiusPx = Math.max(20, Number(config.aoiRadiusPx) ?? DEFAULT_AOI_RADIUS_PX);
  const allowClickTargets = Boolean(config.allowClickTargets ?? DEFAULT_ALLOW_CLICK_TARGETS);
  const clickHoldDurationMs = Math.max(
    0,
    Math.min(2000, Number(config.clickHoldDurationMs ?? DEFAULT_CLICK_HOLD_DURATION_MS))
  );

  const positions = useMemo(
    () => generateNumberPositions(numberCount),
    [numberCount]
  );

  const stimulusAreaRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<number>(0);
  const fixationsRef = useRef<VisualSearchFixation[]>([]);
  const sequenceRef = useRef<number[]>([]);
  const gazePathRef = useRef<Array<{ t: number; x: number; y: number }>>([]);
  const lastInNumberRef = useRef<number | null>(null);
  const pointerHoldRef = useRef<{ number: number; t0: number; pointerId: number } | null>(null);

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
      });
      if (!sequenceRef.current.includes(number)) {
        sequenceRef.current.push(number);
      }
    },
    [clickHoldDurationMs]
  );

  const onPointerDownTarget = useCallback(
    (number: number, e: React.PointerEvent<HTMLButtonElement>) => {
      if (!allowClickTargets) return;
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch (_) {}
      pointerHoldRef.current = { number, t0: performance.now(), pointerId: e.pointerId };
    },
    [allowClickTargets]
  );

  const onPointerUpTarget = useCallback(
    (number: number, e: React.PointerEvent<HTMLButtonElement>) => {
      if (!allowClickTargets) return;
      e.preventDefault();
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch (_) {}
      recordPointerConfirmation(number, e);
    },
    [allowClickTargets, recordPointerConfirmation]
  );

  const onPointerCancelTarget = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    pointerHoldRef.current = null;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch (_) {}
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      e.preventDefault();
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
        completionTimeMs,
        gazePath: scanningPath,
        gazeFixationPerNumber: fixationPerNumber,
        gazeSequence,
        scanningPath,
        viewportWidth: typeof window !== 'undefined' ? window.innerWidth : undefined,
        viewportHeight: typeof window !== 'undefined' ? window.innerHeight : undefined,
        stimulusBounds,
        allowClickTargets,
        clickHoldDurationMs: allowClickTargets ? clickHoldDurationMs : undefined,
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
    },
    [completeTest, positions, allowClickTargets, clickHoldDurationMs]
  );

  /** Không phụ thuộc handleKeyDown — tránh reset gazePath mỗi khi callback đổi (mất toàn bộ mẫu gaze). */
  useEffect(() => {
    startTimeRef.current = performance.now();
    fixationsRef.current = [];
    sequenceRef.current = [];
    gazePathRef.current = [];
    lastInNumberRef.current = null;
    try {
      localStorage.setItem(
        VISUAL_SEARCH_RESULT_LS_KEY,
        JSON.stringify({
          savedAt: new Date().toISOString(),
          status: 'in_progress',
          completionTimeMs: 0,
          gazeFixationPerNumber: {},
          gazeSequence: [],
          scanningPath: [],
        })
      );
    } catch (_) {}

    const pathInterval = window.setInterval(() => {
      const g = neuroLiveGazeRef.current;
      const t = (performance.now() - startTimeRef.current) / 1000;
      gazePathRef.current.push({ t, x: g.x, y: g.y });
    }, GAZE_PATH_INTERVAL_MS);

    return () => {
      window.clearInterval(pathInterval);
    };
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // AOI check: which number is gaze inside? Run on interval to avoid too many updates
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
        });
        if (!sequenceRef.current.includes(found)) {
          sequenceRef.current.push(found);
        }
      }
      if (found === null) {
        lastInNumberRef.current = null;
      }
    }, 80);
    return () => clearInterval(interval);
  }, [positions, aoiRadiusPx]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-gray-950"
      role="region"
      aria-label="Visual search test: look at numbers in order, then press SPACE"
    >
      <p className="text-center text-gray-400 text-sm mt-4 mb-2">
        Look at each number in order (1 → 2 → … → {numberCount}). Press <kbd className="px-1.5 py-0.5 rounded bg-gray-700 font-mono">SPACE</kbd> when done.
      </p>
      {allowClickTargets && (
        <p className="mx-auto mb-2 max-w-xl px-3 text-center text-[11px] leading-relaxed text-slate-400">
          {clickHoldDurationMs > 0 ? (
            <>
              Press and hold each number for at least <span className="font-mono text-slate-300">{clickHoldDurationMs}</span> ms, then release to log
              pointer + gaze (optional).
            </>
          ) : (
            <>Tap each number once to log pointer + gaze at that moment (optional).</>
          )}
        </p>
      )}
      {!gazeModelReady && (
        <div className="mx-auto mb-2 max-w-xl rounded-lg border border-amber-700/55 bg-amber-950/45 px-3 py-2 text-center text-[11px] leading-relaxed text-amber-100">
          No gaze model in this session yet — screen coordinates are not estimated; only (0,0) is recorded, so scanpath/AOIs are not meaningful. Complete calibration (tracking) before neurological tests.
        </div>
      )}
      <div ref={stimulusAreaRef} className="flex-1 relative min-h-0">
        {positions.map((pos) => {
          const commonStyle = {
            left: `${pos.x}%`,
            top: `${pos.y}%`,
            transform: 'translate(-50%, -50%)',
          } as const;
          const commonClass =
            'absolute w-14 h-14 flex items-center justify-center rounded-full bg-blue-600/90 text-white text-2xl font-bold shadow-lg border-2 border-blue-400 touch-manipulation select-none';
          if (allowClickTargets) {
            return (
              <button
                key={pos.number}
                type="button"
                className={`${commonClass} cursor-pointer ring-offset-2 ring-offset-gray-950 hover:bg-blue-500/95 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400`}
                style={commonStyle}
                aria-label={`Target ${pos.number}, press and hold to confirm`}
                onPointerDown={(e) => onPointerDownTarget(pos.number, e)}
                onPointerUp={(e) => onPointerUpTarget(pos.number, e)}
                onPointerCancel={onPointerCancelTarget}
              >
                {pos.number}
              </button>
            );
          }
          return (
            <div key={pos.number} className={commonClass} style={commonStyle}>
              {pos.number}
            </div>
          );
        })}
      </div>
      <p className="text-center text-amber-400/90 text-xs pb-6">
        Press SPACE when you have looked at all numbers in order.
      </p>
    </div>
  );
}
