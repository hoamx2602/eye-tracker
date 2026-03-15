'use client';

import React from 'react';

export type PostCalibrationChoiceScreenProps = {
  onChooseRealTime: () => void;
  onChooseNeurological: (sessionId: string) => void;
  /** Session id from the calibration that was just saved (required to start neurological run). */
  sessionId: string;
};

export default function PostCalibrationChoiceScreen({
  onChooseRealTime,
  onChooseNeurological,
  sessionId,
}: PostCalibrationChoiceScreenProps) {
  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-8 p-6 bg-gray-950"
      role="region"
      aria-labelledby="post-calibration-choice-title"
    >
      <h1
        id="post-calibration-choice-title"
        className="text-xl font-bold text-white uppercase tracking-widest text-center"
      >
        Calibration complete
      </h1>
      <p className="text-gray-400 text-sm text-center max-w-md">
        Choose how you would like to continue:
      </p>

      <div className="flex flex-col sm:flex-row gap-6 w-full max-w-2xl">
        <button
          type="button"
          onClick={onChooseRealTime}
          className="flex-1 flex flex-col items-center justify-center gap-3 px-8 py-10 rounded-2xl border-2 border-gray-700 bg-gray-900 hover:border-blue-500 hover:bg-gray-800 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-950"
          aria-label="Continue with real-time eye tracking"
        >
          <span className="text-4xl" aria-hidden>👁</span>
          <span className="text-lg font-bold text-white">Real-time eye tracking</span>
          <span className="text-sm text-gray-400 text-center">
            Free gaze, dot test, article reading. Use the toolbar to switch modes and save data.
          </span>
        </button>

        <button
          type="button"
          onClick={() => onChooseNeurological(sessionId)}
          className="flex-1 flex flex-col items-center justify-center gap-3 px-8 py-10 rounded-2xl border-2 border-gray-700 bg-gray-900 hover:border-violet-500 hover:bg-gray-800 transition-all focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-gray-950"
          aria-label="Continue with neurological test"
        >
          <span className="text-4xl" aria-hidden>🧪</span>
          <span className="text-lg font-bold text-white">Neurological test</span>
          <span className="text-sm text-gray-400 text-center">
            Pre-test questions, 7 experiments, post-test questions. All data is recorded.
          </span>
        </button>
      </div>
    </div>
  );
}
