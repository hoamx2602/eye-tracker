import type { GazeFrameColumns } from '@/lib/gazeFrameStream';
import type { DriftCheck } from '@/lib/driftCorrection';
/**
 * Shared types for the Guide + Practice + Test framework (ticket 04).
 * Each test (05–11) defines its own result payload shape; this is the common contract.
 */

export interface GuideStep {
  id: string;
  title?: string;
  body: string;
  /** Optional image URL for demonstration */
  image?: string;
}

export interface TestEvent {
  type: string;
  timestamp: number;
  payload?: Record<string, unknown>;
}

export interface GazeSample {
  t: number;
  x: number;
  y: number;
  /** Optional: head pose at sample time */
  head?: { yaw?: number; pitch?: number; roll?: number };
}

/** Payload passed to onTestComplete. testId + timing required; rest per-test. */
export interface TestResultPayload {
  testId: string;
  startTime: number;
  endTime: number;
  events?: TestEvent[];
  gazeSamples?: GazeSample[];
  /** Every camera frame of gaze during the test (lib/gazeFrameStream). Added by TestRunnerProvider. */
  gazeFrames?: GazeFrameColumns;
  /** Centre check in the countdown before this test (lib/driftCorrection). Added by TestRunnerProvider. */
  driftCheck?: DriftCheck;
  metrics?: Record<string, unknown>;
  [key: string]: unknown;
}
