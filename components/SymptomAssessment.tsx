'use client';

import React, { useState, useEffect } from 'react';
import {
  SYMPTOM_QUESTIONS,
  SYMPTOM_SCALE_LABELS,
  SYMPTOM_QUESTION_IDS,
  SYMPTOM_INSTRUCTION_PRE,
  SYMPTOM_INSTRUCTION_POST,
  SYMPTOM_SCALE_LEGEND,
  type SymptomScores,
  type SymptomScoreValue,
} from '@/lib/symptomAssessment';

export type SymptomAssessmentVariant = 'pre' | 'post';

type SymptomAssessmentProps = {
  variant: SymptomAssessmentVariant;
  onSubmit: (scores: SymptomScores) => void;
};

const TITLE_PRE = 'Pre-test symptom assessment';
const TITLE_POST = 'Post-test symptom assessment';

export default function SymptomAssessment({
  variant,
  onSubmit,
}: SymptomAssessmentProps) {
  const [scores, setScores] = useState<Partial<SymptomScores>>({});
  const [error, setError] = useState<string | null>(null);

  const instruction = variant === 'pre' ? SYMPTOM_INSTRUCTION_PRE : SYMPTOM_INSTRUCTION_POST;
  const title = variant === 'pre' ? TITLE_PRE : TITLE_POST;

  const setScore = (questionId: string, value: SymptomScoreValue) => {
    setScores((prev) => ({ ...prev, [questionId]: value }));
    setError(null);
  };

  const isComplete =
    SYMPTOM_QUESTION_IDS.every((id) => {
      const v = scores[id];
      return typeof v === 'number' && v >= 0 && v <= 4;
    });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isComplete) {
      setError('Please answer all 12 questions (0–4).');
      return;
    }
    const out: SymptomScores = {};
    SYMPTOM_QUESTION_IDS.forEach((id) => {
      out[id] = scores[id] as number;
    });
    onSubmit(out);
  };

  // Lock body scroll so only the inner list scrolls (prevents page jump/cut-off)
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-gray-950 overflow-hidden isolate"
      role="region"
      aria-labelledby="symptom-assessment-title"
      aria-describedby="symptom-assessment-instruction"
    >
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
        {/* Header */}
        <div className="flex-shrink-0 p-6 border-b border-gray-800">
          <h1
            id="symptom-assessment-title"
            className="text-xl font-bold text-white uppercase tracking-widest"
          >
            {title}
          </h1>
          <p id="symptom-assessment-instruction" className="text-gray-400 text-sm mt-2">
            {instruction}
          </p>
          <p className="text-gray-500 text-xs mt-1">{SYMPTOM_SCALE_LEGEND}</p>
        </div>

        {/* Scrollable list: contain scroll so wheel doesn't move the page; overflow-anchor-none prevents jump when content reflows */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain overflow-anchor-none p-6 space-y-6">
          {error && (
            <p
              role="alert"
              className="text-red-400 text-sm bg-red-400/10 border border-red-400/30 rounded-lg px-3 py-2"
            >
              {error}
            </p>
          )}
          {SYMPTOM_QUESTIONS.map((q) => (
            <fieldset
              key={q.id}
              className="rounded-xl bg-gray-900 border border-gray-700 p-4"
              aria-describedby={`${q.id}-category`}
            >
              <legend className="sr-only">
                {q.category}: {q.question}
              </legend>
              <p id={`${q.id}-category`} className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                {q.category}
              </p>
              <p className="text-sm text-gray-200 mb-3">{q.question}</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label={`Score for ${q.id}`}>
                {SYMPTOM_SCALE_LABELS.map(({ value, label }) => (
                  <label
                    key={value}
                    className={`inline-flex items-center justify-center min-w-[4rem] px-3 py-2 rounded-lg border text-sm font-medium cursor-pointer transition-colors ${
                      scores[q.id] === value
                        ? 'border-blue-500 bg-blue-600/30 text-white'
                        : 'border-gray-600 bg-gray-800 text-gray-300 hover:border-gray-500'
                    }`}
                    onClick={(e) => {
                      e.preventDefault();
                      setScore(q.id, value as SymptomScoreValue);
                    }}
                  >
                    <input
                      type="radio"
                      name={q.id}
                      value={value}
                      checked={scores[q.id] === value}
                      onChange={() => setScore(q.id, value as SymptomScoreValue)}
                      className="sr-only"
                      aria-label={`${label} (${value})`}
                    />
                    <span className="tabular-nums">{value}</span>
                    <span className="ml-1.5 hidden sm:inline">— {label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>

        <div className="flex-shrink-0 p-6 border-t border-gray-800 flex justify-end">
          <button
            type="submit"
            disabled={!isComplete}
            className="px-8 py-3.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl transition shadow-[0_0_20px_rgba(37,99,235,0.3)] shadow-glow"
          >
            Continue
          </button>
        </div>
      </form>
    </div>
  );
}
