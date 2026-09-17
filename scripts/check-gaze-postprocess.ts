/**
 * Checks for the gaze post-processing (lib/smoothing.ts, lib/gazePostprocess.ts).
 *
 *  1. Replays the chart preparation on every stored Test-mode trajectory
 *     (read-only): how much is dropped, and what the remaining trace looks like.
 *  2. Synthetic: outliers must be removed (left as gaps, not replaced), a
 *     saccade-like step must survive, and the live gates must drop partial
 *     blinks and implausible samples while releasing a lasting squint.
 *
 * Usage:  npx tsx scripts/check-gaze-postprocess.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { smoothSegment, type ChartSegment, type ChartSmoothingConfig } from '../lib/smoothing';
import { PartialBlinkGate, isPlausibleGaze } from '../lib/gazePostprocess';

const prisma = new PrismaClient();
let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
};
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2; };
const pct = (a: number[], q: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(q * a.length))]!;
const isNum = (v: number | null): v is number => typeof v === 'number' && Number.isFinite(v);

/** Metrics over the samples that survive; a step is only counted between neighbours that both survive. */
function metrics(segs: ChartSegment[], cfg?: ChartSmoothingConfig) {
  const steps: number[] = []; const err: number[] = [];
  let spikes = 0, nSp = 0, big = 0, kept = 0, total = 0, thereAndBack = 0;
  for (const raw of segs) {
    const p = smoothSegment(raw, cfg).points;
    total += p.length;
    kept += p.filter((q) => isNum(q.gazeX) && isNum(q.gazeY)).length;
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1]!, b = p[i]!;
      if (!isNum(a.gazeX) || !isNum(a.gazeY) || !isNum(b.gazeX) || !isNum(b.gazeY)) continue;
      const d = Math.hypot(b.gazeX - a.gazeX, b.gazeY - a.gazeY);
      steps.push(d);
      if (d > 10) big++;
    }
    for (let i = 1; i < p.length - 1; i++) {
      const a = p[i - 1]!, b = p[i]!, c = p[i + 1]!;
      if (![a, b, c].every((q) => isNum(q.gazeX) && isNum(q.gazeY))) continue;
      nSp++;
      const dev = Math.hypot(b.gazeX! - med([a.gazeX!, b.gazeX!, c.gazeX!]), b.gazeY! - med([a.gazeY!, b.gazeY!, c.gazeY!]));
      if (dev > 5) {
        spikes++;
        // Neighbours agreeing = the sample went out and came back: a spike.
        // Neighbours far apart = the eye was mid-movement, and the sample is real.
        if (Math.hypot(c.gazeX! - a.gazeX!, c.gazeY! - a.gazeY!) < 3) thereAndBack++;
      }
    }
    for (const q of p) if (isNum(q.gazeX) && isNum(q.gazeY)) err.push(Math.hypot(q.gazeX - q.targetX, q.gazeY - q.targetY));
  }
  return {
    dropped: 1 - kept / total, spikes: spikes / Math.max(1, nSp), thereAndBack, big: big / Math.max(1, steps.length),
    p99: pct(steps, 0.99), max: Math.max(...steps), err: med(err),
  };
}

