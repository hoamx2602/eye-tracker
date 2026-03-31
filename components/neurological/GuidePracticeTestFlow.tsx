'use client';

import React, { useCallback, useState } from 'react';
import GuideSteps from './GuideSteps';
import PracticeGate from './PracticeGate';
import { TestRunnerProvider } from './TestRunnerContext';
import type { GuideStep } from './types';
import type { TestResultPayload } from './types';

export type GuidePracticeTestFlowPhase = 'guide' | 'practice' | 'test';

/** Self-assessment config passed down from admin config snapshot. */
export interface SelfAssessmentConfig {
  enabled: boolean;
  questionCount: 1 | 2;
  question1: string;
  question2: string;
}

export type GuidePracticeTestFlowProps = {
  testId: string;
  guideSteps: GuideStep[];
  /** If true, show PracticeGate with practiceContent before test phase */
  enablePractice?: boolean;
  /** Content shown during practice. May be ReactNode or (config) => ReactNode to receive test config. */
  practiceContent?: React.ReactNode | ((config: Record<string, unknown>) => React.ReactNode);
  /** Optional title for the practice screen */
  practiceTitle?: string;
  /** Content rendered during test phase. Must use useTestRunner() and call completeTest(payload) when done. */
  testContent: React.ReactNode;
  config: Record<string, unknown>;
  onTestComplete: (payload: TestResultPayload) => void;
  completeButtonLabel?: string;
  /** Human-readable label for this test — shown in self-assessment header. */
  testLabel?: string;
  /** If provided, embeds self-assessment rating directly in the post-test overlay. */
  selfAssessmentConfig?: SelfAssessmentConfig | null;
};

/** Single star-row used inside the inline post-test overlay. */
export function InlineStarRow({
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
      <p className="text-sm text-gray-300 text-center leading-snug">{question}</p>
      <div className="flex items-center justify-center gap-1.5">
        <span className="text-lg select-none">{emoji1}</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={[
              'w-9 h-9 sm:w-10 sm:h-10 rounded-full border-2 transition-all duration-100 text-sm font-bold select-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
              value === n
                ? 'bg-gradient-to-br from-blue-500 to-cyan-400 border-blue-400 text-white shadow-[0_4px_14px_rgba(0,140,255,0.35)] scale-110'
                : 'bg-gray-700 border-gray-500 text-gray-300 hover:border-blue-400 hover:text-blue-300 hover:bg-gray-600',
            ].join(' ')}
          >
            {n}
          </button>
        ))}
        <span className="text-lg select-none">{emoji5}</span>
      </div>
    </div>
  );
}

/**
 * Orchestrates Guide → (Practice?) → Test for a single neurological test.
 *
 * When test completes, shows a single "Test complete" overlay that:
 *   1. (If selfAssessmentConfig.enabled) immediately renders the rating questions inline —
 *      no extra click needed, no separate modal.
 *   2. Has Redo and Continue buttons. Continue is disabled until all required ratings answered.
 *
 * Self-assessment is completely independent of the pre/post symptom questionnaires.
 */
