'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTestRunner } from '../../TestRunnerContext';
import { useNeuroGaze } from '../../NeuroGazeContext';
import {
  DEFAULT_DWELL_MS,
  DEFAULT_CARD_COUNT,
  FLIP_BACK_DELAY_MS,
  GAZE_PATH_INTERVAL_MS,
  SYMBOL_SIZE_PX,
  MEMORY_CARDS_CARD_COUNTS,
  MEMORY_CARDS_SYMBOL_SIZES,
  type MemoryCardsCardCount,
  type MemoryCardsSymbolSize,
  DEFAULT_CARD_GAP_PX,
} from './constants';
import { createBoard } from './utils';
import { neuroLiveGazeRef } from '@/lib/neuroLiveGaze';

const MEMORY_CARDS_RESULT_LS_KEY = 'neuro_memory_cards_result_v1';

export interface MemoryCardsMove {
  card1Index: number;
  card2Index: number;
  match: boolean;
  timestamp: number;
}

/** `getBoundingClientRect()` của lưới — cùng hệ tọa độ gaze (viewport px). */
export type MemoryCardsGridRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export interface MemoryCardsResult {
  startTime: number;
  endTime: number;
  cardCount: number;
  cols: number;
  rows: number;
  /** Bố cục bài (symbol id mỗi ô) — để tái hiện lưới trên màn kết quả. */
  board: number[];
  moves: MemoryCardsMove[];
  numberOfMoves: number;
  correctPairsCount: number;
  completionTimeMs: number;
  gazePath: Array<{ t: number; x: number; y: number }>;
  viewportWidth?: number;
  viewportHeight?: number;
  /** Lưới card lúc hoàn thành — căn gaze path chính xác trên kết quả. */
  gridRect?: MemoryCardsGridRect;
}

const SYMBOL_BASE_REM = 1.25;
const SYMBOLS = '◆●▲■★♦♥♣✓✗○◇☆▪▫①②③④⑤⑥⑦⑧⑨⑩'.split('');

function getSymbol(id: number): string {
  if (id < 0) return '';
  return SYMBOLS[id % SYMBOLS.length] ?? String(id);
}

