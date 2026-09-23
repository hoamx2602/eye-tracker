'use client';

import React, { useEffect, useRef } from 'react';
import { usePracticeGate } from '../../PracticeGate';
import { DEFAULT_AMPLITUDE_FRAC, DEFAULT_FREQUENCY_HZ, PRACTICE_CYCLES } from './constants';

/**
 * Practice: the same side-to-side motion inside the practice frame, no
 * recording. Loops, and marks the practice done after PRACTICE_CYCLES.
 */
export default function SmoothPursuitPractice() {
  const practiceGate = usePracticeGate();
  const gateRef = useRef(practiceGate);
  gateRef.current = practiceGate;
  const dotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const start = performance.now();
    const periodMs = 1000 / DEFAULT_FREQUENCY_HZ;
    let marked = false;
    let raf = 0;
    const frame = (ts: number) => {
      const t = ts - start;
      // Percent of the practice area, mirroring the real test's fraction of the viewport.
      const leftPct = 50 + DEFAULT_AMPLITUDE_FRAC * 100 * Math.sin((2 * Math.PI * t) / periodMs);
      if (dotRef.current) dotRef.current.style.left = `${leftPct}%`;
      if (!marked && t >= PRACTICE_CYCLES * periodMs) {
        marked = true;
        gateRef.current?.markPracticeDone();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-[280px] w-full" role="region" aria-label="Smooth pursuit practice">
      <p className="text-center text-gray-400 text-sm mb-4">Follow the dot with your eyes, keeping your head still.</p>
      <div className="relative w-full max-w-2xl h-64">
        <div
          ref={dotRef}
          className="absolute w-5 h-5 rounded-full bg-amber-400"
          style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
          aria-hidden
        />
      </div>
    </div>
  );
}
