'use client';

import React, { useEffect, useRef, useState } from 'react';
import { DEFAULT_BLINK_INTERVAL_MS, PRACTICE_DURATION_SEC } from './constants';

/**
 * Optional practice: short fixation (few seconds), same dot, no recording.
 */
export default function FixationStabilityPractice() {
  const [remaining, setRemaining] = useState(PRACTICE_DURATION_SEC);
  const [blinkVisible, setBlinkVisible] = useState(true);
  const startRef = useRef(performance.now());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    startRef.current = performance.now();
    tickRef.current = setInterval(() => {
      const elapsed = (performance.now() - startRef.current) / 1000;
      const r = Math.max(0, Math.ceil(PRACTICE_DURATION_SEC - elapsed));
      setRemaining(r);
      if (r <= 0 && tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    }, 200);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setBlinkVisible((v) => !v), DEFAULT_BLINK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-[240px]">
      <p className="text-gray-400 text-sm mb-4">
        Keep your gaze on the dot for {PRACTICE_DURATION_SEC} seconds. Practice run.
      </p>
      <p className="text-2xl font-mono text-white mb-4">{remaining} s</p>
      <div
        className="w-3 h-3 rounded-full bg-amber-400"
        style={{ opacity: blinkVisible ? 1 : 0.35, transition: 'opacity 0.1s ease' }}
      />
    </div>
  );
}
