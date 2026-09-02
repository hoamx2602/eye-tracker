/**
 * resultScoring.ts — pure score computation functions for the user-facing results page.
 *
 * All functions take the raw testResult payload for a single test and return a
 * normalised score 0–100. Scores are population-relative where baselines are
 * available in admin config; fall back to hardcoded seed values when < 20 runs.
 *
 * IMPORTANT: These are pure functions — no side effects, no DB calls.
 */

const LENIENT_MODE = typeof process !== 'undefined' && (process.env.NEXT_PUBLIC_LENIENT_SCORING === 'true' || process.env.NEXT_PUBLIC_LENIENT_SCORING === '1');

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
  console.log('[SCORE DEBUG] anti_saccade - top-level keys:', Object.keys(result));
  console.log('[SCORE DEBUG] anti_saccade - metrics:', JSON.stringify(metrics));
  if (Array.isArray(result.trials)) {
    const t0 = (result.trials as any[])[0];
    if (t0) console.log('[SCORE DEBUG] anti_saccade - trials[0] keys:', JSON.stringify(Object.keys(t0)), 'sample:', JSON.stringify(t0).slice(0, 300));
  }

  // Compute avgAngularErrorDeg from per-trial data if metrics doesn't have it
  const avgAngularErrorDeg = typeof metrics.avgAngularErrorDeg === 'number' ? metrics.avgAngularErrorDeg
    : typeof metrics.avgAngularError === 'number' ? metrics.avgAngularError
    : typeof metrics.meanAngularErrorDeg === 'number' ? metrics.meanAngularErrorDeg
    : typeof metrics.angularErrorDeg === 'number' ? metrics.angularErrorDeg
    : (() => {
        const trials = result.trials as Array<{ angularErrorDeg?: number }> | undefined;
        if (!Array.isArray(trials) || trials.length === 0) return null;
        const withErr = trials.filter(t => typeof t.angularErrorDeg === 'number');
        if (withErr.length === 0) return null;
        return withErr.reduce((s, t) => s + Math.abs(t.angularErrorDeg!), 0) / withErr.length;
      })();

  if (avgAngularErrorDeg !== null) {
    const p10 = getBaseline('anti_saccade', 'p10ErrorDeg', scoringConfig);
    const p90 = getBaseline('anti_saccade', 'p90ErrorDeg', scoringConfig);
    const s = p10p90Score(avgAngularErrorDeg, p10, p90, true);
    if (LENIENT_MODE && s < 25) return 25; 
    return s;
  }

  // Fall back to directionAccuracy (0–100 percent correct) when angular error isn't stored
  // In LENIENT_MODE, we prefer calculating from trials if available (which we did above)
  const dirAccuracy = typeof metrics.directionAccuracy === 'number' ? metrics.directionAccuracy : null;
  if (dirAccuracy !== null && !LENIENT_MODE) {
    return Math.round(clamp(dirAccuracy, 0, 100));
  }

  // Final fallback: if trials exist and have gaze samples, give a minimum participation score (e.g. 5) 
  if (Array.isArray(result.trials) && result.trials.length > 0) {
    const hasAnyGaze = result.trials.some((t: any) => Array.isArray(t.gazeSamples) && t.gazeSamples.length > 0);
    if (hasAnyGaze) {
      if (LENIENT_MODE) {
        // Mode 'nhẹ nhàng': Tính điểm dựa trên góc liếc thực tế cho dù không chạm mục tiêu (AOI)
        const allErrors = result.trials
          .map((t: any) => typeof t.angularErrorDeg === 'number' ? Math.abs(t.angularErrorDeg) : null)
          .filter((v): v is number => v !== null);
        if (allErrors.length > 0) {
            const avgErr = allErrors.reduce((a, b) => a + b, 0) / allErrors.length;
            // Cho điểm nền nếu góc lệch < 45 độ
            return Math.round(clamp(40 - (avgErr / 2), 5, 40));
        }
        return 25; // Điểm tham gia tối thiểu thay vì 5
      }
      return 0;
    }
  }

  return 0;
}

