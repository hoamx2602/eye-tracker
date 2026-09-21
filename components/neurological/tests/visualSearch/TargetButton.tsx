'use client';

/**
 * The numbered target and the gesture that confirms it, shared by the real
 * Visual Search test and its practice round.
 *
 * It lives here so the two cannot diverge. The practice exists to teach the
 * interaction; if an administrator switches `confirmMode` from gaze to click
 * and only the test follows, the practice teaches the wrong gesture — which is
 * worse than having no practice at all.
 *
 * The test keeps its own recording: `onConfirm` fires at the moment a target
 * is confirmed and the caller decides what, if anything, to store.
 */

import React, { useCallback, useRef, useState } from 'react';
import { DWELL_CONFIRM_MS, type VisualSearchConfirmMode } from './constants';

const RING_R = 26;
const RING_C = Math.round(2 * Math.PI * RING_R); // ≈ 163 px

/** Injects the progress-ring keyframe. Render once per screen. */
export function HoldRingKeyframes() {
  return (
    <style>{`
      @keyframes vs-hold-ring {
        from { stroke-dashoffset: ${RING_C}; }
        to   { stroke-dashoffset: 0; }
      }
    `}</style>
  );
}

export type ConfirmDetail = {
  /** Pointer position at the moment of confirmation, when there was one. */
  pointerX?: number;
  pointerY?: number;
  /** How long the target was held, in ms. Zero in click mode. */
  holdDurationMs: number;
};

export type UseHoldConfirmOptions = {
  confirmMode: VisualSearchConfirmMode;
  /**
   * The only target that may be confirmed right now, or null for no
   * restriction. Pressing any other one does nothing but report the attempt.
   */
  nextExpected?: number | null;
  /** Fired when a target is confirmed — immediately in click mode, after the dwell otherwise. */
  onConfirm: (number: number, detail: ConfirmDetail) => void;
  /** Fired when a target is pressed out of order. */
  onWrongOrder?: (number: number, expected: number) => void;
  /** Fired on pointer down, before any confirmation. Used for legacy hold recording. */
  onPointerDownExtra?: (number: number, e: React.PointerEvent<HTMLButtonElement>) => void;
  /** Fired on pointer up. Used for legacy hold recording. */
  onPointerUpExtra?: (number: number, e: React.PointerEvent<HTMLButtonElement>) => void;
};

/**
 * Press-and-hold confirmation.
 *
 * In `click` mode a target confirms on pointer down. In `gaze` and `hold` mode
 * it must be held for `DWELL_CONFIRM_MS`, with the ring showing progress —
 * gaze mode keeps the pointer path so a participant whose tracking is poor is
 * never stuck.
 */
export function useHoldConfirm({
  confirmMode,
  nextExpected = null,
  onConfirm,
  onWrongOrder,
  onPointerDownExtra,
  onPointerUpExtra,
}: UseHoldConfirmOptions) {
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [holdingNumber, setHoldingNumber] = useState<number | null>(null);

  const cancelHold = useCallback(() => {
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    setHoldingNumber(null);
  }, []);

  const onPointerDown = useCallback(
    (number: number, e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch (_) {}

      // Out of order: refuse it. Finding the right number is the task, so
      // confirming whatever is pressed would measure nothing.
      if (nextExpected !== null && number !== nextExpected) {
        onWrongOrder?.(number, nextExpected);
        return;
      }

      onPointerDownExtra?.(number, e);

      if (confirmMode === 'click') {
        cancelHold();
        onConfirm(number, { pointerX: e.clientX, pointerY: e.clientY, holdDurationMs: 0 });
        return;
      }

      cancelHold();
      setHoldingNumber(number);
      const t0 = performance.now();
      holdTimerRef.current = setTimeout(() => {
        holdTimerRef.current = null;
        setHoldingNumber(null);
        onConfirm(number, { holdDurationMs: Math.round(performance.now() - t0) });
      }, DWELL_CONFIRM_MS);
    },
    [confirmMode, nextExpected, cancelHold, onConfirm, onWrongOrder, onPointerDownExtra]
  );

  const onPointerUp = useCallback(
    (number: number, e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch (_) {}
      cancelHold();
      onPointerUpExtra?.(number, e);
    },
    [cancelHold, onPointerUpExtra]
  );

  const onPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch (_) {}
      cancelHold();
    },
    [cancelHold]
  );

  return { holdingNumber, cancelHold, onPointerDown, onPointerUp, onPointerCancel };
}

export type TargetButtonProps = {
  number: number;
  /** Percentage position within the stimulus area. */
  x: number;
  y: number;
  confirmed: boolean;
  holding: boolean;
  /** Briefly true after an out-of-order press, to show it was refused. */
  wrong?: boolean;
  onPointerDown: (number: number, e: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (number: number, e: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (e: React.PointerEvent<HTMLButtonElement>) => void;
};

/** One numbered target: blue, blue-with-ring while held, green once confirmed. */
export function TargetButton({
  number,
  x,
  y,
  confirmed,
  holding,
  wrong = false,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
}: TargetButtonProps) {
  return (
    <button
      type="button"
      aria-label={`Target ${number}${
        confirmed ? ' (confirmed)' : wrong ? ' (not next in order)' : ' — hold to confirm'
      }`}
      className={[
        'absolute w-14 h-14 flex items-center justify-center rounded-full',
        'text-white text-2xl font-bold border-2 touch-none select-none [-webkit-touch-callout:none]',
        'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400',
        confirmed
          ? 'bg-emerald-500 border-emerald-300 shadow-lg shadow-emerald-500/50'
          : wrong
            ? 'bg-rose-600 border-rose-300 shadow-lg shadow-rose-500/50'
            : holding
              ? 'bg-blue-500 border-white shadow-lg shadow-blue-400/60'
              : 'bg-blue-600/90 border-blue-400 shadow-lg',
      ].join(' ')}
      style={{
        left: `${x}%`,
        top: `${y}%`,
        transform: 'translate(-50%, -50%)',
        transition: 'background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
      }}
      onPointerDown={(e) => onPointerDown(number, e)}
      onPointerUp={(e) => onPointerUp(number, e)}
      onPointerCancel={onPointerCancel}
    >
      {/* Progress ring — only while actively holding */}
      {holding && !confirmed && (
        <svg
          aria-hidden="true"
          viewBox="0 0 56 56"
          className="pointer-events-none absolute inset-0 w-full h-full"
          style={{ transform: 'rotate(-90deg)' }}
        >
          <circle
            cx="28"
            cy="28"
            r={RING_R}
            fill="none"
            stroke="rgba(255,255,255,0.9)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C}
            style={{ animation: `vs-hold-ring ${DWELL_CONFIRM_MS}ms linear forwards` }}
          />
        </svg>
      )}
      {number}
    </button>
  );
}

/** The instruction line, worded for whichever gesture is configured. */
export function confirmModeInstruction(
  confirmMode: VisualSearchConfirmMode,
  numberCount: number
): string {
  const order = `(1 → 2 → … → ${numberCount})`;
  const tail = ' They only turn green in order, so find the right one each time.';
  if (confirmMode === 'click') return `Click each number in order ${order}.${tail}`;
  if (confirmMode === 'hold') {
    return `Click and hold each number in order ${order} until it turns green.${tail}`;
  }
  return `Find each number in order ${order} and hold it for 1.5 s until it turns green.${tail}`;
}
