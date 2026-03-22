'use client';

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTestRunner } from '../../TestRunnerContext';
import { useNeuroGaze } from '../../NeuroGazeContext';
import {
  DEFAULT_AOI_RADIUS_PX,
  DEFAULT_NUMBER_COUNT,
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
}

export default function VisualSearchTest() {
  const { config, completeTest } = useTestRunner();
  const { gazeModelReady } = useNeuroGaze();

  const numberCount = Math.max(6, Math.min(10, Number(config.numberCount) ?? DEFAULT_NUMBER_COUNT));
  const aoiRadiusPx = Math.max(20, Number(config.aoiRadiusPx) ?? DEFAULT_AOI_RADIUS_PX);

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
    [completeTest, positions]
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
      {!gazeModelReady && (
        <div className="mx-auto mb-2 max-w-xl rounded-lg border border-amber-700/55 bg-amber-950/45 px-3 py-2 text-center text-[11px] leading-relaxed text-amber-100">
          Chưa có mô hình gaze trong session này — ứng dụng không ước lượng được tọa độ màn hình, chỉ ghi nhận (0,0), nên không có scanpath/AOI đúng nghĩa. Hoàn thành calibration (tracking) trước khi làm bài neurological.
        </div>
      )}
      <div ref={stimulusAreaRef} className="flex-1 relative min-h-0">
        {positions.map((pos) => (
          <div
            key={pos.number}
            className="absolute w-14 h-14 flex items-center justify-center rounded-full bg-blue-600/90 text-white text-2xl font-bold shadow-lg border-2 border-blue-400"
            style={{
              left: `${pos.x}%`,
              top: `${pos.y}%`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            {pos.number}
          </div>
        ))}
      </div>
      <p className="text-center text-amber-400/90 text-xs pb-6">
        Press SPACE when you have looked at all numbers in order.
      </p>
    </div>
  );
}
