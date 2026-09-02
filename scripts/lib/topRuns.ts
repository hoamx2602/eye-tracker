/**
 * Shared selection and ranking of runs for the export scripts.
 *
 * Both exports rank the same way and derive the same figures from the same
 * fields. Kept in one place because two copies of a ranking is exactly how a
 * report and a screen end up disagreeing about the same run.
 */
import type { PrismaClient } from '@prisma/client';
import {
  angularErrorDeg,
  calibrationQualityShort,
  calibrationQualityLabel,
  eyeTrackingAccuracyScore,
  viewingDistanceCmFrom,
  computeAllScores,
  DOMAIN_NAMES,
} from '../../lib/resultScoring';

export function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Run `fn` with console.log muted — computeAllScores narrates to the console. */
export function quietly<T>(fn: () => T): T {
  const log = console.log;
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
  }
}

/**
 * Spread of the per-point validation errors.
 *
 * meanErrorPx alone cannot separate a run where all five dots were mediocre
 * from one where four were excellent and the fifth was thrown, and those say
 * different things about whether the mapping is usable.
 */
export function spread(errors: number[]) {
  if (errors.length === 0) return { n: 0, sdPx: null, minPx: null, maxPx: null };
  const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
  const variance = errors.reduce((a, b) => a + (b - mean) ** 2, 0) / errors.length;
  return {
    n: errors.length,
    sdPx: Math.sqrt(variance),
    minPx: Math.min(...errors),
    maxPx: Math.max(...errors),
  };
}

export type GazePoint = { t: number; x: number; y: number };

export type RunRecord = ReturnType<typeof shapeRun>;

export interface SelectOptions {
  limit: number;
  rankBy: 'deg' | 'px';
  status: string;
  withDemographics?: boolean;
  /** Include per-test gaze paths. Large — only the xlsx report needs them. */
  includeGazePaths?: boolean;
}

function shapeRun(r: RunRow, opts: SelectOptions) {
  const meanErrorPx = r.session!.meanErrorPx as number;
  const sessionCfg = asRecord(r.session!.config);
  const distanceCm = viewingDistanceCmFrom(sessionCfg);
  const deg = angularErrorDeg(meanErrorPx, distanceCm);
  const errors = (r.session!.validationErrors ?? []) as number[];
  const s = spread(errors);

  const snap = asRecord(r.configSnapshot);
  const testResults = asRecord(r.testResults) as Record<string, Record<string, unknown>>;
  const testOrder = Array.isArray(r.testOrderSnapshot) ? (r.testOrderSnapshot as string[]) : [];
  const testEnabled = asRecord(snap.testEnabled) as Record<string, boolean>;
  const scoringConfig = asRecord(asRecord(snap.testParameters)['_scoring']) as
    | Record<string, Record<string, number>>
    | undefined;

  const scores = quietly(() => computeAllScores(testResults, testOrder, testEnabled, scoringConfig));

  // The offline pipeline reports its own validation, in its own units. Where it
  // ran, it is the second opinion the report's "Offline algo Accuracy" column
  // asks for; where it did not, saying so is the honest answer.
  const offlineGaze = asRecord(sessionCfg.offlineGaze);
  const offlineReport = asRecord(offlineGaze.report);
  const offlineValidation = asRecord(offlineReport.validation);

  return {
    runId: r.id,
    sessionId: r.sessionId,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    hasVideo: Boolean(r.session!.videoUrl),
    videoUrl: r.session!.videoUrl ?? null,

    accuracy: {
      meanErrorPx,
      angularErrorDeg: deg,
      quality: calibrationQualityShort(deg),
      qualityLabel: calibrationQualityLabel(deg),
      accuracyScore: eyeTrackingAccuracyScore(deg),
      validationPoints: s.n,
      sdPx: s.sdPx,
      minPx: s.minPx,
      maxPx: s.maxPx,
      perPointPx: errors,
      perPointDeg: errors.map((e) => angularErrorDeg(e, distanceCm)),
    },

    offline: {
      status: (offlineGaze.status as string) ?? 'absent',
      overallDeg: num(offlineValidation.overall_deg),
      overallPx: num(offlineValidation.overall_px),
      nPoints: num(offlineValidation.n_points),
      calibrationLoocvPx: num(offlineReport.calibration_loocv_px),
      calibrationTrainRmsePx: num(offlineReport.calibration_train_rmse_px),
      headCompensationApplied: offlineReport.head_compensation_applied ?? null,
    },

    distance: {
      configuredCm: distanceCm,
      // Nothing in this build measures the distance. The number above is
      // whatever the operator set on the slider; the head-position gate only
      // checks that the face fills roughly the expected fraction of frame,
      // which admits about -17%/+27% at the default tolerance.
      measured: false,
      source: num(sessionCfg.faceDistance) != null ? 'session config' : 'default',
      faceWidthScale: num(sessionCfg.faceWidthScale),
      headDistanceTolerance: num(sessionCfg.headDistanceTolerance),
      // Also nominal: a CSS pixel is 1/96 inch only on a 96 DPI display.
      cmPerCssPxAssumed: 2.54 / 96,
    },

    calibration: {
      regressionMethod: sessionCfg.regressionMethod ?? null,
      calibrationMethod: sessionCfg.calibrationMethod ?? null,
      calibrationPointsCount: num(sessionCfg.calibrationPointsCount),
      calibrationSpeed: sessionCfg.calibrationSpeed ?? null,
      clickDuration: num(sessionCfg.clickDuration),
      outlierMethod: sessionCfg.outlierMethod ?? null,
      outlierThreshold: num(sessionCfg.outlierThreshold),
      enableExercises: sessionCfg.enableExercises ?? null,
      glassesOptimization: sessionCfg.glassesOptimization ?? null,
      features: {
        useEAR: sessionCfg.useEAR ?? null,
        useBlendshapes: sessionCfg.useBlendshapes ?? null,
        useTransformationMatrix: sessionCfg.useTransformationMatrix ?? null,
        useSymmetricFeatures: sessionCfg.useSymmetricFeatures ?? null,
      },
    },

    tests: scores.map((sc) => {
      const raw = asRecord(testResults[sc.testId]);
      const gazePath = Array.isArray(raw.gazePath) ? (raw.gazePath as GazePoint[]) : [];
      return {
        testId: sc.testId,
        domainName: sc.domainName ?? DOMAIN_NAMES[sc.testId] ?? sc.testId,
        enabled: testEnabled[sc.testId] ?? null,
        score: sc.score,
        observation: sc.observation,
        metrics: asRecord(raw.metrics),
        viewportWidth: num(raw.viewportWidth),
        viewportHeight: num(raw.viewportHeight),
        durationMs: num(raw.durationMs),
        gazeSampleCount: gazePath.length,
        ...(opts.includeGazePaths ? { gazePath } : {}),
        ...(opts.includeGazePaths ? {} : { raw: testResults[sc.testId] ?? null }),
      };
    }),

    ...(opts.withDemographics ? { demographics: r.session!.demographics ?? null } : {}),
  };
}

