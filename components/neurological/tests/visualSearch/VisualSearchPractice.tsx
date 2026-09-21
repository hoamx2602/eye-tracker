'use client';

/**
 * Practice round for Visual Search.
 *
 * Four numbers, confirmed with exactly the gesture the real test uses — the
 * targets, the hold ring and the green confirmation all come from
 * TargetButton, so practising teaches the real interaction rather than a
 * picture of it. Nothing here is recorded.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { generateNumberPositions } from './utils';
import {
  PRACTICE_COUNT,
  DEFAULT_CONFIRM_MODE,
  type VisualSearchConfirmMode,
} from './constants';
import {
  HoldRingKeyframes,
  TargetButton,
  confirmModeInstruction,
  useHoldConfirm,
} from './TargetButton';
import { usePracticeGate } from '../../PracticeGate';

export default function VisualSearchPractice({
  config,
}: {
  /** The real test's config, so the practice uses the same confirmation gesture. */
  config?: Record<string, unknown>;
}) {
  const positions = useMemo(() => generateNumberPositions(PRACTICE_COUNT), []);
  const confirmMode = (['gaze', 'hold', 'click'].includes(config?.confirmMode as string)
    ? config?.confirmMode
    : DEFAULT_CONFIRM_MODE) as VisualSearchConfirmMode;

  const [confirmedNumbers, setConfirmedNumbers] = useState<ReadonlySet<number>>(new Set());
  const gate = usePracticeGate();
  const markPracticeDone = gate?.markPracticeDone;

  const handleConfirm = useCallback(
    (number: number) => {
      setConfirmedNumbers((prev) => {
        const next = new Set(prev);
        next.add(number);
        // Having confirmed one, they know the gesture — offer the real test
        // rather than making them work through all four.
        markPracticeDone?.();
        return next;
      });
    },
    [markPracticeDone]
  );

  const { holdingNumber, onPointerDown, onPointerUp, onPointerCancel } = useHoldConfirm({
    confirmMode,
    onConfirm: handleConfirm,
  });

  const allDone = confirmedNumbers.size >= positions.length;

  return (
    <div className="flex flex-col items-center justify-center min-h-[280px]">
      <HoldRingKeyframes />
      <p className="text-gray-400 text-sm mb-1 text-center max-w-xl">
        {confirmModeInstruction(confirmMode, PRACTICE_COUNT)}
      </p>
      <p className="text-gray-500 text-xs mb-4 text-center">
        {allDone
          ? 'That is the whole task. Start the real test when you are ready.'
          : 'Try it on these four — it works the same way in the real test.'}
      </p>
      <div className="relative w-full max-w-2xl h-64">
        {positions.map((pos) => (
          <TargetButton
            key={pos.number}
            number={pos.number}
            x={pos.x}
            y={pos.y}
            confirmed={confirmedNumbers.has(pos.number)}
            holding={holdingNumber === pos.number}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
          />
        ))}
      </div>
    </div>
  );
}
