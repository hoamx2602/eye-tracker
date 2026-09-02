/**
 * Export the most accurate runs in the system, with the configuration that
 * produced them.
 *
 * Ranked by ANGULAR error, not pixel error. Pixels are not comparable across
 * runs: the same 40 px is 1.01° at 60 cm and 2.02° at 30 cm, so a pixel ranking
 * quietly rewards whoever sat closest to the screen. `--rank=px` is available
 * for comparison, and the export carries both numbers either way.
 *
 * Usage:
 *   npx tsx scripts/export-top-accuracy.ts
 *   npx tsx scripts/export-top-accuracy.ts --limit=25 --rank=px --status=any
 *   npx tsx scripts/export-top-accuracy.ts --with-demographics
 *
 * Writes <out>/top-accuracy-<stamp>.json, .csv, and -per-test.csv.
 */
import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  angularErrorDeg,
  calibrationQualityShort,
  calibrationQualityLabel,
  eyeTrackingAccuracyScore,
  viewingDistanceCmFrom,
  computeAllScores,
  DOMAIN_NAMES,
  DEFAULT_VIEWING_DISTANCE_CM,
} from '../lib/resultScoring';

const prisma = new PrismaClient();

// ── Args ─────────────────────────────────────────────────────────────────────

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const LIMIT = Math.max(1, parseInt(arg('limit', '10'), 10));
const RANK_BY = arg('rank', 'deg') === 'px' ? 'px' : 'deg';
const STATUS = arg('status', 'completed'); // 'any' to include in-progress runs
const OUT_DIR = arg('out', 'outputs');
const WITH_DEMOGRAPHICS = process.argv.includes('--with-demographics');

// ── Helpers ──────────────────────────────────────────────────────────────────

type Json = Prisma.JsonValue;

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Spread of the per-point validation errors.
 *
 * meanErrorPx alone cannot tell a run where all five dots were mediocre from
 * one where four were excellent and the fifth was thrown — which matters,
 * because those two say different things about whether the mapping is usable.
 */
