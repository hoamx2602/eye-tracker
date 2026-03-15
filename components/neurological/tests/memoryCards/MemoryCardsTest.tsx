'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTestRunner } from '../../TestRunnerContext';
import { useNeuroGaze } from '../../NeuroGazeContext';
import {
  DEFAULT_DWELL_MS,
  DEFAULT_SYMBOL_SCALE,
  DEFAULT_SYMBOL_SIZE,
  FLIP_BACK_DELAY_MS,
  GAZE_PATH_INTERVAL_MS,
  MAX_SYMBOL_SCALE,
  MIN_SYMBOL_SCALE,
  type MemoryCardsGridSize,
  type MemoryCardsSymbolSize,
} from './constants';
import { createBoard } from './utils';

export interface MemoryCardsMove {
  card1Index: number;
  card2Index: number;
  match: boolean;
  timestamp: number;
}

export interface MemoryCardsResult {
  startTime: number;
  endTime: number;
  gridSize: number;
  moves: MemoryCardsMove[];
  correctPairsCount: number;
  completionTimeMs: number;
  gazePath: Array<{ t: number; x: number; y: number }>;
}

const GRID_SIZES: MemoryCardsGridSize[] = [4, 6, 9];
/** Base rem for symbol; scale is applied from config. */
const SYMBOL_BASE_REM = 1.25;
const SYMBOL_SIZE_CLASS: Record<MemoryCardsSymbolSize, string> = {
  md: 'text-2xl',
  lg: 'text-4xl',
  xl: 'text-5xl',
};
const SYMBOLS = '◆●▲■★♦♥♣✓✗○◇☆▪▫①②③④⑤⑥⑦⑧⑨⑩'.split('');

function getSymbol(id: number): string {
  if (id < 0) return '';
  return SYMBOLS[id % SYMBOLS.length] ?? String(id);
}

