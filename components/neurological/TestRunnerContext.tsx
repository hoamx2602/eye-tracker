'use client';

import React, { createContext, useCallback, useContext } from 'react';
import type { TestResultPayload } from './types';

export interface TestRunnerContextValue {
  testId: string;
  config: Record<string, unknown>;
  completeTest: (payload: TestResultPayload) => void;
}

const TestRunnerContext = createContext<TestRunnerContextValue | null>(null);

export type TestRunnerProviderProps = {
  testId: string;
  config: Record<string, unknown>;
  onTestComplete: (payload: TestResultPayload) => void;
  children: React.ReactNode;
};

export function TestRunnerProvider({
  testId,
  config,
  onTestComplete,
  children,
}: TestRunnerProviderProps) {
  const completeTest = useCallback(
    (payload: TestResultPayload) => {
      onTestComplete({ ...payload, testId });
    },
    [testId, onTestComplete]
  );

  const value: TestRunnerContextValue = {
    testId,
    config,
    completeTest,
  };

  return (
    <TestRunnerContext.Provider value={value}>
      {children}
    </TestRunnerContext.Provider>
  );
}

export function useTestRunner(): TestRunnerContextValue {
  const ctx = useContext(TestRunnerContext);
  if (!ctx) {
    throw new Error('useTestRunner must be used inside TestRunnerProvider');
  }
  return ctx;
}
