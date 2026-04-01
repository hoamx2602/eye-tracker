/**
 * resultScoring.ts — pure score computation functions for the user-facing results page.
 *
 * All functions take the raw testResult payload for a single test and return a
 * normalised score 0–100. Scores are population-relative where baselines are
 * available in admin config; fall back to hardcoded seed values when < 20 runs.
 *
 * IMPORTANT: These are pure functions — no side effects, no DB calls.
 */

/**
 * Convert a calibration mean pixel error to visual angle (degrees).
 *
 * Uses the CSS standard: 1 CSS pixel = 1/96 inch = 2.54/96 cm.
 * Formula: θ = atan(errorCm / viewingDistanceCm) × (180/π)
 *
 * @param meanErrorPx   Mean error from calibration validation (CSS pixels)
 * @param viewingDistanceCm  Distance from eye to screen in centimetres (default 60)
 */
export function angularErrorDeg(meanErrorPx: number, viewingDistanceCm = 60): number {
  const CM_PER_CSS_PX = 2.54 / 96; // ≈ 0.02646 cm
  const errorCm = meanErrorPx * CM_PER_CSS_PX;
  return (Math.atan(errorCm / viewingDistanceCm) * 180) / Math.PI;
}

/** Clamp a value between min and max. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Compute p10/p90 normalised score (0–100). Higher is always better. */
export function p10p90Score(value: number, p10: number, p90: number, invertHigherIsBetter = false): number {
  if (p90 <= p10) return 50; // degenerate baselines
  const raw = (value - p10) / (p90 - p10);
  const clamped = clamp(raw, 0, 1);
  const score = Math.round(clamped * 100);
  // For metrics where lower is better (e.g. error, latency), invert
  return invertHigherIsBetter ? 100 - score : score;
}

/** Hardcoded seed baselines used when population data is unavailable. */
export const SEED_BASELINES = {
  visual_search:      { p10Ms: 20000, p90Ms: 90000 },
  saccadic:           { p10LatencyMs: 150, p90LatencyMs: 600 },
  // BCEA in CSS pixels². At ~96 dpi / 60 cm: 1° ≈ 40 px → 1°² ≈ 1600 px².
  // p10 ≈ 2×2° scatter (≈6400 px²), p90 ≈ 4×4° scatter (≈100 000 px²)
  fixation_stability: { p10Bcea95: 6000, p90Bcea95: 100000 },
  peripheral_vision:  { p10RtMs: 200,    p90RtMs: 800 },
  anti_saccade:       { p10ErrorDeg: 5,  p90ErrorDeg: 60 },
  memory_cards:       { p10Efficiency: 0.5, p90Efficiency: 1.0 },
  // head_orientation yaw/pitch are in geometric-headpose "scaled radians":
  //   value = (nose_offset / face_width) × 2π
  // Typical full side-turn ≈ 1.5–3.0; slight tilt ≈ 0.3–0.8
  head_orientation:   { p10RangeDeg: 0.5, p90RangeDeg: 2.5 },
};

type ScoringConfig = Record<string, Record<string, number>>;

function getBaseline<K extends keyof typeof SEED_BASELINES>(
  testId: K,
  key: keyof (typeof SEED_BASELINES)[K],
  scoringConfig?: ScoringConfig
): number {
  const fromConfig = scoringConfig?.[testId]?.[key as string];
  if (typeof fromConfig === 'number') return fromConfig;
  return (SEED_BASELINES[testId] as Record<string, number>)[key as string];
}

// ---------------------------------------------------------------------------
// Individual test score functions
// ---------------------------------------------------------------------------

