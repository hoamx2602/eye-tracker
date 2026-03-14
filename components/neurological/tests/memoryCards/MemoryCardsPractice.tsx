'use client';

import React, { useCallback, useState } from 'react';
import { createBoard } from './utils';
import { PRACTICE_GRID_SIZE } from './constants';

const SYMBOLS = '◆●▲■'.split('');
function getSymbol(id: number): string {
  if (id < 0) return '';
  return SYMBOLS[id % SYMBOLS.length] ?? String(id);
}

/**
 * Practice: 2×2 grid (1 pair). No recording; just get familiar with flip and match.
 */
export default function MemoryCardsPractice() {
  const [board] = useState(() => createBoard(PRACTICE_GRID_SIZE));
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [matched, setMatched] = useState<Set<number>>(new Set());
  const [firstSelected, setFirstSelected] = useState<number | null>(null);
  const [secondSelected, setSecondSelected] = useState<number | null>(null);

  const selectCard = useCallback(
    (index: number) => {
      const value = board[index];
      if (value < 0 || matched.has(index)) return;
      if (firstSelected === null) {
        setFirstSelected(index);
        setRevealed((r) => new Set(r).add(index));
        return;
      }
      if (firstSelected === index || secondSelected !== null) return;
      setSecondSelected(index);
      setRevealed((r) => new Set(r).add(index));
      const match = board[firstSelected] === value;
      if (match) {
        setMatched((m) => new Set(m).add(firstSelected).add(index));
        setFirstSelected(null);
        setSecondSelected(null);
      } else {
        setTimeout(() => {
          setRevealed((r) => {
            const next = new Set(r);
            next.delete(firstSelected);
            next.delete(index);
            return next;
          });
          setFirstSelected(null);
          setSecondSelected(null);
        }, 1000);
      }
    },
    [board, firstSelected, secondSelected, matched]
  );

  const isRevealed = (i: number) => revealed.has(i) || matched.has(i);
  const gridSize = PRACTICE_GRID_SIZE;

  return (
    <div className="flex flex-col items-center justify-center min-h-[240px]">
      <p className="text-gray-400 text-sm mb-4">
        Try flipping two cards to find the pair. When ready, click &quot;Start real test&quot; below.
      </p>
      <div
        className="grid gap-2 w-40 h-40"
        style={{
          gridTemplateColumns: `repeat(${gridSize}, 1fr)`,
          gridTemplateRows: `repeat(${gridSize}, 1fr)`,
        }}
      >
        {board.map((value, index) => (
          <button
            key={index}
            type="button"
            disabled={value < 0 || matched.has(index) || secondSelected !== null}
            onClick={() => selectCard(index)}
            className={`
              rounded-lg border-2 flex items-center justify-center text-2xl font-bold
              ${value < 0 ? 'invisible' : ''}
              ${matched.has(index) ? 'bg-emerald-700 border-emerald-500 text-white' : ''}
              ${revealed.has(index) && !matched.has(index) ? 'bg-blue-600 border-blue-400 text-white' : ''}
              ${!isRevealed(index) ? 'bg-slate-700 border-slate-500 text-slate-300 hover:border-slate-400' : ''}
            `}
          >
            {isRevealed(index) ? getSymbol(value) : '?'}
          </button>
        ))}
      </div>
    </div>
  );
}
