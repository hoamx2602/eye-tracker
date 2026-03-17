'use client';

import React, { useEffect, useRef, useState } from 'react';
import { usePracticeGate } from '../../PracticeGate';
import { DEFAULT_BLINK_INTERVAL_MS, PRACTICE_DURATION_SEC } from './constants';

/**
 * Optional practice: dot blinks for a while then stops; no time display, just instruct to look until it stops blinking.
 */
export default function FixationStabilityPractice() {
  const practiceGate = usePracticeGate();
  const practiceGateRef = useRef(practiceGate);
  practiceGateRef.current = practiceGate;
  const [blinkVisible, setBlinkVisible] = useState(true);
  const blinkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const start = performance.now();
    blinkIntervalRef.current = setInterval(() => setBlinkVisible((v) => !v), DEFAULT_BLINK_INTERVAL_MS);
    const stopAt = start + PRACTICE_DURATION_SEC * 1000;
    const check = setInterval(() => {
      if (performance.now() >= stopAt) {
        if (blinkIntervalRef.current) {
          clearInterval(blinkIntervalRef.current);
          blinkIntervalRef.current = null;
        }
        setBlinkVisible(true);
        practiceGateRef.current?.markPracticeDone();
        clearInterval(check);
      }
    }, 200);
    return () => {
      if (blinkIntervalRef.current) clearInterval(blinkIntervalRef.current);
      clearInterval(check);
    };
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-[240px]">
      <p className="text-gray-400 text-sm mb-4 text-center">
        Look here until the dot stops blinking.
      </p>
      <div
        className="w-3 h-3 rounded-full bg-amber-400"
        style={{ opacity: blinkVisible ? 1 : 0.35, transition: 'opacity 0.1s ease' }}
      />
    </div>
  );
}