export function scoreHeadOrientation(
  result: Record<string, unknown>,
  scoringConfig?: ScoringConfig
): number {
  const metrics = (result.metrics ?? {}) as Record<string, unknown>;
  // Prefer pre-computed metric
  let rangeDeg = typeof metrics.maxRangeDeg === 'number' ? metrics.maxRangeDeg
    : typeof metrics.rangeYawDeg === 'number' ? metrics.rangeYawDeg
    : null;

  // Fallback: compute from raw phases for runs that pre-date the metrics wrapper
  if (rangeDeg === null) {
    const phases = result.phases as Array<{ headSamples?: Array<{ yaw?: number; pitch?: number }> }> | undefined;
    if (Array.isArray(phases) && phases.length > 0) {
      let maxVal = 0;
      for (const ph of phases) {
        for (const s of ph.headSamples ?? []) {
          if (typeof s.yaw === 'number') maxVal = Math.max(maxVal, Math.abs(s.yaw));
          if (typeof s.pitch === 'number') maxVal = Math.max(maxVal, Math.abs(s.pitch));
        }
      }
      if (maxVal > 0) rangeDeg = maxVal;
    }
  }

  if (rangeDeg === null) return 0;

  const p10 = getBaseline('head_orientation', 'p10RangeDeg', scoringConfig);
  const p90 = getBaseline('head_orientation', 'p90RangeDeg', scoringConfig);
  return p10p90Score(rangeDeg, p10, p90, false);
}

export function scoreVisualSearch(
  result: Record<string, unknown>,
  scoringConfig?: ScoringConfig
): number {
  const metrics = (result.metrics ?? {}) as Record<string, unknown>;
  const completionTimeMs = typeof metrics.completionTimeMs === 'number'
    ? metrics.completionTimeMs
    : typeof result.completionTimeMs === 'number'
    ? result.completionTimeMs
    : null;
  if (completionTimeMs === null) return 0;

  const p10 = getBaseline('visual_search', 'p10Ms', scoringConfig);
  const p90 = getBaseline('visual_search', 'p90Ms', scoringConfig);
  // Lower time = better → invert
  return p10p90Score(completionTimeMs, p10, p90, true);
}

export function scoreMemoryCards(
  result: Record<string, unknown>,
  scoringConfig?: ScoringConfig
): number {
  const metrics = (result.metrics ?? {}) as Record<string, unknown>;

  // Efficiency = correctPairs / totalMoves. Higher = better.
  // Fall back to top-level fields for runs saved before metrics wrapper was added.
  const correctPairs = typeof metrics.correctPairs === 'number' ? metrics.correctPairs
    : typeof result.correctPairsCount === 'number' ? result.correctPairsCount
    : null;
  const totalMoves = typeof metrics.totalMoves === 'number' ? metrics.totalMoves
    : typeof result.numberOfMoves === 'number' ? result.numberOfMoves
    : null;
  const totalPairs = typeof metrics.totalPairs === 'number' ? metrics.totalPairs
    : typeof result.cardCount === 'number' ? (result.cardCount as number) / 2
    : 8;

  let efficiency: number;
  if (correctPairs !== null && totalMoves !== null && totalMoves > 0) {
    efficiency = correctPairs / totalMoves;
  } else if (correctPairs !== null) {
    efficiency = correctPairs / totalPairs;
  } else {
    return 0;
  }

  const p10 = getBaseline('memory_cards', 'p10Efficiency', scoringConfig);
  const p90 = getBaseline('memory_cards', 'p90Efficiency', scoringConfig);
  return p10p90Score(efficiency, p10, p90, false);
}

export function scoreAntiSaccade(
  result: Record<string, unknown>,
  scoringConfig?: ScoringConfig
): number {
  const metrics = (result.metrics ?? {}) as Record<string, unknown>;
  // Prefer angular error if available
  const avgAngularErrorDeg = typeof metrics.avgAngularErrorDeg === 'number'
    ? metrics.avgAngularErrorDeg
    : typeof metrics.meanAngularErrorDeg === 'number'
    ? metrics.meanAngularErrorDeg
    : null;
  if (avgAngularErrorDeg !== null) {
    const p10 = getBaseline('anti_saccade', 'p10ErrorDeg', scoringConfig);
    const p90 = getBaseline('anti_saccade', 'p90ErrorDeg', scoringConfig);
    return p10p90Score(avgAngularErrorDeg, p10, p90, true);
  }
  // Fall back to directionAccuracy (0–100 percent correct) when angular error isn't stored
  const dirAccuracy = typeof metrics.directionAccuracy === 'number' ? metrics.directionAccuracy : null;
  if (dirAccuracy !== null) {
    return Math.round(clamp(dirAccuracy, 0, 100));
  }
  return 0;
}

