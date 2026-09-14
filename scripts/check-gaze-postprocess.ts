/**
 * Checks for the gaze post-processing (lib/smoothing.ts ROBUST, lib/gazePostprocess.ts).
 *
 *  1. Replays the chart filters on every stored Test-mode trajectory (read-only):
 *     spike rate, large steps, worst step, gaze–target distance.
 *  2. Synthetic: a saccade-like step must stay sharp; the live gates must drop
 *     partial blinks and implausible samples, and release a lasting squint.
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

function metrics(segs: ChartSegment[], cfg?: ChartSmoothingConfig) {
  const steps: number[] = []; const err: number[] = []; let spikes = 0, nSp = 0, big = 0;
  for (const raw of segs) {
    const p = smoothSegment(raw, cfg).points;
    for (let i = 1; i < p.length; i++) { const d = Math.hypot(p[i]!.gazeX - p[i - 1]!.gazeX, p[i]!.gazeY - p[i - 1]!.gazeY); steps.push(d); if (d > 10) big++; }
    for (let i = 1; i < p.length - 1; i++) {
      const s = Math.hypot(p[i]!.gazeX - med([p[i - 1]!.gazeX, p[i]!.gazeX, p[i + 1]!.gazeX]), p[i]!.gazeY - med([p[i - 1]!.gazeY, p[i]!.gazeY, p[i + 1]!.gazeY]));
      nSp++; if (s > 5) spikes++;
    }
    for (const q of p) err.push(Math.hypot(q.gazeX - q.targetX, q.gazeY - q.targetY));
  }
  return { spikes: spikes / nSp, big: big / steps.length, p99: pct(steps, 0.99), max: Math.max(...steps), err: med(err) };
}

async function main() {
  // ── 1. Stored trajectories ──
  const runs = await prisma.testRun.findMany({ select: { trajectories: true } });
  const segs = runs.flatMap((r) => (Array.isArray(r.trajectories) ? r.trajectories : []) as ChartSegment[]).filter((s) => s.points?.length >= 10);
  const rows = {
    raw: metrics(segs),
    'MOVING_AVERAGE 6 (saved config)': metrics(segs, { method: 'MOVING_AVERAGE', window: 6 }),
    'ROBUST 5': metrics(segs, { method: 'ROBUST', window: 5 }),
  };
  console.log(`stored Test-mode segments: ${segs.length} (units: % of viewport)`);
  console.table(Object.fromEntries(Object.entries(rows).map(([k, m]) => [k, {
    '1-sample spikes >5%': `${(m.spikes * 100).toFixed(2)}%`, 'steps >10%': `${(m.big * 100).toFixed(2)}%`,
    'p99 step': m.p99.toFixed(1), 'max step': m.max.toFixed(0), 'median |gaze−target|': m.err.toFixed(1),
  }])));
  const r = rows['ROBUST 5'], raw = rows.raw;
  check('ROBUST removes ≥ 90% of 1-sample spikes', r.spikes <= 0.1 * raw.spikes, `${(raw.spikes * 100).toFixed(2)}% → ${(r.spikes * 100).toFixed(2)}%`);
  check('ROBUST keeps every step on screen (max step ≤ 150%)', r.max <= 150, `max ${raw.max.toFixed(0)} → ${r.max.toFixed(0)}`);
  check('ROBUST does not move gaze away from target', r.err <= raw.err + 0.5, `${raw.err.toFixed(1)} → ${r.err.toFixed(1)}`);

  // ── 2. Synthetic ──
  const t = Array.from({ length: 60 }, (_, i) => i / 15);
  const step: ChartSegment = { patternName: 'step', points: t.map((ti, i) => ({
    t: ti, targetX: i < 30 ? 30 : 60, targetY: 50,
    gazeX: (i < 30 ? 30 : 60) + (i === 12 ? 25 : 0) + (i === 45 ? -25 : 0), gazeY: 50 + (i === 20 ? 400 : 0),
  })) };
  const f = smoothSegment(step, { method: 'ROBUST', window: 5 }).points;
  check('saccade-like step stays sharp (no lag, no ramp)', f[29]!.gazeX < 35 && f[30]!.gazeX > 55, `x[29]=${f[29]!.gazeX.toFixed(1)} x[30]=${f[30]!.gazeX.toFixed(1)}`);
  check('single spikes removed', Math.abs(f[12]!.gazeX - 30) < 1 && Math.abs(f[45]!.gazeX - 60) < 1);
  check('off-screen sample held', Math.abs(f[20]!.gazeY - 50) < 1, `y[20]=${f[20]!.gazeY.toFixed(1)}`);

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
