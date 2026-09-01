'use client';

import { useRef, useCallback } from 'react';
import { useTestRunner } from './TestRunnerContext';
import { useNeuroGaze } from './NeuroGazeContext';
import type { TestEvent, GazeSample } from './types';

/**
 * Optional helper for tests to record events and gaze samples, then call completeTest with a standard payload.
 * Usage: const { startRecording, recordEvent, recordGazeSample, completeWithRecordedData } = useTestRecorder();
 * Call startRecording() when test phase begins; record events/samples during test; call completeWithRecordedData({ metrics }) when done.
 */
export function useTestRecorder() {
  const { testId, config, completeTest } = useTestRunner();
  // Read here rather than asking every test to pass it. A test that forgets
  // would silently record stale gaze as real, which is the failure this exists
  // to prevent — so it must not be something a caller can forget.
  const { gazeValid } = useNeuroGaze();
  const gazeValidRef = useRef(gazeValid);
  gazeValidRef.current = gazeValid;
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
      valid: gazeValidRef.current,
    });
  }, []);

  const completeWithRecordedData = useCallback(
    (extra?: { metrics?: Record<string, unknown>; [key: string]: unknown }) => {
      const endTime = performance.now();
      const samples = gazeSamplesRef.current;
      // How much of this test ran with the participant out of the setup pose.
      // Surfaced on the payload so a trial that looks clean but was recorded
      // through a stale-gaze window can be spotted without opening the samples.
      const invalid = samples.reduce((n, s) => n + (s.valid === false ? 1 : 0), 0);
      completeTest({
        testId,
        startTime: startTimeRef.current,
        endTime,
        events: [...eventsRef.current],
        gazeSamples: [...samples],
        ...(samples.length ? { invalidGazeFraction: invalid / samples.length } : {}),
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