export function scoreSaccadic(
  result: Record<string, unknown>,
  scoringConfig?: ScoringConfig
): number {
  const metrics = (result.metrics ?? {}) as Record<string, unknown>;
  const avgLatencyMs = typeof metrics.avgLatencyMs === 'number' ? metrics.avgLatencyMs
    : typeof metrics.meanLatencyMs === 'number' ? metrics.meanLatencyMs
    : typeof metrics.avgLatency === 'number' ? metrics.avgLatency
    : null;
  if (avgLatencyMs === null) return 0;

  const p10 = getBaseline('saccadic', 'p10LatencyMs', scoringConfig);
  const p90 = getBaseline('saccadic', 'p90LatencyMs', scoringConfig);
  // Lower latency = better → invert
  return p10p90Score(avgLatencyMs, p10, p90, true);
}

export function scoreFixationStability(
  result: Record<string, unknown>,
  scoringConfig?: ScoringConfig
): number {
  const metrics = (result.metrics ?? {}) as Record<string, unknown>;
  const bcea95 = typeof metrics.bcea95Px2 === 'number' ? metrics.bcea95Px2
    : typeof metrics.bceaPx2 === 'number' ? metrics.bceaPx2
    : null;
  if (bcea95 === null) return 0;

  const p10 = getBaseline('fixation_stability', 'p10Bcea95', scoringConfig);
  const p90 = getBaseline('fixation_stability', 'p90Bcea95', scoringConfig);
  // Smaller BCEA = more stable = better → invert
  return p10p90Score(bcea95, p10, p90, true);
}

export function scorePeripheralVision(
  result: Record<string, unknown>,
  scoringConfig?: ScoringConfig
): number {
  const metrics = (result.metrics ?? {}) as Record<string, unknown>;
  const accuracy = typeof metrics.accuracy === 'number' ? metrics.accuracy
    : typeof metrics.hitRate === 'number' ? metrics.hitRate
    : null;
  const avgRtMs = typeof metrics.avgRtMs === 'number' ? metrics.avgRtMs
    : typeof metrics.avgResponseTimeMs === 'number' ? metrics.avgResponseTimeMs
    : typeof metrics.avgRT === 'number' ? metrics.avgRT
    : null;

  if (accuracy === null) return 0;

  const p10Rt = getBaseline('peripheral_vision', 'p10RtMs', scoringConfig);
  const p90Rt = getBaseline('peripheral_vision', 'p90RtMs', scoringConfig);

  // accuracy may be stored as 0-100 or 0-1; normalise to 0-1
  const accuracyNorm = accuracy > 1 ? accuracy / 100 : accuracy;
  // 70% from accuracy (0-1), 30% from speed
  const accuracyScore = accuracyNorm * 70;
  let speedScore = 15; // default mid if no RT data
  if (avgRtMs !== null) {
    // Lower RT = faster = better → invert
    speedScore = p10p90Score(avgRtMs, p10Rt, p90Rt, true) * 0.30;
  }

  return Math.round(clamp(accuracyScore + speedScore, 0, 100));
}

// ---------------------------------------------------------------------------
// Master score dispatcher
// ---------------------------------------------------------------------------

export type TestScoreResult = {
  testId: string;
  domainName: string;
  score: number | null; // null = test not run or no data
  observation: string;
};

/** User-facing domain names per test ID */
export const DOMAIN_NAMES: Record<string, string> = {
  head_orientation:   'Head Mobility',
  visual_search:      'Visual Scanning',
  memory_cards:       'Visual Memory',
  anti_saccade:       'Impulse Control',
  saccadic:           'Eye Movement Speed',
  fixation_stability: 'Focus Stability',
  peripheral_vision:  'Peripheral Awareness',
};