async function main() {
  // ── 1. Stored trajectories ──
  const runs = await prisma.testRun.findMany({ select: { trajectories: true } });
  const segs = runs.flatMap((r) => (Array.isArray(r.trajectories) ? r.trajectories : []) as ChartSegment[]).filter((s) => s.points?.length >= 10);
  const rows = {
    'NONE (raw)': metrics(segs, { method: 'NONE', window: 0 }),
    'REMOVE_OUTLIERS': metrics(segs, { method: 'REMOVE_OUTLIERS', window: 0 }),
    'MOVING_AVERAGE 6 (saved config)': metrics(segs, { method: 'MOVING_AVERAGE', window: 6 }),
  };
  console.log(`stored Test-mode segments: ${segs.length} (units: % of viewport)`);
  console.table(Object.fromEntries(Object.entries(rows).map(([k, m]) => [k, {
    'samples dropped': `${(m.dropped * 100).toFixed(2)}%`, '1-sample spikes >5%': `${(m.spikes * 100).toFixed(2)}%`,
    'steps >10%': `${(m.big * 100).toFixed(2)}%`, 'p99 step': m.p99.toFixed(1), 'max step': m.max.toFixed(0),
    'median |gaze−target|': m.err.toFixed(1),
  }])));
  const raw = rows['NONE (raw)'], out = rows.REMOVE_OUTLIERS, ma = rows['MOVING_AVERAGE 6 (saved config)'];
  check('NONE keeps every sample', raw.dropped === 0);
  check('removal drops the outliers and nothing like the whole trace', out.dropped > 0 && out.dropped < 0.2, `${(out.dropped * 100).toFixed(2)}% dropped`);
  // What must go is the there-and-back spike. The >5% excursions that remain all
  // sit between neighbours far apart (median 16.8% of the viewport), i.e. the eye
  // was mid-movement — removing those would delete real saccades, not noise.
  check('every there-and-back spike is gone', out.thereAndBack === 0, `${raw.thereAndBack} → ${out.thereAndBack}`);
  check('1-sample excursions down by ≥ 80%', out.spikes <= 0.2 * raw.spikes, `${(raw.spikes * 100).toFixed(2)}% → ${(out.spikes * 100).toFixed(2)}%`);
  check('nothing off-screen survives (max step ≤ 150%)', out.max <= 150, `max ${raw.max.toFixed(0)} → ${out.max.toFixed(0)}`);
  check('the saved MOVING_AVERAGE setting also gets the removal', ma.dropped > 0 && ma.max <= 150, `${(ma.dropped * 100).toFixed(2)}% dropped, max ${ma.max.toFixed(0)}`);

  // ── 2. Synthetic ──
  const t = Array.from({ length: 60 }, (_, i) => i / 15);
  const step: ChartSegment = { patternName: 'step', points: t.map((ti, i) => ({
    t: ti, targetX: i < 30 ? 30 : 60, targetY: 50,
    gazeX: (i < 30 ? 30 : 60) + (i === 12 ? 25 : 0) + (i === 45 ? -25 : 0), gazeY: 50 + (i === 20 ? 400 : 0),
  })) };
  const f = smoothSegment(step, { method: 'REMOVE_OUTLIERS', window: 0 }).points;
  check('saccade-like step survives, sharp', f[29]!.gazeX === 30 && f[30]!.gazeX === 60, `x[29]=${f[29]!.gazeX} x[30]=${f[30]!.gazeX}`);
  check('spikes removed, not replaced', f[12]!.gazeX === null && f[45]!.gazeX === null);
  check('off-screen sample removed on both axes', f[20]!.gazeX === null && f[20]!.gazeY === null);
  check('samples next to an outlier are untouched', f[11]!.gazeX === 30 && f[13]!.gazeX === 30 && f[19]!.gazeY === 50);

  const gate = new PartialBlinkGate();
  const open = { leftEAR: 0.3, rightEAR: 0.3 };
  let hits = 0;
  for (let k = 0; k < 30; k++) gate.isPartialBlink(open, k * 33);
  for (let k = 30; k < 34; k++) if (gate.isPartialBlink({ leftEAR: 0.17, rightEAR: 0.3 }, k * 33)) hits++;
  check('partial blink dropped', hits === 4, `${hits}/4 frames`);
  let releasedAt = -1;
  for (let k = 40; k < 100; k++) { if (!gate.isPartialBlink({ leftEAR: 0.18, rightEAR: 0.18 }, k * 33) && releasedAt < 0) releasedAt = (k - 40) * 33; }
  check('lasting narrowing becomes the new normal within 600 ms', releasedAt >= 0 && releasedAt <= 600, `released after ${releasedAt} ms`);
  check('plausibility: on screen kept, far off screen dropped',
    isPlausibleGaze(-100, 500, 1512, 949) && isPlausibleGaze(1800, 1100, 1512, 949) && !isPlausibleGaze(3000, 500, 1512, 949) && !isPlausibleGaze(700, -400, 1512, 949));

  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
}

main()
  .catch((e) => { console.error(e); failures++; })
  .finally(async () => { await prisma.$disconnect(); process.exit(failures ? 1 : 0); });
