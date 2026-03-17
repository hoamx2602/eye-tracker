'use client';

import React, { useState } from 'react';
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
 * When test completes, shows overlay with Làm lại (redo) and Tiếp tục (continue).
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
        onTestComplete={(payload) => setPendingPayload(payload)}
      >
        {testContent}
      </TestRunnerProvider>
      {pendingPayload !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-gray-900 rounded-xl p-6 shadow-xl max-w-sm w-full mx-4 flex flex-col gap-4">
            <p className="text-white text-center font-medium">Bài test hoàn thành</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setPendingPayload(null);
                  setTestRunKey((k) => k + 1);
                }}
                className="flex-1 py-2.5 px-4 rounded-lg bg-amber-500 hover:bg-amber-600 text-gray-900 font-medium transition-colors"
              >
                Làm lại
              </button>
              <button
                type="button"
                onClick={() => {
                  onTestComplete(pendingPayload);
                  setPendingPayload(null);
                }}
                className="flex-1 py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium transition-colors"
              >
                Tiếp tục
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
