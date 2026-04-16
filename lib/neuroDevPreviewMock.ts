/**
 * Dev-only: minimal payloads so the results UI mounts without running tests.
 * Enable with NEXT_PUBLIC_NEURO_DEV_PREVIEW=1 and open /neuro/done?preview=1
 */
import type { TestResultPayload } from '@/components/neurological';

export const NEURO_PREVIEW_RUN_ID = '__neuro_preview__';

export const DEFAULT_NEURO_TEST_ORDER = [
  'head_orientation',
  'visual_search',
  'memory_cards',
  'anti_saccade',
  'saccadic',
  'fixation_stability',
  'peripheral_vision',
] as const;

export function neuroDevPreviewEnabled(): boolean {
  return (
    typeof process !== 'undefined' && process.env.NEXT_PUBLIC_NEURO_DEV_PREVIEW === '1'
  );
}

/** Small synthetic dataset — enough for each preview component to render. */
export function getNeuroResultsPreviewMock(): Record<string, TestResultPayload> {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const now = t0 + 60_000;

  const gazeLine = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      t: i * 0.05,
      x: 400 + i * 3,
      y: 300 + Math.sin(i * 0.2) * 20,
    }));

  return {
    head_orientation: {
      testId: 'head_orientation',
      startTime: t0,
      endTime: now,
      phases: [
        {
          direction: 'left',
          startTime: t0,
          endTime: t0 + 4000,
          headSamples: [
            { t: 0, yaw: -5, pitch: 0, roll: 0 },
            { t: 0.1, yaw: -12, pitch: 1, roll: 0 },
          ],
        },
      ],
    } as TestResultPayload,
    visual_search: {
      testId: 'visual_search',
      startTime: t0,
      endTime: now,
      confirmMode: 'gaze',
      clickHoldDurationMs: 300,
      completionTimeMs: 12000,
      numberPositions: [
        { number: 1, x: 20, y: 25 },
        { number: 2, x: 70, y: 55 },
      ],
      stimulusBounds: { left: 0, top: 72, width: 1200, height: 656 },
      fixations: [],
      sequence: [1, 2],
      gazePath: gazeLine(20),
      gazeFixationPerNumber: { 1: 2, 2: 1 },
      gazeSequence: [1, 2],
      scanningPath: gazeLine(20),
      viewportWidth: 1200,
      viewportHeight: 800,
    } as TestResultPayload,
    memory_cards: {
      testId: 'memory_cards',
      startTime: t0,
      endTime: now,
      cardCount: 4,
      cols: 2,
      rows: 2,
      board: [0, 1, 0, 1],
      moves: [
        { card1Index: 0, card2Index: 2, match: true, timestamp: t0 + 1200 },
        { card1Index: 1, card2Index: 3, match: true, timestamp: t0 + 3800 },
      ],
      numberOfMoves: 2,
      correctPairsCount: 2,
      completionTimeMs: 8000,
      gazePath: Array.from({ length: 160 }, (_, i) => ({
        t: i * 0.05,
        x: 400 + i * 2,
        y: 300 + Math.sin(i * 0.1) * 25,
      })),
      viewportWidth: 1200,
      viewportHeight: 800,
      gridRect: { left: 260, top: 60, width: 680, height: 680 },
    } as TestResultPayload,
    anti_saccade: {
      testId: 'anti_saccade',
      startTime: t0,
      endTime: now,
      viewportWidth: 1200,
      viewportHeight: 800,
      trials: [
        {
          direction: 'left',
          startTime: t0,
          latencyMs: 220,
          gazeSamples: gazeLine(10),
          gazeMean: { x: 420, y: 310 },
          gazeDirectionDeg: 5,
          targetDirectionDeg: 180,
          angularErrorDeg: -175,
        },
      ],
      metrics: { avgLatency: 220, directionAccuracy: 100 },
    } as TestResultPayload,
    saccadic: {
      testId: 'saccadic',
      startTime: t0,
      endTime: now,
      cycles: [
        {
          targetSide: 'left',
          onsetTime: t0,
          latencyMs: 180,
          gazeSamples: gazeLine(15),
        },
      ],
      saccadeLatencyMs: [180],
      fixationAccuracy: 100,
      correctiveSaccades: 0,
      viewportWidth: 1200,
      viewportHeight: 800,
      metrics: { avgLatency: 180, fixationAccuracy: 100, correctiveSaccadeCount: 0 },
    } as TestResultPayload,
    fixation_stability: {
      testId: 'fixation_stability',
      startTime: t0,
      endTime: now,
      durationMs: 5000,
      gazeSamples: gazeLine(80),
      viewportWidth: 1200,
      viewportHeight: 800,
      bcea68Px2: 120,
      bcea95Px2: 340,
      metrics: { bcea68Px2: 120, bcea95Px2: 340 },
    } as TestResultPayload,
    peripheral_vision: {
      testId: 'peripheral_vision',
      startTime: t0,
      endTime: now,
      stimulusDurationMs: 300,
      trials: [
        {
          trialStartTime: t0,
          stimulusOnsetTime: t0 + 400,
          stimulusX: 600,
          stimulusY: 194,
          rtMs: 280,
          hit: true,
          gazeSamples: gazeLine(8),
          centeringMeanDistancePx: 42,
          centeringStdDistancePx: 12,
        },
      ],
      scanningPath: gazeLine(8).map((s) => ({ t: s.t, x: s.x, y: s.y })),
      viewportWidth: 1200,
      viewportHeight: 800,
      metrics: {
        avgRT: 280,
        accuracy: 100,
        centerStability: 40,
        avgCenteringDistancePx: 42,
        avgCenteringStdPx: 12,
      },
    } as TestResultPayload,
  };
}