type RunRow = {
  id: string;
  sessionId: string;
  status: string | null;
  createdAt: Date;
  configSnapshot: unknown;
  testOrderSnapshot: unknown;
  testResults: unknown;
  session: {
    meanErrorPx: number | null;
    validationErrors: number[];
    config: unknown;
    demographics: unknown;
    videoUrl: string | null;
  } | null;
};

export async function selectTopRuns(prisma: PrismaClient, opts: SelectOptions) {
  const runs = (await prisma.neurologicalRun.findMany({
    where: opts.status === 'any' ? {} : { status: opts.status },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      sessionId: true,
      status: true,
      createdAt: true,
      configSnapshot: true,
      testOrderSnapshot: true,
      testResults: true,
      session: {
        select: {
          meanErrorPx: true,
          validationErrors: true,
          config: true,
          demographics: true,
          videoUrl: true,
        },
      },
    },
  })) as RunRow[];

  const scored = runs.filter((r) => r.session?.meanErrorPx != null).map((r) => shapeRun(r, opts));

  scored.sort((a, b) =>
    opts.rankBy === 'px'
      ? a.accuracy.meanErrorPx - b.accuracy.meanErrorPx
      : a.accuracy.angularErrorDeg - b.accuracy.angularErrorDeg,
  );

  const top = scored.slice(0, opts.limit).map((r, i) => ({ rank: i + 1, ...r }));

  const byDistance: Record<string, number> = {};
  for (const r of scored) {
    const k = `${r.distance.configuredCm}cm`;
    byDistance[k] = (byDistance[k] ?? 0) + 1;
  }
  const degs = scored.map((r) => r.accuracy.angularErrorDeg).sort((a, b) => a - b);
  const median = degs.length ? degs[Math.floor(degs.length / 2)] : null;
  const offlineCount = scored.filter((r) => r.offline.overallDeg != null).length;

  return { examined: runs.length, scored, top, byDistance, median, offlineCount };
}
