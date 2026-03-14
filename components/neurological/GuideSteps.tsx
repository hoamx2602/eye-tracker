'use client';

import React, { useState } from 'react';
import type { GuideStep } from './types';

export type GuideStepsProps = {
  steps: GuideStep[];
  onComplete: () => void;
  /** Label for the final step button. Default: "Start Test" */
  completeButtonLabel?: string;
};

export default function GuideSteps({
  steps,
  onComplete,
  completeButtonLabel = 'Start Test',
}: GuideStepsProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const step = steps[currentIndex];
  const isLast = currentIndex >= steps.length - 1;

  if (!step) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-gray-950 overflow-hidden"
      role="region"
      aria-labelledby="guide-step-title"
    >
      <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center max-w-2xl mx-auto">
        {step.title && (
          <h2 id="guide-step-title" className="text-lg font-bold text-white mb-4 text-center">
            {step.title}
          </h2>
        )}
        <p className="text-gray-300 text-center whitespace-pre-line leading-relaxed">
          {step.body}
        </p>
        {step.image && typeof step.image === 'string' && (
          <img
            src={step.image}
            alt=""
            className="mt-6 rounded-lg max-h-48 object-contain"
          />
        )}
      </div>
      <div className="flex-shrink-0 p-6 border-t border-gray-800 flex justify-between items-center">
        <div className="w-24">
          {currentIndex > 0 ? (
            <button
              type="button"
              onClick={() => setCurrentIndex((i) => i - 1)}
              className="px-4 py-2 text-gray-400 hover:text-white text-sm font-medium transition"
            >
              ← Back
            </button>
          ) : null}
        </div>
        <span className="text-gray-500 text-sm">
          {currentIndex + 1} / {steps.length}
        </span>
        <div className="w-24 flex justify-end">
          {isLast ? (
            <button
              type="button"
              onClick={onComplete}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-xl transition"
            >
              {completeButtonLabel}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setCurrentIndex((i) => i + 1)}
              className="px-5 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium rounded-xl transition"
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