export default function MemoryCardsTest() {
  const { config, completeTest } = useTestRunner();
  const { gaze } = useNeuroGaze();
  const gazeRef = useRef(gaze);
  gazeRef.current = gaze;
  const gridContainerRef = useRef<HTMLDivElement>(null);

  const gridSize = GRID_SIZES.includes(Number(config.gridSize) as MemoryCardsGridSize)
    ? (Number(config.gridSize) as MemoryCardsGridSize)
    : 4;
  const dwellMs = Math.max(300, Number(config.dwellMs) ?? DEFAULT_DWELL_MS);
  const symbolScaleNum = Number(config.symbolScale);
  const symbolScale = Number.isFinite(symbolScaleNum) && symbolScaleNum >= MIN_SYMBOL_SCALE && symbolScaleNum <= MAX_SYMBOL_SCALE
    ? symbolScaleNum
    : DEFAULT_SYMBOL_SCALE;
  const symbolSize = (['md', 'lg', 'xl'] as MemoryCardsSymbolSize[]).includes(config.symbolSize as MemoryCardsSymbolSize)
    ? (config.symbolSize as MemoryCardsSymbolSize)
    : DEFAULT_SYMBOL_SIZE;
  const symbolClass = Number.isFinite(Number(config.symbolScale)) ? '' : SYMBOL_SIZE_CLASS[symbolSize];
  const symbolStyle = Number.isFinite(Number(config.symbolScale)) ? { fontSize: `${SYMBOL_BASE_REM * symbolScale}rem` } : undefined;

  const [board] = useState(() => createBoard(gridSize));
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [matched, setMatched] = useState<Set<number>>(new Set());
  const [firstSelected, setFirstSelected] = useState<number | null>(null);
  const [secondSelected, setSecondSelected] = useState<number | null>(null);
  const startTimeRef = useRef(0);
  const movesRef = useRef<MemoryCardsMove[]>([]);
  const gazePathRef = useRef<Array<{ t: number; x: number; y: number }>>([]);
  const pathIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dwellCardRef = useRef<number | null>(null);
  const dwellStartRef = useRef<number>(0);
  const lockedRef = useRef(false);
  const flipBackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pairCount = Math.floor((gridSize * gridSize) / 2);
  const allMatched = matched.size === pairCount * 2;

  const selectCard = useCallback(
    (index: number) => {
      if (lockedRef.current) return;
      const value = board[index];
      if (value < 0) return; // empty cell (9×9)
      if (matched.has(index)) return;
      if (firstSelected === null) {
        setFirstSelected(index);
        setRevealed((r) => new Set(r).add(index));
        return;
      }
      if (firstSelected === index) return;
      if (secondSelected !== null) return;
      setSecondSelected(index);
      setRevealed((r) => new Set(r).add(index));
      const ts = performance.now();
      const match = board[firstSelected] === value;
      movesRef.current.push({
        card1Index: firstSelected,
        card2Index: index,
        match,
        timestamp: ts,
      });
      if (match) {
        setMatched((m) => new Set(m).add(firstSelected).add(index));
        setFirstSelected(null);
        setSecondSelected(null);
      } else {
        lockedRef.current = true;
        if (flipBackTimeoutRef.current) clearTimeout(flipBackTimeoutRef.current);
        flipBackTimeoutRef.current = setTimeout(() => {
          setRevealed((r) => {
            const next = new Set(r);
            next.delete(firstSelected);
            next.delete(index);
            return next;
          });
          setFirstSelected(null);
          setSecondSelected(null);
          lockedRef.current = false;
          flipBackTimeoutRef.current = null;
        }, FLIP_BACK_DELAY_MS);
      }
    },
    [board, firstSelected, secondSelected, matched]
  );

  useEffect(() => {
    startTimeRef.current = performance.now();
    movesRef.current = [];
    gazePathRef.current = [];
    pathIntervalRef.current = setInterval(() => {
      const g = gazeRef.current;
      const t = (performance.now() - startTimeRef.current) / 1000;
      gazePathRef.current.push({ t, x: g.x, y: g.y });
    }, GAZE_PATH_INTERVAL_MS);
    return () => {
      if (pathIntervalRef.current) clearInterval(pathIntervalRef.current);
    };
  }, []);

  // Dwell: which card is gaze over? If same card for dwellMs, select it.
  useEffect(() => {
    const interval = setInterval(() => {
      const el = gridContainerRef.current;
      const g = gazeRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cellW = rect.width / gridSize;
      const cellH = rect.height / gridSize;
      const col = Math.floor((g.x - rect.left) / cellW);
      const row = Math.floor((g.y - rect.top) / cellH);
      const index = row * gridSize + col;
      if (col < 0 || col >= gridSize || row < 0 || row >= gridSize) {
        dwellCardRef.current = null;
        return;
      }
      if (board[index] < 0 || matched.has(index)) {
        dwellCardRef.current = null;
        return;
      }
      const now = performance.now();
      if (dwellCardRef.current !== index) {
        dwellCardRef.current = index;
        dwellStartRef.current = now;
        return;
      }
      if (now - dwellStartRef.current >= dwellMs) {
        selectCard(index);
        dwellCardRef.current = null;
      }
    }, 100);
    return () => clearInterval(interval);
  }, [board, gridSize, matched, dwellMs, selectCard]);

  // Completion
  useEffect(() => {
    if (!allMatched) return;
    const endTime = performance.now();
    if (pathIntervalRef.current) {
      clearInterval(pathIntervalRef.current);
      pathIntervalRef.current = null;
    }
    const correctPairsCount = movesRef.current.filter((m) => m.match).length;
    completeTest({
      testId: 'memory_cards',
      startTime: startTimeRef.current,
      endTime,
      gridSize,
      moves: [...movesRef.current],
      correctPairsCount,
      completionTimeMs: endTime - startTimeRef.current,
      gazePath: [...gazePathRef.current],
    });
  }, [allMatched, completeTest, gridSize]);

  useEffect(() => () => {
    if (flipBackTimeoutRef.current) clearTimeout(flipBackTimeoutRef.current);
  }, []);

  const isRevealed = (i: number) => revealed.has(i) || matched.has(i);
  const isSelected = (i: number) => i === firstSelected || i === secondSelected;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gray-950 p-4"
      role="region"
      aria-label="Memory cards: find matching pairs"
    >
      <p className="text-center text-gray-400 text-sm mb-3">
        Click a card (or look at it) to flip. Find all {pairCount} pairs.
      </p>
      <div
        ref={gridContainerRef}
        className="grid gap-1.5 place-items-center shrink-0"
        style={{
          gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${gridSize}, minmax(0, 1fr))`,
          width: 'min(92vw, 85vh)',
          height: 'min(92vw, 85vh)',
          aspectRatio: '1',
        }}
      >
        {board.map((value, index) => (
          <button
            key={index}
            type="button"
            disabled={value < 0 || matched.has(index) || secondSelected !== null}
            onClick={() => selectCard(index)}
            className={`
              w-full h-full min-w-[28px] min-h-[28px] rounded-lg border-2 flex items-center justify-center font-bold ${symbolClass}
              transition-all duration-200
              ${value < 0 ? 'invisible' : ''}
              ${matched.has(index) ? 'bg-emerald-700 border-emerald-500 text-white' : ''}
              ${revealed.has(index) && !matched.has(index) ? 'bg-blue-600 border-blue-400 text-white' : ''}
              ${!isRevealed(index) ? 'bg-slate-700 border-slate-500 text-slate-300 hover:border-slate-400' : ''}
              ${isSelected(index) ? 'ring-2 ring-amber-400 ring-offset-2 ring-offset-gray-950' : ''}
            `}
            aria-pressed={isRevealed(index)}
            aria-label={isRevealed(index) ? `Card ${getSymbol(value)}` : 'Face-down card'}
            style={symbolStyle}
          >
            {isRevealed(index) ? getSymbol(value) : '?'}
          </button>
        ))}
      </div>
      <p className="text-center text-slate-500 text-xs mt-3">
        Pairs found: {matched.size / 2} / {pairCount}
      </p>
    </div>
  );
}
