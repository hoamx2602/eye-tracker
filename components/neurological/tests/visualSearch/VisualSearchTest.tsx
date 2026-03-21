'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTestRunner } from '../../TestRunnerContext';
import { useNeuroGaze } from '../../NeuroGazeContext';
import {
  DEFAULT_AOI_RADIUS_PX,
  DEFAULT_NUMBER_COUNT,
  GAZE_PATH_INTERVAL_MS,
} from './constants';
import { generateNumberPositions } from './utils';

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
}

export default function VisualSearchTest() {
  const { config, completeTest } = useTestRunner();
  const { gaze } = useNeuroGaze();
  const gazeRef = useRef(gaze);
  gazeRef.current = gaze;

  const numberCount = Math.max(6, Math.min(10, Number(config.numberCount) ?? DEFAULT_NUMBER_COUNT));
  const aoiRadiusPx = Math.max(20, Number(config.aoiRadiusPx) ?? DEFAULT_AOI_RADIUS_PX);

  const positions = useMemo(
    () => generateNumberPositions(numberCount),
    [numberCount]
  );

  const startTimeRef = useRef<number>(0);
  const fixationsRef = useRef<VisualSearchFixation[]>([]);
  const sequenceRef = useRef<number[]>([]);
  const gazePathRef = useRef<Array<{ t: number; x: number; y: number }>>([]);
  const lastInNumberRef = useRef<number | null>(null);
  const pathIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      e.preventDefault();
      const endTime = performance.now();
      const fixationPerNumber = fixationsRef.current.reduce<Record<number, number>>((acc, fx) => {
        acc[fx.number] = (acc[fx.number] ?? 0) + 1;
        return acc;
      }, {});
      const gazeSequence = [...sequenceRef.current];
      const scanningPath = [...gazePathRef.current];
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
      completeTest(payload);
    },
    [completeTest, positions]
  );

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

    pathIntervalRef.current = setInterval(() => {
      const g = gazeRef.current;
      const t = (performance.now() - startTimeRef.current) / 1000;
      gazePathRef.current.push({ t, x: g.x, y: g.y });
    }, GAZE_PATH_INTERVAL_MS);

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (pathIntervalRef.current) {
        clearInterval(pathIntervalRef.current);
        pathIntervalRef.current = null;
      }
    };
  }, [handleKeyDown]);

  // AOI check: which number is gaze inside? Run on interval to avoid too many updates
  useEffect(() => {
    const interval = setInterval(() => {
      const g = gazeRef.current;
      const w = typeof window !== 'undefined' ? window.innerWidth : 1920;
      const h = typeof window !== 'undefined' ? window.innerHeight : 1080;
      let found: number | null = null;
      for (const pos of positions) {
        const centerX = (pos.x / 100) * w;
        const centerY = (pos.y / 100) * h;
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
      <div className="flex-1 relative">
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
