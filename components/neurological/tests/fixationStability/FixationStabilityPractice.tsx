'use client';

import React, { useEffect, useRef, useState } from 'react';
import { usePracticeGate } from '../../PracticeGate';
import { DEFAULT_BLINK_INTERVAL_MS, PRACTICE_DURATION_SEC } from './constants';

/**
 * Optional practice: dot blinks for a while then stops; no time display, just instruct to look until it stops blinking.
 *
 * The dot is drawn from the same config as the real test. It used to be a
 * hard-coded 12 px amber circle, so as soon as an administrator changed the
 * size or colour the participant practised on a different dot from the one
 * they were about to be tested with.
 */
export default function FixationStabilityPractice({
  config,
}: {
  config?: Record<string, unknown>;
}) {
  const centerDotSizePx = Math.max(6, Math.min(64, Number(config?.centerDotSizePx) || 12));
  const centerDotColor =
    typeof config?.centerDotColor === 'string' ? config.centerDotColor : '#f59e0b';
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
        className="rounded-full shadow-lg"
        style={{
          width: centerDotSizePx,
          height: centerDotSizePx,
          backgroundColor: centerDotColor,
          opacity: blinkVisible ? 1 : 0.35,
          transition: 'opacity 0.1s ease',
        }}
      />
    </div>
  );
}