/** Domain icons */
export const DOMAIN_ICONS: Record<string, string> = {
  head_orientation:   '↔',
  visual_search:      '🔍',
  memory_cards:       '🧠',
  anti_saccade:       '🎯',
  saccadic:           '⚡',
  fixation_stability: '🌊',
  peripheral_vision:  '👁',
};

function generateObservation(testId: string, score: number): string {
  const high = score >= 70;
  const mid = score >= 40 && score < 70;

  switch (testId) {
    case 'head_orientation':
      return high ? 'You achieved a good range of head movement in all directions.'
        : mid ? 'Your head mobility was in the typical range.'
        : 'Your head movement range was more limited — this is common if posture was slightly constrained.';
    case 'visual_search':
      return high ? 'You scanned and located targets quickly and efficiently.'
        : mid ? 'Your visual scanning speed was in the typical range.'
        : 'Locating targets took a bit longer — this can reflect scan strategy or gaze precision.';
    case 'memory_cards':
      return high ? 'You found matching pairs with minimal unnecessary moves — strong visual memory.'
        : mid ? 'You found pairs at a typical pace with a reasonable number of moves.'
        : 'It took more moves than average to find pairs — normal under timed, unfamiliar conditions.';
    case 'anti_saccade':
      return high ? 'You resisted the pull of distracting stimuli very well.'
        : mid ? 'Your impulse control was in the typical range.'
        : 'Distracting stimuli occasionally pulled your gaze — a very common pattern under test conditions.';
    case 'saccadic':
      return high ? 'Your eyes responded quickly and accurately when targets moved.'
        : mid ? 'Your eye movement response time was in the typical range.'
        : 'Your eye movements were a bit slower to respond — fatigue and test conditions can contribute to this.';
    case 'fixation_stability':
      return high ? 'Your gaze held very steady when fixating on a central point.'
        : mid ? 'Your fixation stability was in the typical range.'
        : 'Your gaze showed some variability when fixating — micro-movements are normal and common.';
    case 'peripheral_vision':
      return high ? 'You detected targets in your peripheral field quickly and accurately.'
        : mid ? 'Your peripheral awareness was in the typical range.'
        : 'Detecting targets in the periphery was more challenging — lighting and fatigue can play a role.';
    default:
      return high ? 'Performance was strong in this domain.'
        : mid ? 'Performance was in the typical range.'
        : 'Performance was below the typical range — context and conditions can contribute to this.';
  }
}

export function computeAllScores(
  testResults: Record<string, Record<string, unknown>>,
  testOrder: string[],
  enabledTests: Record<string, boolean>,
  scoringConfig?: ScoringConfig
): TestScoreResult[] {
  const allTestIds = [
    'head_orientation',
    'visual_search',
    'memory_cards',
    'anti_saccade',
    'saccadic',
    'fixation_stability',
    'peripheral_vision',
  ];

  return allTestIds.map((testId) => {
    const domainName = DOMAIN_NAMES[testId] ?? testId;
    const wasEnabled = enabledTests[testId] !== false;
    const wasRun = testOrder.includes(testId);
    const result = testResults[testId] ?? null;

    if (!wasEnabled || !wasRun || !result) {
      return { testId, domainName, score: null, observation: 'This test was not included in your session.' };
    }

    let score: number;
    switch (testId) {
      case 'head_orientation':   score = scoreHeadOrientation(result, scoringConfig);   break;
      case 'visual_search':      score = scoreVisualSearch(result, scoringConfig);      break;
      case 'memory_cards':       score = scoreMemoryCards(result, scoringConfig);       break;
      case 'anti_saccade':       score = scoreAntiSaccade(result, scoringConfig);       break;
      case 'saccadic':           score = scoreSaccadic(result, scoringConfig);          break;
      case 'fixation_stability': score = scoreFixationStability(result, scoringConfig); break;
      case 'peripheral_vision':  score = scorePeripheralVision(result, scoringConfig);  break;
      default:                   score = 0;
    }

    return {
      testId,
      domainName,
      score: clamp(Math.round(score), 0, 100),
      observation: generateObservation(testId, score),
    };
  });
}

