/**
 * Synthetic checks for lib/oculomotorMetrics.ts.
 *
 * Traces are generated the way the webcam pipeline sees them: 30 Hz frames
 * with jittered capture times, single-frame landmark noise (~8 px), a mapping
 * gain below 1 and a constant calibration offset. The detector must recover
 * latency and direction regardless of the offset and gain.
 *
 * Usage:  npx tsx scripts/check-oculomotor-metrics.ts
 */
import { GazeFrameQuality, type GazeFrame } from '../lib/gazeFrameStream';
import { detectTrialSaccade, fixationPrecision, summariseSaccades, type TrialSaccade } from '../lib/oculomotorMetrics';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
};

// Deterministic PRNG so a failure reproduces.
let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

interface TraceSpec {
  onset: number;
  /** Eye movements: [start time rel. onset, target x] — each a 50 ms saccade. */
  moves: [number, number][];
  noisePx?: number;
  gain?: number;
  offsetPx?: number;
  blinkFrom?: number;
  blinkTo?: number;
}

function trace(spec: TraceSpec): GazeFrame[] {
  const { onset, moves, noisePx = 8, gain = 0.75, offsetPx = 0 } = spec;
  const cx = 720;
  const frames: GazeFrame[] = [];
  const eyeAt = (t: number) => {
    let x = cx;
    for (const [start, target] of moves) {
      const s = onset + start;
      if (t >= s + 50) x = target;
      else if (t > s) x = x + (target - x) * ((t - s) / 50);
    }
    return x;
  };
  for (let t = onset - 600; t < onset + 1000; t += 33.3 + gauss() * 2) {
    const blink = spec.blinkFrom !== undefined && t >= onset + spec.blinkFrom && t <= onset + spec.blinkTo!;
    const x = cx + gain * (eyeAt(t) - cx) + offsetPx + gauss() * noisePx;
    const y = 450 + offsetPx + gauss() * noisePx;
    frames.push(blink
      ? { t, x: NaN, y: NaN, sx: NaN, sy: NaN, q: GazeFrameQuality.BLINK }
      : { t, x, y, sx: x, sy: y, q: GazeFrameQuality.OK });
  }
  return frames;
}

const A = 360; // target 25% of a 1440 px viewport from centre
const onset = 10_000;

// 1. Prosaccade latency recovered within one frame, over many noisy trials.
{
  const errs: number[] = [];
  let correct = 0;
  for (let i = 0; i < 200; i++) {
    const L = 150 + rand() * 250;
    const r = detectTrialSaccade(trace({ onset, moves: [[L, 720 + A]] }), onset, 'x', 1, A);
    if (r.outcome === 'correct') { correct++; errs.push(r.latencyMs! - L); }
  }
  const bias = errs.reduce((a, b) => a + b, 0) / errs.length;
  const mae = errs.reduce((a, b) => a + Math.abs(b - bias), 0) / errs.length;
  check('prosaccades classified correct', correct >= 196, `${correct}/200`);
  check('latency bias under one frame', Math.abs(bias) < 33, `bias ${bias.toFixed(1)} ms`);
  check('latency scatter under half a frame', mae < 17, `MAE about bias ${mae.toFixed(1)} ms`);
}

// 2. A constant calibration offset and a different gain do not change latency.
{
  const base = detectTrialSaccade(trace({ onset, moves: [[220, 720 + A]], noisePx: 0 }), onset, 'x', 1, A);
  seed = 7;
  const shifted = detectTrialSaccade(trace({ onset, moves: [[220, 720 + A]], noisePx: 0, offsetPx: 150, gain: 0.6 }), onset, 'x', 1, A);
  check('offset/gain invariant latency', Math.abs(base.latencyMs! - shifted.latencyMs!) < 12,
    `${base.latencyMs!.toFixed(1)} vs ${shifted.latencyMs!.toFixed(1)} ms`);
}

// 3. Anti-saccade error with a correction.
{
  const r = detectTrialSaccade(trace({ onset, moves: [[180, 720 + A], [420, 720 - A]] }), onset, 'x', -1, A);
  check('error trial detected', r.outcome === 'error', r.outcome);
  check('correction detected', r.corrected === true && (r.correctionLatencyMs ?? 0) > 400, `${r.correctionLatencyMs?.toFixed(0)} ms`);
}

// 4. Correct anti-saccade.
{
  const r = detectTrialSaccade(trace({ onset, moves: [[300, 720 - A]] }), onset, 'x', -1, A);
  check('correct anti-saccade', r.outcome === 'correct' && Math.abs(r.latencyMs! - 300) < 33, `${r.outcome} ${r.latencyMs?.toFixed(0)} ms`);
}

// 5. Anticipation, no response, lost.
{
  const a = detectTrialSaccade(trace({ onset, moves: [[20, 720 + A]] }), onset, 'x', 1, A);
  check('anticipation flagged', a.outcome === 'anticipatory', `${a.outcome} ${a.latencyMs?.toFixed(0)} ms`);
  const n = detectTrialSaccade(trace({ onset, moves: [] }), onset, 'x', 1, A);
  check('no response when the eye stays', n.outcome === 'no_response', n.outcome);
  const l = detectTrialSaccade(trace({ onset, moves: [[200, 720 + A]], blinkFrom: 0, blinkTo: 700 }), onset, 'x', 1, A);
  check('lost when blinks cover the window', l.outcome === 'lost', l.outcome);
}

// 6. Noise alone never produces a saccade (false-positive rate).
{
  let fp = 0;
  for (let i = 0; i < 200; i++) {
    const r = detectTrialSaccade(trace({ onset, moves: [], noisePx: 10 }), onset, 'x', 1, A);
    if (r.outcome !== 'no_response') fp++;
  }
  check('no false saccades on fixation noise', fp <= 2, `${fp}/200`);
}

// 7. Summary.
{
  const trials: TrialSaccade[] = [
    { outcome: 'correct', latencyMs: 250, amplitudePx: 270, gain: 0.75, validFraction: 1 },
    { outcome: 'correct', latencyMs: 300, amplitudePx: 270, gain: 0.75, validFraction: 1 },
    { outcome: 'error', latencyMs: 180, amplitudePx: -270, gain: 0.75, corrected: true, validFraction: 1 },
    { outcome: 'lost', latencyMs: null, amplitudePx: null, gain: null, validFraction: 0.2 },
  ];
  const s = summariseSaccades(trials);
  check('summary error rate excludes lost trials', s.errorRate === 0.333, `${s.errorRate}`);
  check('summary median latency of correct trials', s.medianLatencyCorrectMs === 275, `${s.medianLatencyCorrectMs}`);
}

// 8. Fixation precision on raw frames.
{
  const f = trace({ onset, moves: [], noisePx: 10 });
  const p = fixationPrecision(f, onset - 600, onset + 1000);
  check('fixation SD matches injected noise', Math.abs(p.sdXPx! - 10) < 2.5 && Math.abs(p.sdYPx! - 10) < 2.5, `sdX ${p.sdXPx} sdY ${p.sdYPx}`);
  check('RMS-S2S ≈ 2 × SD for 2-D white noise', Math.abs(p.rmsS2SPx! - 2 * 10) < 4, `${p.rmsS2SPx}`);
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
