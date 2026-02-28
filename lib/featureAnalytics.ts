/**
 * Names for the 18-dim feature vector from eyeTrackingService.prepareFeatureVector.
 * Used by admin dashboard to label feature analytics.
 */
export const FEATURE_DIMENSION_NAMES = [
  'bias',
  'leftEyeX',
  'leftEyeY',
  'rightEyeX',
  'rightEyeY',
  'leftR',
  'leftTheta',
  'rightR',
  'rightTheta',
  'headPitch',
  'headYaw',
  'headRoll',
  'leftEyeX×yaw',
  'rightEyeX×yaw',
  'leftEyeY×pitch',
  'rightEyeY×pitch',
  'leftEyeX²',
  'leftEyeY²',
] as const;

export type FeatureDimensionStats = {
  index: number;
  name: string;
  mean: number;
  std: number;
  min: number;
  max: number;
  count: number;
};

export type ValidationErrorBucket = { range: string; count: number; from: number; to: number };

export type FeatureAnalytics = {
  dimensionStats: FeatureDimensionStats[];
  validationErrorBuckets: ValidationErrorBucket[];
  sessionMeanErrorList: number[];
  totalSamples: number;
  sessionsWithFeatures: number;
};

const VALIDATION_BUCKETS = [
  { from: 0, to: 2, range: '0–2 px' },
  { from: 2, to: 5, range: '2–5 px' },
  { from: 5, to: 10, range: '5–10 px' },
  { from: 10, to: 20, range: '10–20 px' },
  { from: 20, to: Infinity, range: '20+ px' },
];

export function computeFeatureAnalytics(
  sessions: {
    calibrationGazeSamples: unknown;
    validationErrors: number[];
    meanErrorPx: number | null;
  }[]
): FeatureAnalytics {
  const allFeatures: number[][] = [];
  const allValidationErrors: number[] = [];
  const sessionMeanErrors: number[] = [];
  const dimCount = FEATURE_DIMENSION_NAMES.length;

  for (const s of sessions) {
    if (s.meanErrorPx != null) sessionMeanErrors.push(s.meanErrorPx);
    const errs = Array.isArray(s.validationErrors) ? s.validationErrors : [];
    allValidationErrors.push(...errs);
    const samples = s.calibrationGazeSamples;
    if (!Array.isArray(samples)) continue;
    for (const sample of samples) {
      const f = (sample as { features?: number[] }).features;
      if (Array.isArray(f) && f.length >= dimCount) allFeatures.push(f.slice(0, dimCount));
    }
  }

  const dimensionStats: FeatureDimensionStats[] = [];
  for (let i = 0; i < dimCount; i++) {
    const values = allFeatures.map((row) => row[i]).filter((v) => typeof v === 'number');
    const n = values.length;
    const mean = n ? values.reduce((a, b) => a + b, 0) / n : 0;
    const variance =
      n > 1 ? values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1) : 0;
    const std = Math.sqrt(variance);
    dimensionStats.push({
      index: i,
      name: FEATURE_DIMENSION_NAMES[i],
      mean,
      std,
      min: n ? Math.min(...values) : 0,
      max: n ? Math.max(...values) : 0,
      count: n,
    });
  }

  const validationErrorBuckets: ValidationErrorBucket[] = VALIDATION_BUCKETS.map(
    ({ from, to, range }) => ({
      range,
      from,
      to,
      count: allValidationErrors.filter((e) => e >= from && e < to).length,
    })
  );

  return {
    dimensionStats,
    validationErrorBuckets,
    sessionMeanErrorList: sessionMeanErrors,
    totalSamples: allFeatures.length,
    sessionsWithFeatures: sessions.filter((s) => {
      const samples = s.calibrationGazeSamples;
      return Array.isArray(samples) && samples.some((x: unknown) => Array.isArray((x as { features?: number[] }).features));
    }).length,
  };
}
