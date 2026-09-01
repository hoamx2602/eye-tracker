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
  /**
   * False when the head was outside the setup pose at this instant.
   *
   * The x/y are then a *stale repeat* of the last valid estimate, not a
   * measurement — gaze prediction is gated on head validity and simply stops
   * updating. Left unflagged, a stretch of these reads as a flawlessly steady
   * fixation. Samples are kept rather than dropped so the gap stays visible in
   * the timeline; anything computing a metric must filter on this.
   */
  valid?: boolean;
}

/** Payload passed to onTestComplete. testId + timing required; rest per-test. */
export interface TestResultPayload {
  testId: string;
  startTime: number;
  endTime: number;
  events?: TestEvent[];
  gazeSamples?: GazeSample[];
  metrics?: Record<string, unknown>;
  [key: string]: unknown;
}
