/**
 * Synthetic checks for lib/fixationSampling.ts — no camera, no browser.
 *
 * Each scenario scripts the eye the way it behaves around a calibration dot
 * (latency, undershooting saccade + corrective saccade, fixation noise, glare
 * spike, a blink with the lid dropping before EAR crosses the threshold) and
 * asserts that the sampler keeps only the settled fixation.
 *
 * Usage:  npx tsx scripts/check-fixation-sampling.ts
 */
import type { EyeFeatures } from '../types';
import {
  FixationCollector,
  FixationNoiseModel,
  buildExerciseSamples,
  residualOutliers,
  timerFixationOptions,
  type ExerciseFrame,
} from '../lib/fixationSampling';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!cond) failures++;
}

// Deterministic PRNG + Gaussian.
let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

const NOISE = 0.02; // per-eye iris-offset noise (≈0.4°)
function feat(gx: number, gy: number, opts: { ear?: number; yaw?: number } = {}): EyeFeatures {
  const ear = opts.ear ?? 0.28;
  const eye = () => ({ x: gx + NOISE * gauss(), y: gy + NOISE * gauss() });
  const pose = { pitch: 0.01 * gauss() * 0.3, yaw: (opts.yaw ?? 0) + 0.003 * gauss(), roll: 0 };
  return {
    leftPupil: { x: 0, y: 0 }, rightPupil: { x: 0, y: 0 },
    leftEyeCenter: { x: 0, y: 0 }, rightEyeCenter: { x: 0, y: 0 },
    leftRelative: eye(), rightRelative: eye(),
    headPose: { pitch: 0, yaw: 0, roll: 0 },
    zDistance: 3, leftEAR: ear, rightEAR: ear,
    matrixHeadPose: pose,
  };
}
const FRAME_MS = 33;

// ── 1. Settling, glare and blink around one dot ──────────────────────────────
{
  const G = { x: 1.0, y: -1.2 };           // true fixation of the new dot
  const P = { x: 0.2, y: -0.8 };           // previous dot
  const U = { x: 0.2 + 0.9 * 0.8, y: -0.8 + 0.9 * -0.4 }; // 10% undershoot
  const gazeAt = (t: number) => (t < 250 ? P : t < 480 ? U : G);
  const noise = new FixationNoiseModel();
  const opts = timerFixationOptions(1);
  const col = new FixationCollector(0, opts, noise);
  const blinkFrom = 1200, blinkTo = 1350;
  let done: ReturnType<FixationCollector['finalize']> = null;
  let doneAt = -1;
  const allFrames: { t: number; g: { x: number; y: number } }[] = [];
  for (let t = 0; t <= opts.maxMs; t += FRAME_MS) {
    if (t >= blinkFrom && t <= blinkTo) {
      col.addBlink(t);
    } else {
      let g = gazeAt(t);
      if (t >= blinkFrom - 60 && t < blinkFrom) g = { x: g.x, y: g.y + 0.15 }; // lid already descending
      if (t > blinkTo && t <= blinkTo + 70) g = { x: g.x, y: g.y + 0.1 };      // recovering
      const spike = Math.abs(t - 900) < FRAME_MS / 2 ? 0.5 : 0;              // glasses glare
      col.addFrame(t, feat(g.x + spike, g.y));
      allFrames.push({ t, g: { x: g.x + spike, y: g.y } });
    }
    if (t % 50 < FRAME_MS && col.evaluate(t).complete) { done = col.finalize(t); doneAt = t; break; }
  }
  if (!done) { done = col.finalize(opts.maxMs); doneAt = opts.maxMs; }
  check('dot completes with a stable run', !!done && done.ok, `finished at ${doneAt} ms`);
  if (done) {
    const cx = (done.center.leftRelative.x + done.center.rightRelative.x) / 2;
    const cy = (done.center.leftRelative.y + done.center.rightRelative.y) / 2;
    const err = Math.hypot(cx - G.x, cy - G.y);
    check('run starts after the corrective saccade', done.tStart >= 480, `tStart=${done.tStart.toFixed(0)} ms, settle=${done.settleMs.toFixed(0)} ms`);
    check('no frame inside blink padding used', done.frames.every((f) => f.t < blinkFrom - 100 || f.t > blinkTo + 150));
    check('glare spike rejected', done.frames.every((f) => Math.abs(f.t - 900) >= FRAME_MS / 2));
    check('center within 0.02 of the true fixation', err < 0.02, `err=${err.toFixed(4)}`);

    // The old timer: mean of every frame 800–2000 ms.
    const old = allFrames.filter((f) => f.t >= 800 && f.t <= 2000);
    const ox = old.reduce((s, f) => s + f.g.x, 0) / old.length;
    const oy = old.reduce((s, f) => s + f.g.y, 0) / old.length;
    console.log(`      old fixed-window mean error=${Math.hypot(ox - G.x, oy - G.y).toFixed(4)} vs new ${err.toFixed(4)}`);
  }
}