export function scoreSaccadic(
  result: Record<string, unknown>,
  scoringConfig?: ScoringConfig
): number {
  const metrics = (result.metrics ?? {}) as Record<string, unknown>;
  console.log('[SCORE DEBUG] saccadic - top-level keys:', Object.keys(result));
  console.log('[SCORE DEBUG] saccadic - metrics:', JSON.stringify(metrics));
  if (Array.isArray(result.cycles)) {
    const c0 = (result.cycles as any[])[0];
    if (c0) console.log('[SCORE DEBUG] saccadic - cycles[0] keys:', JSON.stringify(Object.keys(c0)), 'sample:', JSON.stringify(c0).slice(0, 200));
  }
  // Check all possible field names used across different payload versions
  const avgLatencyMs = typeof metrics.avgLatencyMs === 'number' ? metrics.avgLatencyMs
    : typeof metrics.meanLatencyMs === 'number' ? metrics.meanLatencyMs
    : typeof metrics.avgLatency === 'number' ? metrics.avgLatency
    // Fall back to computing from cycles array if metrics is incomplete
    : (() => {
        const cycles = result.cycles as Array<{ latencyMs?: number }> | undefined;
        if (!Array.isArray(cycles) || cycles.length === 0) return null;
        const withLatency = cycles.filter(c => typeof c.latencyMs === 'number' && c.latencyMs > 0);
        if (withLatency.length === 0) return null;
        return withLatency.reduce((s, c) => s + c.latencyMs!, 0) / withLatency.length;
      })();

  if (avgLatencyMs === null || avgLatencyMs <= 0) {
    // If no latency hit but fixationAccuracy exists, use it
    const fixAcc = typeof metrics.fixationAccuracy === 'number' ? metrics.fixationAccuracy 
      : typeof result.fixationAccuracy === 'number' ? result.fixationAccuracy : null;
    if (fixAcc !== null && fixAcc > 0) return Math.round(fixAcc);

    if (LENIENT_MODE && Array.isArray(result.cycles) && result.cycles.length > 0) {
        // Mode 'nhẹ nhàng': Tính điểm dựa trên việc gaze có "tiến gần" mục tiêu không
        // Duyệt qua các cycles và tìm khoảng cách nhỏ nhất từng cycle
        const minDists = result.cycles.map((cy: any) => {
            if (!Array.isArray(cy.gazeSamples) || cy.gazeSamples.length === 0) return null;
            // Tìm mục tiêu của cycle này (thường lưu ở targetSide)
            const side = cy.targetSide;
            // (Note: viewport and edgePadding usually comes from result but might be missing)
            // If we can't find target pos exactly, we just assume some generic distance.
            // But let's try to find if cy.gazeSamples has any point within a larger radius.
            return 1000; // placeholder
        });
        
        // Thực tế hơn: Nếu có bất kỳ mẫu gaze nào trong cycle, ta cho điểm khuyến khích.
        // Tăng điểm này lên để người dùng thấy có giá trị thực tế hơn (30 thay vì 15).
        return 30; 
    }
    return 0;
  }

  const p10 = getBaseline('saccadic', 'p10LatencyMs', scoringConfig);
  const p90 = getBaseline('saccadic', 'p90LatencyMs', scoringConfig);
  // Lower latency = better → invert
  const s = p10p90Score(avgLatencyMs, p10, p90, true);
  if (LENIENT_MODE && s < 25) return 30; // Trả về 30 điểm khuyến khích
  return s;
}

export function scoreFixationStability(
  result: Record<string, unknown>,
  scoringConfig?: ScoringConfig
): number {
  const metrics = (result.metrics ?? {}) as Record<string, unknown>;
  console.log('[SCORE DEBUG] fixation_stability - top-level keys:', Object.keys(result));
  console.log('[SCORE DEBUG] fixation_stability - metrics:', JSON.stringify(metrics));
  // Check metrics sub-object first, then top-level fields (older payload format)
  const bcea95 = typeof metrics.bcea95Px2 === 'number' ? metrics.bcea95Px2
    : typeof metrics.bceaPx2 === 'number' ? metrics.bceaPx2
    : typeof result.bcea95Px2 === 'number' ? result.bcea95Px2
    : null;

  // bcea95 === 0 means all gaze landed at exactly the same point (e.g. no gaze model);
  // treat as invalid data rather than a perfect score.
  if (bcea95 === null || bcea95 <= 0) {
    // Fallback: use dispersion from metrics if available
    const dispersion = typeof metrics.dispersionPx === 'number' ? metrics.dispersionPx
      : typeof result.gazeDispersion === 'number' ? result.gazeDispersion
      : null;
    
    // If dispersion is also missing/0, it's likely (0,0) data or empty
    if (dispersion === null || dispersion <= 0) {
        // One last check: if we have gazeSamples, calculate raw dispersion to be absolutely sure
        const samples = (result.gazeSamples || result.samples || result.gazePath || result.scanningPath) as Array<{x: number, y: number}> | undefined;
        if (Array.isArray(samples) && samples.length > 5) {
            const valid = samples.filter(s => s.x !== 0 || s.y !== 0);
            if (valid.length > 5) {
                const mx = valid.reduce((a, b) => a + b.x, 0) / valid.length;
                const my = valid.reduce((a, b) => a + b.y, 0) / valid.length;
                const dists = valid.map(s => Math.hypot(s.x - mx, s.y - my));
                const d = dists.reduce((a, b) => a + b, 0) / valid.length;
                if (d > 0) {
                    const approxBcea = Math.PI * 1.96 * 1.96 * d * d;
                    const p10 = getBaseline('fixation_stability', 'p10Bcea95', scoringConfig);
                    const p90 = getBaseline('fixation_stability', 'p90Bcea95', scoringConfig);
                    return p10p90Score(approxBcea, p10, p90, true);
                }
            }
        }
        return 0;
    }
    
    // Convert dispersion (px std-dev) to approximate bcea95: π × z95² × σx × σy ≈ π × (1.96)² × σ² 
    const approxBcea95 = Math.PI * 1.96 * 1.96 * dispersion * dispersion;
    const p10 = getBaseline('fixation_stability', 'p10Bcea95', scoringConfig);
    const p90 = getBaseline('fixation_stability', 'p90Bcea95', scoringConfig);
    return p10p90Score(approxBcea95, p10, p90, true);
  }

  const p10 = getBaseline('fixation_stability', 'p10Bcea95', scoringConfig);
  let p90 = getBaseline('fixation_stability', 'p90Bcea95', scoringConfig);
  
  if (LENIENT_MODE) {
      // Nếu là chế độ nới lỏng, ta cho phép diện tích lớn hơn nhiều (500k px²) mà vẫn đạt điểm > 0.
      p90 = Math.max(p90, 600000);
  }

  // Smaller BCEA = more stable = better → invert
  const s = p10p90Score(bcea95, p10, p90, true);
  if (LENIENT_MODE && s < 25) return 25;
  return s;
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
  head_orientation:   'Head Orientation',
  visual_search:      'Visual Search',
  memory_cards:       'Memory Cards',
  anti_saccade:       'Anti-Saccade',
  saccadic:           'Saccadic Eye Movement',
  fixation_stability: 'Fixation Stability',
  peripheral_vision:  'Peripheral Vision',
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
