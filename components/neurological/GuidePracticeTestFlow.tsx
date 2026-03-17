'use client';

import React, { useCallback, useState } from 'react';
import GuideSteps from './GuideSteps';
import PracticeGate from './PracticeGate';
import { TestRunnerProvider } from './TestRunnerContext';
import type { GuideStep } from './types';
import type { TestResultPayload } from './types';

export type GuidePracticeTestFlowPhase = 'guide' | 'practice' | 'test';

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
};

/**
 * Orchestrates Guide → (Practice?) → Test for a single neurological test.
 * When test completes, shows overlay with Redo and Continue.
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
}: GuidePracticeTestFlowProps) {
  const [phase, setPhase] = useState<GuidePracticeTestFlowPhase>('guide');
  const [pendingPayload, setPendingPayload] = useState<TestResultPayload | null>(null);
  const [testRunKey, setTestRunKey] = useState(0);

  /** Stable callback so TestRunnerProvider does not get a new ref each render (avoids "Maximum update depth" in tests that call completeTest in useEffect). */
  const handleRunnerComplete = useCallback((payload: TestResultPayload) => setPendingPayload(payload), []);

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-gray-900/95 rounded-2xl border border-gray-800/70 p-6 shadow-xl max-w-sm w-full mx-4 flex flex-col gap-5">
            <p className="text-white text-center font-semibold">Test complete</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setPendingPayload(null);
                  setTestRunKey((k) => k + 1);
                }}
                className="flex-1 px-7 py-3.5 rounded-2xl border border-gray-600 bg-gray-800/60 hover:bg-gray-700/70 hover:border-gray-500 text-white font-semibold transition active:translate-y-[1px]"
              >
                Redo
              </button>
              <button
                type="button"
                onClick={() => {
                  onTestComplete(pendingPayload);
                  setPendingPayload(null);
                }}
                className="group flex-1 px-7 py-3.5 bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white font-semibold rounded-2xl transition shadow-[0_10px_30px_rgba(0,140,255,0.18)] active:translate-y-[1px]"
              >
                <span className="inline-flex items-center justify-center gap-2">
                  <span>Continue</span>
                  <span className="opacity-90 group-hover:translate-x-0.5 transition">→</span>
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
