'use client';

import React, { useCallback, useEffect, useState } from 'react';
import GuideSteps from './GuideSteps';
import PracticeGate from './PracticeGate';
import RealTestIntro from './RealTestIntro';
import StepBreak from '@/components/StepBreak';
import { TestRunnerProvider } from './TestRunnerContext';
import { useVoiceRepeat } from '@/lib/voice/VoiceProvider';
import { neuroTestVoiceKey, type VoiceKey } from '@/lib/voice/scripts';
import type { GuideStep } from './types';
import type { TestResultPayload } from './types';

export type GuidePracticeTestFlowPhase = 'guide' | 'practice' | 'realIntro' | 'test';

/** How often the short cue repeats while a test is running. */
const IN_TEST_CUE_INTERVAL_MS = 30000;

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
  /** One line on what this test asks, shown on the real-test countdown. */
  testSummary?: string | null;
  /** Position of this test in the battery, for the break screen. */
  stepIndex?: number;
  stepTotal?: number;
  /** The test that follows, so the break can say what is coming. */
  nextTestLabel?: string | null;
  nextTestDescription?: string | null;
  nextTestId?: string | null;
  /** Called the moment the test ends, so its result can be banked during the break. */
  onTestResultReady?: (payload: TestResultPayload) => void;
  /** Progress of that early save, shown on the break screen. */
  saveState?: 'idle' | 'saving' | 'saved' | 'error';
  /** True while Continue is writing the final result. */
  saving?: boolean;
  /**
   * Repeat this test's short cue while it runs. Off for tests that speak for
   * themselves — head orientation announces every direction as it comes up,
   * and a generic reminder on top of that is just two voices competing.
   */
  repeatCue?: boolean;
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
  testSummary,
  stepIndex,
  stepTotal,
  nextTestLabel,
  nextTestDescription,
  nextTestId,
  onTestResultReady,
  saveState = 'idle',
  saving = false,
  repeatCue = true,
}: GuidePracticeTestFlowProps) {
  const [phase, setPhase] = useState<GuidePracticeTestFlowPhase>('guide');
  const [pendingPayload, setPendingPayload] = useState<TestResultPayload | null>(null);
  const [testRunKey, setTestRunKey] = useState(0);

  // Inline self-assessment state — reset when test restarts
  const [focusRating, setFocusRating] = useState<number | null>(null);
  const [accuracyRating, setAccuracyRating] = useState<number | null>(null);

  /** Stable callback — avoids "Maximum update depth" in tests that call completeTest in useEffect. */
  const handleRunnerComplete = useCallback(
    (payload: TestResultPayload) => {
      setPendingPayload(payload);
      // Reset ratings for each new test result
      setFocusRating(null);
      setAccuracyRating(null);
      // Bank it now; the break is dead time otherwise.
      onTestResultReady?.(payload);
    },
    [onTestResultReady]
  );

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

  /** Stable — RealTestIntro drives its countdown from this in an effect. */
  const handleStartRealTest = useCallback(() => setPhase('test'), []);

  // A short reminder during the task itself. Only the longer tests run past
  // one interval, which is the point: the short ones are never interrupted.
  useVoiceRepeat(
    neuroTestVoiceKey(testId),
    IN_TEST_CUE_INTERVAL_MS,
    repeatCue && phase === 'test' && pendingPayload === null
  );

  function handleRedo() {
    setPendingPayload(null);
    setFocusRating(null);
    setAccuracyRating(null);
    setTestRunKey((k) => k + 1);
  }

  const voiceKey: VoiceKey | null = neuroTestVoiceKey(testId);

  if (phase === 'guide') {
    return (
      <GuideSteps
        steps={guideSteps}
        voiceKey={voiceKey}
        onComplete={() => {
          if (enablePractice && practiceContent) {
            setPhase('practice');
          } else {
            setPhase('realIntro');
          }
        }}
        completeButtonLabel={enablePractice && practiceContent ? 'Try a practice round' : completeButtonLabel}
      />
    );
  }

  if (phase === 'practice') {
    const content =
      typeof practiceContent === 'function' ? practiceContent(config) : practiceContent;
    return (
      <PracticeGate
        title={practiceTitle ? `${practiceTitle} — practice` : 'Practice'}
        instructionsVoiceKey={voiceKey}
        onStartRealTest={() => setPhase('realIntro')}
      >
        {content}
      </PracticeGate>
    );
  }

  if (phase === 'realIntro') {
    return (
      <RealTestIntro
        testLabel={testLabel ?? testId}
        summary={testSummary}
        onStart={handleStartRealTest}
      />
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

      {/* Recording badge — the running counterpart to the practice banner. */}
      {pendingPayload === null && (
        <div className="fixed top-4 left-4 z-[55] pointer-events-none flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-950/80 border border-red-600/50 backdrop-blur">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" aria-hidden />
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-red-200">
            Real test — recording
          </span>
        </div>
      )}

      {pendingPayload !== null && (
        <StepBreak
          stepLabel={testLabel ?? testId}
          stepIndex={stepIndex}
          stepTotal={stepTotal}
          nextLabel={nextTestLabel ?? null}
          nextDescription={nextTestDescription ?? null}
          // No instructions clip: the practice round that follows reads them,
          // and the break is for resting, not for a briefing the participant
          // is about to get twice more.
          nextVoiceKey={null}
          saveState={saving ? 'saving' : saveState}
          onNext={handleContinue}
          onRedo={handleRedo}
          canContinue={canContinue && !saving}
          blockedReason={
            saving
              ? 'Saving this test…'
              : saQ2Visible
                ? 'Answer both questions to continue'
                : 'Answer the question above to continue'
          }
        >
          {saEnabled && selfAssessmentConfig && (
            <div className="rounded-2xl border border-gray-800/70 bg-gray-900/50 p-5 flex flex-col gap-4">
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
            </div>
          )}
        </StepBreak>
      )}
    </>
  );
}
