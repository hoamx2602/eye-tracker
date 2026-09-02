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
import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { selectTopRuns } from './lib/topRuns';
import { DEFAULT_VIEWING_DISTANCE_CM } from '../lib/resultScoring';

const prisma = new PrismaClient();

// ── Args ─────────────────────────────────────────────────────────────────────

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const LIMIT = Math.max(1, parseInt(arg('limit', '10'), 10));
const RANK_BY: 'deg' | 'px' = arg('rank', 'deg') === 'px' ? 'px' : 'deg';
const STATUS = arg('status', 'completed'); // 'any' to include in-progress runs
const OUT_DIR = arg('out', 'outputs');
const WITH_DEMOGRAPHICS = process.argv.includes('--with-demographics');

// ── CSV ──────────────────────────────────────────────────────────────────────

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

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { examined, scored, top, byDistance, median, offlineCount, trajectoryCount } = await selectTopRuns(prisma, {
    limit: LIMIT,
    rankBy: RANK_BY,
    status: STATUS,
    withDemographics: WITH_DEMOGRAPHICS,
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    rankedBy: RANK_BY === 'px' ? 'meanErrorPx (ascending)' : 'angularErrorDeg (ascending)',
    statusFilter: STATUS,
    totals: {
      runsExamined: examined,
      runsWithCalibration: scored.length,
      exported: top.length,
      medianAngularErrorDeg: median,
      runsWithOfflineValidation: offlineCount,
      runsWithTestModeTrajectories: trajectoryCount,
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

  console.log(`Examined ${examined} runs, ${scored.length} with calibration, ${offlineCount} with offline validation.`);
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
