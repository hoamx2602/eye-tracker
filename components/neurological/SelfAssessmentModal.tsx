'use client';

/**
 * SelfAssessmentModal — post-test self-assessment overlay.
 *
 * Shows 1 or 2 star-rating questions (admin-configurable) after each neurological test.
 * Semi-transparent overlay over the "Test complete" screen.
 * Appears between Redo/Continue prompt and actual continuation.
 *
 * Props:
 *   testLabel     — human-readable test name (e.g. "Visual Search")
 *   question1     — first question text
 *   question2     — second question text (null = hidden)
 *   onSubmit      — called with { focusRating, accuracyPrediction, timestamp }
 *   onSkip        — called when user explicitly skips (if enabled — currently not shown to keep flow clean)
 */

import React, { useState } from 'react';

export interface SelfAssessmentRating {
  focusRating: number;
  accuracyPrediction?: number;
  timestamp: number;
}

interface Props {
  testLabel: string;
  question1: string;
  question2: string | null;
  onSubmit: (rating: SelfAssessmentRating) => void;
}

function StarRow({
  question,
  emoji1,
  emoji5,
  value,
  onChange,
}: {
  question: string;
  emoji1: string;
  emoji5: string;
  value: number | null;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-gray-200 font-medium text-center leading-snug">{question}</p>
      <div className="flex items-center justify-center gap-1.5">
        <span className="text-xl select-none">{emoji1}</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={[
              'w-10 h-10 sm:w-11 sm:h-11 rounded-full border-2 transition-all duration-100 text-base font-bold select-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
              value === n
                ? 'bg-gradient-to-br from-blue-500 to-cyan-400 border-blue-400 text-white shadow-[0_4px_14px_rgba(0,140,255,0.35)] scale-110'
                : 'bg-gray-800/80 border-gray-600 text-gray-400 hover:border-blue-500/60 hover:text-blue-300 hover:bg-gray-700/80',
            ].join(' ')}
          >
            {n}
          </button>
        ))}
        <span className="text-xl select-none">{emoji5}</span>
      </div>
    </div>
  );
}

export default function SelfAssessmentModal({ testLabel, question1, question2, onSubmit }: Props) {
  const [focusRating, setFocusRating] = useState<number | null>(null);
  const [accuracyPrediction, setAccuracyPrediction] = useState<number | null>(null);

  const canSubmit = focusRating !== null && (question2 === null || accuracyPrediction !== null);

  function handleSubmit() {
    if (!canSubmit || focusRating === null) return;
    onSubmit({
      focusRating,
      ...(question2 !== null && accuracyPrediction !== null ? { accuracyPrediction } : {}),
      timestamp: Date.now(),
    });
  }

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-gray-700/70 bg-gray-900/95 p-6 shadow-2xl flex flex-col gap-5">
        {/* Header */}
        <div className="text-center">
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-1 font-semibold">Quick check-in</p>
          <h2 className="text-base font-bold text-white leading-tight">
            {testLabel} — how did it go?
          </h2>
        </div>

        {/* Divider */}
        <div className="h-px bg-gray-800" />

        {/* Questions */}
        <div className="flex flex-col gap-5">
          <StarRow
            question={question1}
            emoji1="😴"
            emoji5="🎯"
            value={focusRating}
            onChange={setFocusRating}
          />
          {question2 !== null && (
            <StarRow
              question={question2}
              emoji1="🤔"
              emoji5="✅"
              value={accuracyPrediction}
              onChange={setAccuracyPrediction}
            />
          )}
        </div>

        {/* Continue button */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={[
            'w-full py-3.5 rounded-2xl font-semibold text-sm transition',
            canSubmit
              ? 'bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white shadow-[0_8px_24px_rgba(0,140,255,0.22)] active:translate-y-[1px]'
              : 'bg-gray-800 text-gray-500 cursor-not-allowed',
          ].join(' ')}
        >
          Continue to next test →
        </button>

        {question2 !== null && (
          <p className="text-center text-xs text-gray-600">Answer both questions to continue</p>
        )}
      </div>
    </div>
  );
}
