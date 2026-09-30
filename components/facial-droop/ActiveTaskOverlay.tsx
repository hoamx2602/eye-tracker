'use client';

import React from 'react';
import type { FacialSpeechTask } from '@/lib/facialSpeechProtocol';

interface ActiveTaskOverlayProps {
  task: FacialSpeechTask;
  isLast: boolean;
  elapsedMs: number;
  onFinish: () => void;
}

const CUE: Record<FacialSpeechTask['domain'], string> = {
  face: 'Look at the camera lens',
  quality: 'Stay silent and still',
  speech: 'Keep your face centred',
};

/**
 * Controls during a recorded window, kept sparse and at the top of the frame
 * next to the webcam so the gaze stays on the lens. The progress is a bar, not
 * counting digits, which would pull the eyes. Finish appears once the task has
 * run its intended length; a quieter early exit unlocks at the processor's
 * minimum, because trapping someone who cannot continue is worse than a
 * capture flagged short.
 */
export default function ActiveTaskOverlay({ task, isLast, elapsedMs, onFinish }: ActiveTaskOverlayProps) {
  const elapsed = elapsedMs / 1000;
  const complete = elapsed >= task.durationSec;
  const canEndEarly = elapsed >= task.minimumSec;
  const progress = Math.min(1, elapsed / task.durationSec);

  return (
    <>
      {task.nearLensPrompt && (
        <div className="absolute left-1/2 top-3 z-20 max-w-[92%] -translate-x-1/2 rounded-xl bg-white px-5 py-2.5 text-center text-lg font-semibold leading-7 text-gray-950 shadow-lg">
          {task.nearLensPrompt}
        </div>
      )}
      <div className={`absolute inset-x-0 z-20 flex flex-col items-center gap-2 px-4 ${task.nearLensPrompt ? 'top-20' : 'top-4'}`}>
        <div className="rounded-full bg-black/70 px-4 py-1.5 text-sm font-semibold backdrop-blur-sm">{task.title}</div>
        <div className="w-64 max-w-[70%]">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/20">
            <div className={`h-full rounded-full transition-[width] duration-100 ease-linear ${complete ? 'bg-emerald-400' : 'bg-blue-400'}`}
              style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
        {complete ? (
          <button type="button" onClick={onFinish}
            className="mt-1 rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-semibold shadow-lg transition duration-150 ease-out hover:bg-blue-500">
            {isLast ? 'Finish assessment' : 'Next task'}
          </button>
        ) : canEndEarly ? (
          <button type="button" onClick={onFinish} className="text-xs text-gray-400 underline underline-offset-2 transition hover:text-gray-200">
            {isLast ? 'Cannot continue - end here' : 'Cannot continue - end this task'}
          </button>
        ) : null}
      </div>
      <p className="absolute inset-x-0 bottom-4 z-20 mx-auto w-fit rounded-full bg-black/60 px-4 py-1.5 text-sm text-gray-200 backdrop-blur-sm">
        {CUE[task.domain]}
      </p>
    </>
  );
}