function spread(errors: number[]) {
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

function csvCell(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const cols = Object.keys(rows[0]);
  return [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n');
}

/** Run `fn` with console.log muted. */
function quietly<T>(fn: () => T): T {
  const log = console.log;
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const runs = await prisma.neurologicalRun.findMany({
    where: STATUS === 'any' ? {} : { status: STATUS },
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
  });

  const scored = runs
    .filter((r) => r.session?.meanErrorPx != null)
    .map((r) => {
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

      // computeAllScores narrates its per-metric reasoning to the console for
      // the browser devtools. Forty-four runs of that buries the report.
      const scores = quietly(() => computeAllScores(testResults, testOrder, testEnabled, scoringConfig));

      return {
        runId: r.id,
        sessionId: r.sessionId,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        hasVideo: Boolean(r.session!.videoUrl),

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

        distance: {
          configuredCm: distanceCm,
          // Nothing in this build measures the distance. The number above is
          // whatever the operator set on the slider; the head-position gate
          // only checks that the face fills roughly the expected fraction of
          // frame, which admits roughly -17%/+27% at the default tolerance.
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

        tests: scores.map((sc) => ({
          testId: sc.testId,
          domainName: sc.domainName ?? DOMAIN_NAMES[sc.testId] ?? sc.testId,
          enabled: testEnabled[sc.testId] ?? null,
          score: sc.score,
          observation: sc.observation,
          metrics: asRecord(asRecord(testResults[sc.testId]).metrics),
          raw: testResults[sc.testId] ?? null,
        })),

        ...(WITH_DEMOGRAPHICS ? { demographics: (r.session!.demographics ?? null) as Json } : {}),
      };
    });

  scored.sort((a, b) =>
    RANK_BY === 'px'
      ? a.accuracy.meanErrorPx - b.accuracy.meanErrorPx
      : a.accuracy.angularErrorDeg - b.accuracy.angularErrorDeg,
  );

  const top = scored.slice(0, LIMIT).map((r, i) => ({ rank: i + 1, ...r }));

  // Distribution of configured distances, so a reader can see at a glance
  // whether the ranking is really a ranking of who sat closest.
  const byDistance: Record<string, number> = {};
  for (const r of scored) byDistance[`${r.distance.configuredCm}cm`] = (byDistance[`${r.distance.configuredCm}cm`] ?? 0) + 1;

  const degs = scored.map((r) => r.accuracy.angularErrorDeg).sort((a, b) => a - b);
  const median = degs.length ? degs[Math.floor(degs.length / 2)] : null;

  const payload = {
    generatedAt: new Date().toISOString(),
    rankedBy: RANK_BY === 'px' ? 'meanErrorPx (ascending)' : 'angularErrorDeg (ascending)',
    statusFilter: STATUS,
    totals: {
      runsExamined: runs.length,
      runsWithCalibration: scored.length,
      exported: top.length,
      medianAngularErrorDeg: median,
      configuredDistanceCounts: byDistance,
    },
    caveats: [
      'Viewing distance is configured, never measured — see distance.measured.',
      'cm per CSS pixel is assumed at 1/96 inch; on a HiDPI display this overstates the angle by roughly a third.',
      'meanErrorPx is the mean over 5 held-out validation dots, measured immediately after calibration — an optimistic bound on accuracy during the tests that follow.',
      `Default distance applied when a session recorded none: ${DEFAULT_VIEWING_DISTANCE_CM} cm.`,
    ],
    runs: top,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const base = join(OUT_DIR, `top-accuracy-${stamp}`);

  writeFileSync(`${base}.json`, JSON.stringify(payload, null, 2), 'utf-8');

  writeFileSync(
    `${base}.csv`,
    toCsv(
      top.map((r) => ({
        rank: r.rank,
        runId: r.runId,
        sessionId: r.sessionId,
        createdAt: r.createdAt,
        status: r.status,
        meanErrorPx: r.accuracy.meanErrorPx.toFixed(2),
        angularErrorDeg: r.accuracy.angularErrorDeg.toFixed(3),
        quality: r.accuracy.quality,
        accuracyScore: r.accuracy.accuracyScore,
        validationPoints: r.accuracy.validationPoints,
        sdPx: r.accuracy.sdPx?.toFixed(2) ?? '',
        minPx: r.accuracy.minPx?.toFixed(2) ?? '',
        maxPx: r.accuracy.maxPx?.toFixed(2) ?? '',
        distanceCm: r.distance.configuredCm,
        distanceMeasured: r.distance.measured,
        distanceSource: r.distance.source,
        faceWidthScale: r.distance.faceWidthScale ?? '',
        headDistanceTolerance: r.distance.headDistanceTolerance ?? '',
        regressionMethod: r.calibration.regressionMethod ?? '',
        calibrationPointsCount: r.calibration.calibrationPointsCount ?? '',
        outlierMethod: r.calibration.outlierMethod ?? '',
        outlierThreshold: r.calibration.outlierThreshold ?? '',
        enableExercises: r.calibration.enableExercises ?? '',
        testsScored: r.tests.filter((t) => t.score != null).length,
      })),
    ),
    'utf-8',
  );

  writeFileSync(
    `${base}-per-test.csv`,
    toCsv(
      top.flatMap((r) =>
        r.tests.map((t) => ({
          rank: r.rank,
          runId: r.runId,
          angularErrorDeg: r.accuracy.angularErrorDeg.toFixed(3),
          distanceCm: r.distance.configuredCm,
          testId: t.testId,
          domainName: t.domainName,
          enabled: t.enabled ?? '',
          score: t.score ?? '',
          observation: t.observation,
          metrics: JSON.stringify(t.metrics),
        })),
      ),
    ),
    'utf-8',
  );

  console.log(`Examined ${runs.length} runs, ${scored.length} with calibration.`);
  console.log(`Median angular error: ${median != null ? median.toFixed(2) + '°' : '—'}`);
  console.log(`Configured distances: ${JSON.stringify(byDistance)}`);
  console.log(`\nTop ${top.length} by ${RANK_BY === 'px' ? 'pixel' : 'angular'} error:`);
  for (const r of top) {
    console.log(
      `  ${String(r.rank).padStart(2)}. ${r.accuracy.angularErrorDeg.toFixed(2)}° ` +
        `(${r.accuracy.meanErrorPx.toFixed(1)} px @ ${r.distance.configuredCm}cm) ` +
        `${r.accuracy.quality.padEnd(9)} ${r.runId.slice(0, 10)}… ${r.createdAt.slice(0, 10)}`,
    );
  }
  console.log(`\nWrote:\n  ${base}.json\n  ${base}.csv\n  ${base}-per-test.csv`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
