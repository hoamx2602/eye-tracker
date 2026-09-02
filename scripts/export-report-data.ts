/**
 * Dump the data the Excel report needs, including per-test gaze paths.
 *
 * Split from the xlsx builder because the database lives behind Prisma (Node)
 * while the rendering and the workbook are far easier in Python. This writes
 * the hand-off file; scripts/build_report_xlsx.py consumes it.
 *
 * Usage: npx tsx scripts/export-report-data.ts [--limit=10] [--rank=deg|px]
 *                                              [--status=completed|any] [--out=outputs]
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { selectTopRuns } from './lib/topRuns';
import { DEFAULT_VIEWING_DISTANCE_CM } from '../lib/resultScoring';

const prisma = new PrismaClient();

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const LIMIT = Math.max(1, parseInt(arg('limit', '10'), 10));
const RANK_BY: 'deg' | 'px' = arg('rank', 'deg') === 'px' ? 'px' : 'deg';
const STATUS = arg('status', 'completed');
const OUT_DIR = arg('out', 'outputs');
const WITH_DEMOGRAPHICS = process.argv.includes('--with-demographics');

async function main() {
  const { examined, scored, top, byDistance, median, offlineCount } = await selectTopRuns(prisma, {
    limit: LIMIT,
    rankBy: RANK_BY,
    status: STATUS,
    withDemographics: WITH_DEMOGRAPHICS,
    includeGazePaths: true,
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    rankedBy: RANK_BY === 'px' ? 'meanErrorPx (ascending)' : 'angularErrorDeg (ascending)',
    statusFilter: STATUS,
    totals: {
      runsExamined: examined,
      runsWithCalibration: scored.length,
      runsWithOfflineValidation: offlineCount,
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
  const out = join(OUT_DIR, 'report-data.json');
  writeFileSync(out, JSON.stringify(payload), 'utf-8');

  const paths = top.reduce((n, r) => n + r.tests.reduce((m, t) => m + (t.gazeSampleCount ?? 0), 0), 0);
  console.log(
    `Exported ${top.length} runs (${paths} gaze samples across their tests), ` +
      `${offlineCount}/${scored.length} with offline validation.`,
  );
  console.log(`Wrote ${out}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
