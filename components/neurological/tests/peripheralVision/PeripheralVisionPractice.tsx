'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_STIMULUS_DURATION_MS,
  DEFAULT_MIN_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
  PRACTICE_TRIALS,
} from './constants';
import { randomPeripheralStimulusPosition } from './utils';

/**
 * Practice: a few peripheral stimuli, same UI, no recording.
 *
 * Both dots come from the same config as the real test; they were hard-coded,
 * so a configured size or colour applied only to the recorded run.
 */
export default function PeripheralVisionPractice({
  config,
}: {
  config?: Record<string, unknown>;
}) {
  const centerDotSizePx = Math.max(4, Math.min(64, Number(config?.centerDotSizePx) || 8));
  const centerDotColor =
    typeof config?.centerDotColor === 'string' ? config.centerDotColor : '#f59e0b';
  const stimulusDotSizePx = Math.max(4, Math.min(64, Number(config?.stimulusDotSizePx) || 16));
  const stimulusDotColor =
    typeof config?.stimulusDotColor === 'string' ? config.stimulusDotColor : '#ffffff';
  const boxRef = useRef<HTMLDivElement>(null);
  const [trialIndex, setTrialIndex] = useState(0);
  const [showStimulus, setShowStimulus] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [stimulusPos, setStimulusPos] = useState({ x: 200, y: 96 });

  useEffect(() => {
    if (trialIndex >= PRACTICE_TRIALS) return;
    const el = boxRef.current;
    const w = el?.clientWidth ?? 400;
    const h = el?.clientHeight ?? 192;
    setStimulusPos(randomPeripheralStimulusPosition(w, h));
    const delayMs = DEFAULT_MIN_DELAY_MS + Math.random() * (DEFAULT_MAX_DELAY_MS - DEFAULT_MIN_DELAY_MS);
    timeoutRef.current = setTimeout(() => {
      setShowStimulus(true);
      setTimeout(() => {
        setShowStimulus(false);
        if (trialIndex + 1 >= PRACTICE_TRIALS) return;
        setTimeout(() => setTrialIndex((i) => i + 1), 500);
      }, DEFAULT_STIMULUS_DURATION_MS);
    }, delayMs);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [trialIndex]);

  if (trialIndex >= PRACTICE_TRIALS) {
    return (
      <p className="text-gray-400 text-sm">Practice done. Click &quot;Start real test&quot; below.</p>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[280px]">
      <p className="text-gray-400 text-sm mb-4">
        Keep gaze on center. A flash will appear at the edge. Trial {trialIndex + 1} of {PRACTICE_TRIALS}.
      </p>
      <div ref={boxRef} className="relative w-full h-48" style={{ maxWidth: 400 }}>
        <div
          className="absolute rounded-full"
          style={{
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: centerDotSizePx,
            height: centerDotSizePx,
            backgroundColor: centerDotColor,
          }}
        />
        {showStimulus && (
          <div
            className="absolute rounded-full"
            style={{
              left: stimulusPos.x,
              top: stimulusPos.y,
              transform: 'translate(-50%, -50%)',
              width: stimulusDotSizePx,
              height: stimulusDotSizePx,
              backgroundColor: stimulusDotColor,
            }}
          />
        )}
      </div>
    </div>
  );
}
