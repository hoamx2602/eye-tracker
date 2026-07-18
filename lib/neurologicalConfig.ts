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

/** Default gaze sampling interval in ms — applied to all tests unless overridden per-test. */
export const DEFAULT_GAZE_SAMPLE_INTERVAL_MS = 100;

/**
 * Minimum distance (px) that any stimulus/object must stay from the screen edge during all tests.
 * Calibration uses ~4% of viewport (~77px on 1920px wide) as its outermost point; keeping this
 * value at or above that prevents gaze predictions from being asked to extrapolate beyond the
 * calibrated region, which is the main cause of "off-screen" gaze samples in Anti-Saccade.
 */
export const DEFAULT_EDGE_PADDING_PX = 80;

/** Global parameters shared across all tests. Stored as testParameters['_global'] in DB. */
export const DEFAULT_GLOBAL_PARAMETERS: Record<string, unknown> = {
  edgePaddingPx: DEFAULT_EDGE_PADDING_PX,
};

export const DEFAULT_TEST_PARAMETERS: Record<string, Record<string, unknown>> = {
  head_orientation: { durationPerDirectionSec: 4, order: ['left', 'right', 'up', 'down'] },
  visual_search: {
    numberCount: 8,
    practiceCount: 4,
    aoiRadiusPx: 80,
    confirmMode: 'gaze',
    clickHoldDurationMs: 300,
    gazeSampleIntervalMs: DEFAULT_GAZE_SAMPLE_INTERVAL_MS,
  },
  memory_cards: {
    cardCount: 16,
    dwellMs: 800,
    symbolSize: 'lg',
    gazeSampleIntervalMs: DEFAULT_GAZE_SAMPLE_INTERVAL_MS,
  },
  anti_saccade: {
    trialCount: 12,
    movementSpeedPxPerSec: 120,
    intervalBetweenTrialsMs: 800,
    fixationPauseMs: 1000,
    practiceRestartDelaySec: 3,
    dimRectOpacity: 0.1,
    showDimRect: true,
    stimulusShape: 'rectangle',
    primaryRectColor: 'red',
    dimRectColor: 'blue',
    gazeSampleIntervalMs: DEFAULT_GAZE_SAMPLE_INTERVAL_MS,
  },
  saccadic: {
    targetDurationMs: 1000,
    totalCycles: 18,
    targetDotSizePx: 64,
    targetDotColor: '#f59e0b',
    gazeSampleIntervalMs: DEFAULT_GAZE_SAMPLE_INTERVAL_MS,
  },
  fixation_stability: {
    durationSec: 5,
    blinkIntervalMs: 600,
    centerDotSizePx: 12,
    centerDotColor: '#f59e0b',
    gazeSampleIntervalMs: DEFAULT_GAZE_SAMPLE_INTERVAL_MS,
  },
  peripheral_vision: {
    trialCount: 16,
    stimulusDurationMs: 300,
    minDelayMs: 800,
    maxDelayMs: 2000,
    centerDotSizePx: 8,
    centerDotColor: '#f59e0b',
    stimulusDotSizePx: 16,
    stimulusDotColor: '#ffffff',
    gazeSampleIntervalMs: DEFAULT_GAZE_SAMPLE_INTERVAL_MS,
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

/**
 * Quick test mode (env: NEURO_QUICK_MODE) — collapses every test to the smallest
 * run each still allows, so a full 7-test battery can be walked end-to-end in a
 * couple of minutes when what you're actually validating is the pipeline (offline
 * export/reprocess, saving, results), not clinical data.
 *
 * Values are set intentionally low; each test component already clamps its own
 * param to a safe floor (anti-saccade/saccadic ≥ 2 trials, peripheral ≥ 8 trials,
 * fixation ≥ 5 s, head ≥ 1 s), so we don't have to track those floors here — we
 * just ask for the minimum and let the clamps land. `_selfAssessment.enabled`
 * false and `_quickMode` true are read by the flow (skip questions, skip practice).
 *
 * NOT for real assessments: results from a 1–2 trial run are not clinically
 * meaningful. Leave the env unset in any real session.
 */
export const QUICK_MODE_TEST_PARAMETERS: Record<string, Record<string, unknown>> = {
  head_orientation: { durationPerDirectionSec: 1, order: ['left'] },
  visual_search: { numberCount: 6, practiceCount: 0 },
  memory_cards: { cardCount: 2, dwellMs: 300 },
  anti_saccade: { trialCount: 1, intervalBetweenTrialsMs: 200, fixationPauseMs: 200 },
  saccadic: { totalCycles: 1, targetDurationMs: 400 },
  fixation_stability: { durationSec: 1 },       // clamps up to the 5 s floor
  peripheral_vision: { trialCount: 1, minDelayMs: 300, maxDelayMs: 600 },  // clamps up to 8 trials
};

/**
 * Merge the quick-mode overrides into a resolved testParameters map (default or
 * DB). Per-test params are shallow-merged so unrelated settings (colors, sizes)
 * are preserved; `_selfAssessment` is disabled and `_quickMode` flagged.
 */
export function applyQuickMode(
  testParameters: Record<string, Record<string, unknown>>
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = { ...testParameters };
  for (const [testId, overrides] of Object.entries(QUICK_MODE_TEST_PARAMETERS)) {
    out[testId] = { ...(out[testId] ?? {}), ...overrides };
  }
  out._selfAssessment = { ...(out._selfAssessment ?? {}), enabled: false };
  out._quickMode = { enabled: true };
  return out;
}

/**
 * True when quick test mode is enabled via env. Reads NEXT_PUBLIC_NEURO_QUICK_MODE
 * (client-visible, so the same flag also shrinks calibration in App.tsx) and
 * falls back to the legacy server-only NEURO_QUICK_MODE. Works server-side (API
 * route) and client-side.
 */
export function isQuickModeEnv(): boolean {
  const v = (process.env.NEXT_PUBLIC_NEURO_QUICK_MODE ?? process.env.NEURO_QUICK_MODE ?? '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/** Build config snapshot for a run (testOrder + testParameters + testEnabled). */
export function getDefaultConfigSnapshot() {
  return {
    testOrder: [...DEFAULT_TEST_ORDER],
    testParameters: {
      _global: { ...DEFAULT_GLOBAL_PARAMETERS },
      ...DEFAULT_TEST_PARAMETERS,
    },
    testEnabled: { ...DEFAULT_TEST_ENABLED },
  };
}