// ---------------------------------------------------------------------------
// Calibration quality helpers
// ---------------------------------------------------------------------------

export function calibrationQualityLabel(meanErrorPx: number | null | undefined): string {
  if (meanErrorPx == null) return 'Unknown tracking quality';
  if (meanErrorPx < 30) return 'Excellent tracking quality';
  if (meanErrorPx < 60) return 'Good tracking quality';
  if (meanErrorPx < 100) return 'Fair tracking quality';
  return 'Tracking quality was low — results may be less accurate';
}

export function calibrationQualityColour(meanErrorPx: number | null | undefined): string {
  if (meanErrorPx == null) return 'text-gray-400';
  if (meanErrorPx < 30) return 'text-emerald-400';
  if (meanErrorPx < 60) return 'text-blue-400';
  if (meanErrorPx < 100) return 'text-amber-400';
  return 'text-red-400';
}

export function eyeTrackingAccuracyScore(meanErrorPx: number): number {
  // Score 0–100: 0 px → 100, 300 px → 0 (linear, clamped)
  return Math.round(Math.max(0, 100 - meanErrorPx / 3));
}

// ---------------------------------------------------------------------------
// Self-assessment reflection helpers
// ---------------------------------------------------------------------------

export type SelfAssessmentInsight = 'under-confident' | 'over-confident' | 'well-calibrated';

export function selfAssessmentInsight(
  testResults: Record<string, Record<string, unknown>>,
  scores: TestScoreResult[]
): { insight: SelfAssessmentInsight; text: string } | null {
  const comparisons: { predicted: number; actual: number }[] = [];

  for (const scoreResult of scores) {
    if (scoreResult.score === null) continue;
    const result = testResults[scoreResult.testId];
    if (!result) continue;
    const sa = result.selfAssessment as { accuracyPrediction?: number } | undefined;
    if (sa?.accuracyPrediction == null) continue;
    // accuracyPrediction is 1-5 → convert to 0-100
    const predicted = ((sa.accuracyPrediction - 1) / 4) * 100;
    comparisons.push({ predicted, actual: scoreResult.score });
  }

  if (comparisons.length < 2) return null;

  const avgDiff = comparisons.reduce((sum, c) => sum + (c.predicted - c.actual), 0) / comparisons.length;
  const absAvgDiff = Math.abs(avgDiff);

  if (absAvgDiff <= 15) {
    return {
      insight: 'well-calibrated',
      text: 'You have strong self-awareness — your predictions closely matched your actual performance.',
    };
  }
  if (avgDiff < -15) {
    return {
      insight: 'under-confident',
      text: 'You tend to be modest about your performance — your actual scores were generally better than you expected.',
    };
  }
  return {
    insight: 'over-confident',
    text: 'Your self-estimates ran a little ahead of your results — which is very common under test conditions.',
  };
}

// ---------------------------------------------------------------------------
// Symptom score helpers
// ---------------------------------------------------------------------------

export function symptomTotal(scores: Record<string, number> | null | undefined): number {
  if (!scores) return 0;
  return Object.values(scores).reduce((sum, v) => sum + (typeof v === 'number' ? v : 0), 0);
}

export const SYMPTOM_LABELS: Record<string, string> = {
  Q1:  'Headache',
  Q2:  'Nausea or stomach upset',
  Q3:  'Dizziness or balance problems',
  Q4:  'Blurred or double vision',
  Q5:  'Sensitivity to light',
  Q6:  'Sensitivity to noise',
  Q7:  'Feeling slowed down',
  Q8:  'Feeling foggy',
  Q9:  'Difficulty concentrating',
  Q10: 'Difficulty remembering',
  Q11: 'Fatigue or low energy',
  Q12: 'Feeling emotional or irritable',
};
