'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import type { TestResultPayload } from './types';
import { gazeFrameStream, toGazeFrameColumns } from '@/lib/gazeFrameStream';

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
  const onCompleteRef = useRef(onTestComplete);
  onCompleteRef.current = onTestComplete;

  // Every camera frame of gaze while the real test runs (lib/gazeFrameStream).
  // The per-test 10 Hz samples stay for the result previews; metrics that need
  // timing (latency, fixation spread) are computed from these frames.
  const captureTokenRef = useRef<number | null>(null);
  useEffect(() => {
    captureTokenRef.current = gazeFrameStream.begin();
    return () => {
      if (captureTokenRef.current !== null) gazeFrameStream.end(captureTokenRef.current);
      captureTokenRef.current = null;
    };
  }, []);

  const completeTest = useCallback((payload: TestResultPayload) => {
    const token = captureTokenRef.current;
    captureTokenRef.current = null;
    const frames = token !== null ? gazeFrameStream.end(token) : [];
    onCompleteRef.current({
      ...payload,
      testId,
      ...(frames.length > 0 && {
        gazeFrames: toGazeFrameColumns(frames, { w: window.innerWidth, h: window.innerHeight }),
      }),
    });
  }, [testId]);

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
