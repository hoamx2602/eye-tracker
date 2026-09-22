'use client';

/**
 * Blocks interaction with the active neuro test until head position is
 * corrected — the same check and the same 2-second hold that clears it as
 * CALIBRATION's HeadPositionGuide, but deliberately not that component: this
 * renders as an overlay on top of the running test rather than a status
 * change, so nothing under it ever unmounts. Interrupting a test by sending
 * the participant back through a whole new screen would cost whatever
 * guide/practice/trial progress that test had made; this costs a pause.
 */

import React from 'react';
import type { HeadValidationResult } from '@/services/eyeTrackingService';

export default function NeuroHeadPositionBlock({
  validation,
  holdRemainingMs,
}: {
  validation: HeadValidationResult | null;
  holdRemainingMs: number | null;
}) {
  const isValid = validation?.valid ?? false;
  const message = validation?.message || 'Looking for face...';
  const colorClass = isValid ? 'border-green-500' : 'border-red-500';
  const textClass = isValid ? 'text-green-400' : 'text-red-400';

  return (
    <div
      className="fixed inset-0 z-[85] flex flex-col items-center justify-center bg-gray-950/90 backdrop-blur-sm"
      role="alertdialog"
      aria-label="Head position needs adjusting"
    >
      <div
        className={`relative w-[40vw] h-[45vh] max-w-md max-h-[420px] border-4 rounded-[3rem] transition-colors duration-300 ${colorClass} flex items-center justify-center bg-black/20`}
      >
        <div className={`w-3 h-3 rounded-full ${isValid ? 'bg-green-500' : 'bg-red-500'} opacity-60`} aria-hidden />
        {holdRemainingMs != null && holdRemainingMs > 0 && (
          <div className="absolute text-7xl font-black text-white drop-shadow-lg animate-pulse">
            {Math.ceil(holdRemainingMs / 1000)}
          </div>
        )}
      </div>

      <div className="mt-8 text-center max-w-sm px-4">
        <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold">
          Test paused — nothing is being recorded right now
        </p>
        <p className={`mt-2 text-2xl font-black ${textClass} transition-colors duration-300`}>
          {message}
        </p>
        <p className="mt-3 text-sm text-gray-400">
          Adjust your position, then hold still — the test resumes on its own once you're back in frame.
        </p>
      </div>
    </div>
  );
}
