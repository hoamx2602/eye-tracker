'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_STIMULUS_DURATION_MS,
  DEFAULT_MIN_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
  PRACTICE_TRIALS,
} from './constants';
import { generateTrialZones } from './utils';

/**
 * Practice: a few peripheral stimuli, same UI, no recording.
 */
export default function PeripheralVisionPractice() {
  const zones = useRef(generateTrialZones(PRACTICE_TRIALS)).current;
  const [trialIndex, setTrialIndex] = useState(0);
  const [showStimulus, setShowStimulus] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const zone = zones[trialIndex];

  useEffect(() => {
    if (trialIndex >= PRACTICE_TRIALS) return;
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
      <div className="relative w-full h-48" style={{ maxWidth: 400 }}>
        {/* Center dot and stimulus use same logic as test; parent is viewport-sized in real test */}
        <div
          className="absolute w-2 h-2 rounded-full bg-amber-400"
          style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)', marginLeft: -4, marginTop: -4 }}
        />
        {showStimulus && (
          <div
            className="absolute w-4 h-4 rounded-full bg-white border border-gray-300"
            style={{
              left: zone === 'left' ? '10%' : zone === 'right' ? '90%' : '50%',
              top: zone === 'top' ? '15%' : zone === 'bottom' ? '85%' : '50%',
              transform: 'translate(-50%, -50%)',
            }}
          />
        )}
      </div>
    </div>
  );
}
