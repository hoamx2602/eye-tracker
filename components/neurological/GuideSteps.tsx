'use client';

import React, { useState } from 'react';
import type { GuideStep } from './types';

function HandPointerIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 13V6.8a1.8 1.8 0 0 1 3.6 0V12" />
      <path d="M11.6 12V7.6a1.6 1.6 0 0 1 3.2 0V12.2" />
      <path d="M14.8 12.2V8.3a1.5 1.5 0 0 1 3 0V13" />
      <path d="M8 13.2l-1.2-1.1a1.7 1.7 0 0 0-2.5 2.2l2.8 3.1c.6.7 1.5 1.1 2.4 1.1h4.2c2 0 3.7-1.3 4.3-3.2l.8-2.6" />
      <path d="M12.2 4.7a1.6 1.6 0 0 1 1.6 1.6" opacity="0.6" />
    </svg>
  );
}

function StepBadge({ n }: { n: number }) {
  return (
    <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500/40 to-cyan-400/20 p-[1px]">
      <div className="absolute inset-0 rounded-xl blur-[10px] bg-blue-500/10" />
      <div className="relative w-full h-full rounded-[11px] bg-gray-950 flex items-center justify-center border border-blue-400/15">
        <div className="text-sm font-semibold text-blue-100 tabular-nums">{n}</div>
      </div>
    </div>
  );
}

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

  const title =
    steps.find((s) => typeof s.title === 'string' && s.title.trim().length > 0)?.title ?? 'Instructions';

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-gray-950 overflow-hidden"
      role="region"
      aria-labelledby="guide-step-title"
    >
      <div className="flex-shrink-0 border-b border-gray-800/60 bg-gradient-to-b from-blue-600/10 to-transparent">
        <div className="p-6 max-w-3xl mx-auto">
          <h2 id="guide-step-title" className="text-2xl font-bold text-white text-center tracking-tight">
            {title}
          </h2>
          <p className="mt-2 text-sm text-gray-300/90 text-center">
            Read these quick steps once, then start the test.
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 w-full">
        <div className="max-w-3xl mx-auto">
          {showAll ? (
            <div className="relative">
              {/* timeline line */}
              {/* Badge is 36px wide; it's positioned at left-2 (8px) so center is 8 + 18 = 26px */}
              <div className="absolute left-[26px] top-3 bottom-3 w-px bg-gradient-to-b from-blue-500/40 via-gray-700/40 to-transparent" />

              <div className="space-y-4">
                {steps.map((s, idx) => (
                  <div key={s.id ?? String(idx)} className="relative pl-14">
                    <div className="absolute left-2 top-4">
                      <StepBadge n={idx + 1} />
                    </div>

                    <div className="rounded-2xl border border-gray-800/70 bg-gradient-to-b from-gray-900/60 to-gray-950/40 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] transition hover:border-gray-700/70 hover:bg-gray-900/70">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 text-blue-200/80">
                          <HandPointerIcon className="w-5 h-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          {s.title ? (
                            <div className="text-white font-semibold leading-snug">
                              {s.title}
                            </div>
                          ) : null}
                          <div className="mt-1 text-gray-200/90 whitespace-pre-line leading-relaxed">
                            {s.body}
                          </div>
                          {s.image && typeof s.image === 'string' ? (
                            <img
                              src={s.image}
                              alt=""
                              className="mt-3 rounded-xl max-h-56 object-contain border border-gray-800/60 bg-gray-950/40"
                            />
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex-shrink-0 p-6 border-t border-gray-800/60 bg-gradient-to-t from-gray-950 via-gray-950 to-transparent">
        <button
          type="button"
          onClick={onComplete}
          className="group px-7 py-3.5 bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white font-semibold rounded-2xl transition shadow-[0_10px_30px_rgba(0,140,255,0.18)] active:translate-y-[1px]"
        >
          <span className="inline-flex items-center gap-2">
            <span>{completeButtonLabel}</span>
            <span className="opacity-90 group-hover:translate-x-0.5 transition">→</span>
          </span>
        </button>
      </div>
    </div>
  );
}
