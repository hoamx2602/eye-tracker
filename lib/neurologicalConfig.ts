/**
 * Default neurological test config (ticket 14). Used when no NeurologicalTestConfig exists in DB.
 * testOrder and testParameters match tickets 05–11.
 */
export const DEFAULT_TEST_ORDER = [
  'head_orientation',
  'visual_search',
  'memory_cards',
  'anti_saccade',
  'saccadic',
  'fixation_stability',
  'peripheral_vision',
] as const;

export type NeuroTestId = (typeof DEFAULT_TEST_ORDER)[number];

export const DEFAULT_TEST_PARAMETERS: Record<string, Record<string, unknown>> = {
  head_orientation: { durationPerDirectionSec: 4, order: ['left', 'right', 'up', 'down'] },
  visual_search: { numberCount: 8, practiceCount: 4, aoiRadiusPx: 80 },
  memory_cards: { cardCount: 16, dwellMs: 800, symbolSize: 'lg' },
  anti_saccade: {
    trialCount: 12,
    movementSpeedPxPerSec: 120,
    intervalBetweenTrialsMs: 800,
    practiceRestartDelaySec: 3,
    dimRectOpacity: 0.1,
    showDimRect: true,
    stimulusShape: 'rectangle',
  },
  saccadic: { targetDurationMs: 1000, totalCycles: 18 },
  fixation_stability: { durationSec: 5, blinkIntervalMs: 600 },
  peripheral_vision: {
    trialCount: 16,
    stimulusDurationMs: 300,
    minDelayMs: 800,
    maxDelayMs: 2000,
  },
};

export const DEFAULT_TEST_ENABLED: Record<string, boolean> = {
  head_orientation: true,
  visual_search: true,
  memory_cards: true,
  anti_saccade: true,
  saccadic: true,
  fixation_stability: true,
  peripheral_vision: true,
};

/** Build config snapshot for a run (testOrder + testParameters + testEnabled). */
export function getDefaultConfigSnapshot() {
  return {
    testOrder: [...DEFAULT_TEST_ORDER],
    testParameters: { ...DEFAULT_TEST_PARAMETERS },
    testEnabled: { ...DEFAULT_TEST_ENABLED },
  };
}
