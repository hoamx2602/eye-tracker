/**
 * Replays the per-point residual review (lib/fixationSampling.residualOutliers)
 * on the grid dots stored in past sessions, to see how often it would ask for
 * a dot to be re-collected. Read-only.
 *
 * Stored feature vectors keep the iris offsets at indices 1..4 (lx, ly, rx, ry),
 * which is all the review needs. Duplicate grid labels (the spurious sample the
 * old timer recorded as the EXERCISES phase started) are dropped, keeping the
 * first occurrence.
 *
 * Usage:  npx tsx scripts/check-residual-review.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { median, residualOutliers, type ResidualPoint } from '../lib/fixationSampling';

const prisma = new PrismaClient();

type StoredSample = { screenX: number; screenY: number; features?: number[]; patternName?: string };

async function main() {
  const sessions = await prisma.session.findMany({ select: { id: true, calibrationGazeSamples: true } });
  for (const quadraticMinDots of [12, 9]) {
    console.log(`\n── quadratic check model from ${quadraticMinDots} dots ──`);
    review(sessions, quadraticMinDots);
  }
}

function review(sessions: { id: string; calibrationGazeSamples: unknown }[], quadraticMinDots: number) {
  const flaggedCounts: number[] = [];
  const ratioToMedian: number[] = [];
  let sessionsWithFlag = 0;
  // Dot categories under the old raster order. A row's first dot follows a
  // full-width saccade (corrective saccades likely inside the fixed window).
  const cats = ['after_row_jump', 'corner', 'edge', 'interior'] as const;
  const base: Record<string, number> = Object.fromEntries(cats.map((c) => [c, 0]));
  const hit: Record<string, number> = Object.fromEntries(cats.map((c) => [c, 0]));
  for (const s of sessions) {
    const samples = (Array.isArray(s.calibrationGazeSamples) ? s.calibrationGazeSamples : []) as StoredSample[];
    const seen = new Set<string>();
    const pts: ResidualPoint[] = [];
    for (const g of samples) {
      if (!g.patternName?.startsWith('Calibration point') || !Array.isArray(g.features)) continue;
      if (seen.has(g.patternName)) continue;
      seen.add(g.patternName);
      const f = g.features;
      pts.push({ screenX: g.screenX, screenY: g.screenY, gx: (f[1]! + f[3]!) / 2, gy: (f[2]! + f[4]!) / 2 });
    }
    if (pts.length < 6) continue;
    const { indices, residualsPx } = residualOutliers(pts, { quadraticMinDots });
    flaggedCounts.push(indices.length);

    const xs = [...new Set(pts.map((p) => Math.round(p.screenX)))].sort((a, b) => a - b);
    const ys = [...new Set(pts.map((p) => Math.round(p.screenY)))].sort((a, b) => a - b);
    pts.forEach((p, i) => {
      const col = xs.indexOf(Math.round(p.screenX));
      const row = ys.indexOf(Math.round(p.screenY));
      const xEdge = col === 0 || col === xs.length - 1;
      const yEdge = row === 0 || row === ys.length - 1;
      const cat = col === 0 && row > 0 ? 'after_row_jump' : xEdge && yEdge ? 'corner' : xEdge || yEdge ? 'edge' : 'interior';
      base[cat]!++;
      if (indices.includes(i)) hit[cat]!++;
    });
    if (indices.length) {
      sessionsWithFlag++;
      const med = median(residualsPx.filter(Number.isFinite));
      for (const i of indices) ratioToMedian.push(residualsPx[i]! / med);
    }
  }
  const n = flaggedCounts.length;
  const total = flaggedCounts.reduce((a, b) => a + b, 0);
  console.log(`sessions reviewed=${n}  with ≥1 flagged dot=${sessionsWithFlag} (${((sessionsWithFlag / n) * 100).toFixed(0)}%)`);
  console.log(`flagged dots: total=${total}, per session mean=${(total / n).toFixed(2)}, max=${Math.max(...flaggedCounts)}`);
  if (ratioToMedian.length) console.log(`flagged residual / session median residual: median=${median(ratioToMedian).toFixed(1)}×`);
  for (const c of cats) {
    console.log(`  ${c.padEnd(15)} dots=${String(base[c]).padStart(4)}  flagged=${String(hit[c]).padStart(3)}  rate=${((hit[c]! / Math.max(1, base[c]!)) * 100).toFixed(1)}%`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
