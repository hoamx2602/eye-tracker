'use client';

import { useRef, useCallback } from 'react';
import { useTestRunner } from './TestRunnerContext';
import type { TestEvent, GazeSample } from './types';

/**
 * Optional helper for tests to record events and gaze samples, then call completeTest with a standard payload.
 * Usage: const { startRecording, recordEvent, recordGazeSample, completeWithRecordedData } = useTestRecorder();
 * Call startRecording() when test phase begins; record events/samples during test; call completeWithRecordedData({ metrics }) when done.
 */
export function useTestRecorder() {
  const { testId, config, completeTest } = useTestRunner();
  const startTimeRef = useRef<number>(0);
  const eventsRef = useRef<TestEvent[]>([]);
  const gazeSamplesRef = useRef<GazeSample[]>([]);

  const startRecording = useCallback(() => {
    startTimeRef.current = performance.now();
    eventsRef.current = [];
    gazeSamplesRef.current = [];
  }, []);

  const recordEvent = useCallback((type: string, payload?: Record<string, unknown>) => {
    eventsRef.current.push({
      type,
      timestamp: performance.now() - startTimeRef.current,
      payload,
    });
  }, []);

  const recordGazeSample = useCallback((x: number, y: number, head?: { yaw?: number; pitch?: number; roll?: number }) => {
    gazeSamplesRef.current.push({
      t: (performance.now() - startTimeRef.current) / 1000,
      x,
      y,
      head,
    });
  }, []);

  const completeWithRecordedData = useCallback(
    (extra?: { metrics?: Record<string, unknown>; [key: string]: unknown }) => {
      const endTime = performance.now();
      completeTest({
        testId,
        startTime: startTimeRef.current,
        endTime,
        events: [...eventsRef.current],
        gazeSamples: [...gazeSamplesRef.current],
        ...extra,
      });
    },
    [completeTest, testId]
  );

  return {
    config,
    startRecording,
    recordEvent,
    recordGazeSample,
    completeWithRecordedData,
    getStartTime: () => startTimeRef.current,
  };
}
