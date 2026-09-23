/**
 * Replays the gaze mapping on every stored session: train on that session's own
 * calibration grid + exercise samples, predict its held-out validation dots, and
 * compare the error against what the app scored at the time.
 *
 * Paired per session — the same dots through both paths — because comparing
 * medians of two populations hid a reversal once already: a model that looked
 * 9% better on its own was worse on 58% of sessions head to head.
 *
 * Usage:  npx tsx scripts/check-gaze-mapping.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { HybridRegressor } from '../services/mathUtils';
import { RegressionMethod } from '../types';

const prisma = new PrismaClient();
type Stored = { screenX?: number; screenY?: number; features?: number[]; patternName?: string };

const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2) : NaN; };
let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
};

function errorOf(train: Stored[], val: Stored[], method: RegressionMethod): number | null {
  const r = new HybridRegressor();
  if (!r.train(train.map((d) => d.features!), train.map((d) => [d.screenX!, d.screenY!]))) return null;
  const errs = val.map((d) => {
    const p = r.predict(d.features!, method);
    return Math.hypot(p.x - d.screenX!, p.y - d.screenY!);
  });
  return errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : null;
}

async function main() {
  const ids = (await prisma.session.findMany({ select: { id: true }, orderBy: { createdAt: 'desc' } })).map((s) => s.id);
  const rows: { id: string; nTrain: number; stored: number | null; ridge: number; tps: number }[] = [];
  for (let i = 0; i < ids.length; i += 10) {
    const batch = await prisma.session.findMany({ where: { id: { in: ids.slice(i, i + 10) } }, select: { id: true, calibrationGazeSamples: true, validationErrors: true } });
    for (const s of batch) {
      const samples = (Array.isArray(s.calibrationGazeSamples) ? s.calibrationGazeSamples : []) as Stored[];
      const seen = new Set<string>();
      const train: Stored[] = []; const val: Stored[] = [];
      for (const d of samples) {
        if (!Array.isArray(d.features) || d.screenX == null) continue;
        const name = d.patternName ?? '';
        if (name.startsWith('Validation point')) { val.push(d); continue; }
        if (name.startsWith('Calibration point')) { if (seen.has(name)) continue; seen.add(name); }
        train.push(d);
      }
      const dims = new Set([...train, ...val].map((d) => d.features!.length));
      if (train.length < 8 || val.length < 4 || dims.size !== 1) continue;
      const ridge = errorOf(train, val, RegressionMethod.RIDGE);
      const tps = errorOf(train, val, RegressionMethod.TPS);
      if (ridge == null || tps == null || !Number.isFinite(ridge) || !Number.isFinite(tps)) continue;
      const stored = s.validationErrors?.length ? s.validationErrors.reduce((a, b) => a + b, 0) / s.validationErrors.length : null;
      rows.push({ id: s.id, nTrain: train.length, stored, ridge, tps });
    }
  }

  const ridge = rows.map((r) => r.ridge), tps = rows.map((r) => r.tps);
  const stored = rows.filter((r) => r.stored != null);
  console.log(`sessions replayed: ${rows.length} (median ${med(rows.map((r) => r.nTrain))} training samples)\n`);
  console.log(`  ridge  : median ${med(ridge).toFixed(1)} px`);
  console.log(`  TPS    : median ${med(tps).toFixed(1)} px`);
  const vsTps = rows.map((r) => r.ridge - r.tps);
  console.log(`  ridge − TPS, paired: median ${med(vsTps).toFixed(1)} px, ridge wins ${(100 * vsTps.filter((d) => d < 0).length / vsTps.length).toFixed(0)}%`);
  if (stored.length) {
    const d = stored.map((r) => r.ridge - r.stored!);
    console.log(`  ridge − what the app scored then: median ${med(d).toFixed(1)} px over ${stored.length} sessions`);
  }

  check('ridge trains on every replayed session', rows.length > 50, `${rows.length} sessions`);
  check('ridge is at least as good as TPS', med(vsTps) <= 0, `paired median ${med(vsTps).toFixed(1)} px`);
  check('median validation error under 135 px', med(ridge) < 135, `${med(ridge).toFixed(1)} px`);
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
}

main()
  .catch((e) => { console.error(e); failures++; })
  .finally(async () => { await prisma.$disconnect(); process.exit(failures ? 1 : 0); });