export default function MemoryCardsTest() {
  const { config, completeTest } = useTestRunner();
  useNeuroGaze();
  const gridContainerRef = useRef<HTMLDivElement>(null);

  const cardCountNum = Number(config.cardCount);
  const cardCount = (MEMORY_CARDS_CARD_COUNTS as readonly number[]).includes(cardCountNum)
    ? (cardCountNum as MemoryCardsCardCount)
    : DEFAULT_CARD_COUNT;
  const dwellMs = Math.max(300, Number(config.dwellMs) ?? DEFAULT_DWELL_MS);
  const gazeIntervalMs = Math.max(16, Number(config.gazeSampleIntervalMs) || GAZE_PATH_INTERVAL_MS);
  const presetSize = (MEMORY_CARDS_SYMBOL_SIZES as readonly string[]).includes(String(config.symbolSize))
    ? (String(config.symbolSize) as MemoryCardsSymbolSize)
    : 'lg';
  const symbolPx = SYMBOL_SIZE_PX[presetSize] ?? 46;
  const symbolStyle = { fontSize: `${symbolPx}px` };
  const cardGapPx = Math.max(0, Number(config.cardGapPx ?? DEFAULT_CARD_GAP_PX));
  // Card = icon + 20px padding on each side, never smaller than icon + 12px
  const cardSizePx = symbolPx + 40;

  // Log config for debugging.
  useEffect(() => {
    console.log('[MemoryCards] config', JSON.stringify(config), '→ cardCount', cardCount, 'symbolSize', presetSize, '→ style', symbolStyle);
  }, [config.cardCount, config.dwellMs, config.symbolSize, cardCount, presetSize, symbolStyle.fontSize]);

  const [{ cards: board, cols, rows }] = useState(() => createBoard(cardCount));
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

  const pairCount = Math.floor(cardCount / 2);
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
    try {
      localStorage.setItem(
        MEMORY_CARDS_RESULT_LS_KEY,
        JSON.stringify({
          savedAt: new Date().toISOString(),
          status: 'in_progress',
          numberOfMoves: 0,
          correctPairsCount: 0,
          completionTimeMs: 0,
          gazePath: [],
        })
      );
    } catch (_) {}
    pathIntervalRef.current = setInterval(() => {
      const g = neuroLiveGazeRef.current;
      const t = (performance.now() - startTimeRef.current) / 1000;
      gazePathRef.current.push({ t, x: g.x, y: g.y });
    }, gazeIntervalMs);
    return () => {
      if (pathIntervalRef.current) clearInterval(pathIntervalRef.current);
    };
  }, [gazeIntervalMs]);

  // Dwell: which card is gaze over? If same card for dwellMs, select it.
  useEffect(() => {
    const interval = setInterval(() => {
      const el = gridContainerRef.current;
      const g = neuroLiveGazeRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cellW = rect.width / cols;
      const cellH = rect.height / rows;
      const col = Math.floor((g.x - rect.left) / cellW);
      const row = Math.floor((g.y - rect.top) / cellH);
      const index = row * cols + col;
      if (col < 0 || col >= cols || row < 0 || row >= rows) {
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
  }, [board, cols, rows, matched, dwellMs, selectCard]);

  // Completion
  useEffect(() => {
    if (!allMatched) return;
    const endTime = performance.now();
    if (pathIntervalRef.current) {
      clearInterval(pathIntervalRef.current);
      pathIntervalRef.current = null;
    }
    const numberOfMoves = movesRef.current.length;
    const correctPairsCount = movesRef.current.filter((m) => m.match).length;
    const completionTimeMs = endTime - startTimeRef.current;
    const gazePath = [...gazePathRef.current];
    const el = gridContainerRef.current;
    const gridRect = el
      ? (() => {
          const r = el.getBoundingClientRect();
          return { left: r.left, top: r.top, width: r.width, height: r.height };
        })()
      : undefined;
    try {
      localStorage.setItem(
        MEMORY_CARDS_RESULT_LS_KEY,
        JSON.stringify({
          savedAt: new Date().toISOString(),
          numberOfMoves,
          correctPairsCount,
          completionTimeMs,
          gazePath,
        })
      );
    } catch (_) {}
    completeTest({
      testId: 'memory_cards',
      startTime: startTimeRef.current,
      endTime,
      cardCount,
      cols,
      rows,
      board: [...board],
      moves: [...movesRef.current],
      numberOfMoves,
      correctPairsCount,
      completionTimeMs,
      gazePath,
      viewportWidth: typeof window !== 'undefined' ? window.innerWidth : undefined,
      viewportHeight: typeof window !== 'undefined' ? window.innerHeight : undefined,
      gridRect,
    });
  }, [allMatched, completeTest, cardCount, cols, rows]);

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
        className="grid"
        style={{
          gap: `${cardGapPx}px`,
          gridTemplateColumns: `repeat(${cols}, ${cardSizePx}px)`,
          gridTemplateRows: `repeat(${rows}, ${cardSizePx}px)`,
        }}
      >
        {board.map((value, index) => (
          <button
            key={index}
            type="button"
            disabled={value < 0 || matched.has(index) || secondSelected !== null}
            onClick={() => selectCard(index)}
            style={{ width: cardSizePx, height: cardSizePx, fontSize: symbolPx }}
            className={`
              rounded-lg border-2 flex items-center justify-center font-bold
              transition-all duration-200
              ${value < 0 ? 'invisible' : ''}
              ${matched.has(index) ? 'bg-emerald-700 border-emerald-500 text-white' : ''}
              ${revealed.has(index) && !matched.has(index) ? 'bg-blue-600 border-blue-400 text-white' : ''}
              ${!isRevealed(index) ? 'bg-slate-700 border-slate-500 text-slate-300 hover:border-slate-400' : ''}
              ${isSelected(index) ? 'ring-2 ring-amber-400 ring-offset-2 ring-offset-gray-950' : ''}
            `}
            aria-pressed={isRevealed(index)}
            aria-label={isRevealed(index) ? `Card ${getSymbol(value)}` : 'Face-down card'}
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