export default function GuidePracticeTestFlow({
  testId,
  guideSteps,
  enablePractice = false,
  practiceContent,
  practiceTitle,
  testContent,
  config,
  onTestComplete,
  completeButtonLabel = 'Start Test',
  testLabel,
  selfAssessmentConfig,
}: GuidePracticeTestFlowProps) {
  const [phase, setPhase] = useState<GuidePracticeTestFlowPhase>('guide');
  const [pendingPayload, setPendingPayload] = useState<TestResultPayload | null>(null);
  const [testRunKey, setTestRunKey] = useState(0);

  // Inline self-assessment state — reset when test restarts
  const [focusRating, setFocusRating] = useState<number | null>(null);
  const [accuracyRating, setAccuracyRating] = useState<number | null>(null);

  /** Stable callback — avoids "Maximum update depth" in tests that call completeTest in useEffect. */
  const handleRunnerComplete = useCallback((payload: TestResultPayload) => {
    setPendingPayload(payload);
    // Reset ratings for each new test result
    setFocusRating(null);
    setAccuracyRating(null);
  }, []);

  const saEnabled = selfAssessmentConfig?.enabled === true;
  const saQ2Visible = saEnabled && selfAssessmentConfig!.questionCount >= 2;

  // Continue is available when: no self-assessment needed, OR all shown questions answered
  const canContinue = !saEnabled
    || (focusRating !== null && (!saQ2Visible || accuracyRating !== null));

  function handleContinue() {
    if (!pendingPayload || !canContinue) return;
    const enrichedPayload: TestResultPayload = {
      ...pendingPayload,
      ...(saEnabled && focusRating !== null
        ? {
            selfAssessment: {
              focusRating,
              ...(saQ2Visible && accuracyRating !== null ? { accuracyPrediction: accuracyRating } : {}),
              timestamp: Date.now(),
            },
          }
        : {}),
    };
    onTestComplete(enrichedPayload);
    setPendingPayload(null);
    setFocusRating(null);
    setAccuracyRating(null);
  }

  function handleRedo() {
    setPendingPayload(null);
    setFocusRating(null);
    setAccuracyRating(null);
    setTestRunKey((k) => k + 1);
  }

  if (phase === 'guide') {
    return (
      <GuideSteps
        steps={guideSteps}
        onComplete={() => {
          if (enablePractice && practiceContent) {
            setPhase('practice');
          } else {
            setPhase('test');
          }
        }}
        completeButtonLabel={completeButtonLabel}
      />
    );
  }

  if (phase === 'practice') {
    const content =
      typeof practiceContent === 'function' ? practiceContent(config) : practiceContent;
    return (
      <PracticeGate
        title={practiceTitle}
        onStartRealTest={() => setPhase('test')}
      >
        {content}
      </PracticeGate>
    );
  }

  return (
    <>
      <TestRunnerProvider
        key={testRunKey}
        testId={testId}
        config={config}
        onTestComplete={handleRunnerComplete}
      >
        {testContent}
      </TestRunnerProvider>

      {pendingPayload !== null && (
        /* z-[60] → always above test overlays which use z-50 */
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-gray-800 rounded-2xl border border-gray-700 shadow-2xl w-full max-w-sm flex flex-col gap-0 overflow-hidden">

            {/* Header */}
            <div className="px-6 pt-5 pb-4 text-center border-b border-gray-700">
              <p className="text-xs text-gray-400 uppercase tracking-widest font-semibold mb-1">Complete</p>
              <p className="text-white font-bold text-base">
                {testLabel ?? testId}
              </p>
            </div>

            {/* Inline self-assessment — shown immediately, no extra click */}
            {saEnabled && selfAssessmentConfig && (
              <div className="px-6 py-5 flex flex-col gap-4 border-b border-gray-700">
                <p className="text-xs text-gray-400 text-center uppercase tracking-widest font-semibold">
                  Quick check-in
                </p>
                <InlineStarRow
                  question={selfAssessmentConfig.question1}
                  emoji1="😴"
                  emoji5="🎯"
                  value={focusRating}
                  onChange={setFocusRating}
                />
                {saQ2Visible && (
                  <InlineStarRow
                    question={selfAssessmentConfig.question2}
                    emoji1="🤔"
                    emoji5="✅"
                    value={accuracyRating}
                    onChange={setAccuracyRating}
                  />
                )}
                {!canContinue && (
                  <p className="text-xs text-gray-500 text-center">
                    Answer {saQ2Visible ? 'both questions' : 'the question above'} to continue
                  </p>
                )}
              </div>
            )}

            {/* Action buttons */}
            <div className="px-6 py-5 flex gap-3">
              <button
                type="button"
                onClick={handleRedo}
                className="flex-1 px-4 py-3 rounded-2xl border border-gray-500 bg-gray-700 hover:bg-gray-600 hover:border-gray-400 text-white font-semibold text-sm transition active:translate-y-[1px]"
              >
                Redo
              </button>
              <button
                type="button"
                onClick={handleContinue}
                disabled={!canContinue}
                className={[
                  'group flex-1 px-4 py-3 font-semibold text-sm rounded-2xl transition active:translate-y-[1px]',
                  canContinue
                    ? 'bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white shadow-[0_8px_24px_rgba(0,140,255,0.18)]'
                    : 'bg-gray-700 text-gray-500 cursor-not-allowed',
                ].join(' ')}
              >
                <span className="inline-flex items-center justify-center gap-1.5">
                  <span>Continue</span>
                  {canContinue && (
                    <span className="opacity-90 group-hover:translate-x-0.5 transition">→</span>
                  )}
                </span>
              </button>
            </div>

          </div>
        </div>
      )}
    </>
  );
}
