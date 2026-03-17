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
  const [showAll] = useState(true);
  if (!steps?.length) return null;

  const title = steps.find((s) => typeof s.title === 'string' && s.title.trim().length > 0)?.title ?? 'Instructions';

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-gray-950 overflow-hidden"
      role="region"
      aria-labelledby="guide-step-title"
    >
      <div className="flex-1 overflow-y-auto p-6 w-full">
        <div className="max-w-2xl mx-auto">
          <h2 id="guide-step-title" className="text-xl font-bold text-white mb-4 text-center">
            {title}
          </h2>

          {showAll ? (
            <div className="space-y-4">
              {steps.map((s, idx) => (
                <div key={s.id ?? String(idx)} className="rounded-xl border border-gray-800 bg-gray-900/30 p-4">
                  {s.title ? (
                    <div className="text-white font-semibold mb-1">
                      {s.title}
                    </div>
                  ) : (
                    <div className="text-gray-400 text-sm mb-1">
                      Step {idx + 1}
                    </div>
                  )}
                  <div className="text-gray-200 whitespace-pre-line leading-relaxed">
                    {s.body}
                  </div>
                  {s.image && typeof s.image === 'string' ? (
                    <img
                      src={s.image}
                      alt=""
                      className="mt-3 rounded-lg max-h-48 object-contain"
                    />
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex-shrink-0 p-6 border-t border-gray-800 flex justify-center">
        <button
          type="button"
          onClick={onComplete}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-xl transition"
        >
          {completeButtonLabel}
        </button>
      </div>
    </div>
  );
}
