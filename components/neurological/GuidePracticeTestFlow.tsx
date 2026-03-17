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
 * Use this from the orchestrator (ticket 12) or when embedding one test.
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
    <TestRunnerProvider
      testId={testId}
      config={config}
      onTestComplete={onTestComplete}
    >
      {testContent}
    </TestRunnerProvider>
  );
}