// ── 2. Unstable fixation → fallback, never an endless wait ──────────────────
{
  const noise = new FixationNoiseModel();
  const opts = timerFixationOptions(1);
  const col = new FixationCollector(0, opts, noise);
  let complete = false;
  for (let t = 0; t <= opts.maxMs; t += FRAME_MS) {
    // ~2.5 Hz square-wave jerks of 0.25 units: nystagmus-like, never stable for 700 ms
    const jerk = Math.floor(t / 200) % 2 ? 0.25 : 0;
    col.addFrame(t, feat(0.5 + jerk, -1));
    if (col.evaluate(t).complete) complete = true;
  }
  const res = col.finalize(opts.maxMs);
  check('unstable fixation never completes', !complete);
  check('unstable fixation yields a flagged fallback (or nothing)', res === null || res.ok === false,
    res ? `fallback frames=${res.frames.length}` : 'null');
}

// ── 3. Head turn inside the window breaks the run ────────────────────────────
{
  const noise = new FixationNoiseModel();
  const opts = timerFixationOptions(1);
  const col = new FixationCollector(0, opts, noise);
  let res: ReturnType<FixationCollector['finalize']> = null;
  for (let t = 0; t <= opts.maxMs; t += FRAME_MS) {
    const yaw = t < 900 ? 0 : 0.08; // ~4.6° head turn at 900 ms
    col.addFrame(t, feat(0.8, -1.0, { yaw }));
    if (t % 50 < FRAME_MS && col.evaluate(t).complete) { res = col.finalize(t); break; }
  }
  check('run does not straddle a head turn', !!res && (res.tEnd < 900 || res.tStart >= 900),
    res ? `run ${res.tStart.toFixed(0)}–${res.tEnd.toFixed(0)} ms` : 'no result');
}

// ── 4. Residual review flags the one corrupted dot ───────────────────────────
{
  const pts = [];
  for (const sy of [40, 540, 1040]) for (const sx of [80, 960, 1840]) {
    const gx = -1 + (sx / 1920) * 1.4 + 0.08 * ((sx / 1920) - 0.5) ** 2 + 0.003 * gauss();
    const gy = -1.4 + (sy / 1080) * 0.5 + 0.003 * gauss();
    pts.push({ screenX: sx, screenY: sy, gx, gy });
  }
  const clean = residualOutliers(pts);
  check('clean grid flags nothing', clean.indices.length === 0, `residuals=${clean.residualsPx.map((r) => r.toFixed(0)).join(',')}`);
  pts[4] = { ...pts[4]!, gx: pts[4]!.gx + 0.25 }; // center dot recorded while looking elsewhere
  const bad = residualOutliers(pts);
  check('corrupted dot is flagged', bad.indices.length === 1 && bad.indices[0] === 4, `flagged=${bad.indices}`);
}

// ── 5. Exercise: pauses become dots, pursuit lag is recovered ────────────────
{
  const LAG = 110; // ms, camera + pipeline + pursuit
  const W = 1920;
  const toG = (x: number) => -1 + (x / W) * 1.4;
  // horizontal: pause 1 s at left, move 3 s to right, pause 1 s, move back, pause 1 s
  const segs = [
    { d: 1000, from: 230, to: 230 }, { d: 3040, from: 230, to: 1690 },
    { d: 1000, from: 1690, to: 1690 }, { d: 3040, from: 1690, to: 230 }, { d: 1000, from: 230, to: 230 },
  ];
  const targetAt = (t: number) => {
    let acc = 0;
    for (const s of segs) {
      if (t <= acc + s.d) return s.from + (s.to - s.from) * ((t - acc) / s.d);
      acc += s.d;
    }
    return segs[segs.length - 1]!.to;
  };
  const total = segs.reduce((s, x) => s + x.d, 0);
  const frames: ExerciseFrame[] = [];
  for (let t = 0; t <= total; t += FRAME_MS) {
    const eyeX = targetAt(Math.max(0, t - LAG));
    frames.push({ t, targetX: targetAt(t), targetY: 540, f: feat(toG(eyeX), -1.15) });
  }
  const res = buildExerciseSamples(frames, [], new FixationNoiseModel());
  check('pursuit lag recovered within 25 ms', res.lagEstimated && Math.abs(res.lagMs - LAG) <= 25, `lag=${res.lagMs} ms`);
  const pauses = res.samples.filter((s) => s.kind === 'pause');
  check('each endpoint pause yields a static sample', pauses.length === 3, `pauses=${pauses.length}`);
  const pursuit = res.samples.filter((s) => s.kind === 'pursuit');
  const labelErr = (s: (typeof pursuit)[number]) => {
    const gx = (s.center.leftRelative.x + s.center.rightRelative.x) / 2;
    return Math.abs(((gx + 1) / 1.4) * W - s.screenX);
  };
  const meanErr = pursuit.reduce((a, s) => a + labelErr(s), 0) / Math.max(1, pursuit.length);
  // Without compensation the label leads the eye by LAG ms at ~480 px/s ≈ 53 px.
  check('pursuit labels match where the eye was', pursuit.length > 0 && meanErr < 20,
    `n=${pursuit.length}, mean |label − eye|=${meanErr.toFixed(1)} px (uncompensated ≈ ${(1460 / 3.04 * LAG / 1000).toFixed(0)} px)`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
