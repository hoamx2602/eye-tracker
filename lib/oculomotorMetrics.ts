/**
 * Saccade detection on the per-frame gaze stream (lib/gazeFrameStream).
 *
 * The tests used to time a saccade by when the (smoothed, 10 Hz) gaze first
 * entered a circle around the target. With a validation error of ~120 px and
 * an 80 px circle, whether and when that happens depends on the calibration
 * more than on the eye. What a webcam tracker measures well is *change*: a
 * constant offset or a gain below 1 moves every sample the same way, but the
 * moment the gaze starts moving, and which way it goes, survive both.
 *
 * So each trial is analysed relative to its own pre-stimulus baseline:
 *
 *  1. baseline = median gaze along the task axis just before the stimulus;
 *  2. velocity = central difference of the raw (unsmoothed) gaze, after a
 *     3-sample median that removes single-frame landmark spikes;
 *  3. the primary saccade is the first stretch whose velocity exceeds a
 *     threshold (the larger of the trial's own pre-stimulus noise level and a
 *     fraction of the expected amplitude) and that carries the gaze at least
 *     `minAmplitudeFrac` of the expected distance away from the baseline;
 *  4. its onset is the time the gaze crosses 20% of that saccade's
 *     displacement, interpolated between frames — at 30 Hz a saccade spans one
 *     or two frames, and interpolation keeps the estimate from snapping to them.
 *
 * Peak velocity and duration are deliberately not reported: at 30 Hz a
 * 10° saccade is one or two samples long, and those numbers would be noise.
 */
import { GazeFrameQuality, type GazeFrame } from '@/lib/gazeFrameStream';

export type SaccadeAxis = 'x' | 'y';

export interface SaccadeDetectionOptions {
  /** Onsets earlier than this after the stimulus are anticipations, not responses (ms). */
  minLatencyMs: number;
  /** Search window after stimulus onset (ms). */
  maxLatencyMs: number;
  /** A saccade must carry the gaze this fraction of the expected distance from baseline. */
  minAmplitudeFrac: number;
  /** Velocity floor as a fraction of expected amplitude per 100 ms. */
  minVelocityFracPer100ms: number;
  /** Pre-stimulus window used for the baseline and noise level (ms). */
  baselineMs: number;
  /** A trial with less than this fraction of usable frames in its window is `lost`. */
  minValidFraction: number;
}

export const DEFAULT_SACCADE_OPTIONS: SaccadeDetectionOptions = {
  minLatencyMs: 80,
  maxLatencyMs: 900,
  minAmplitudeFrac: 0.3,
  minVelocityFracPer100ms: 0.25,
  baselineMs: 300,
  minValidFraction: 0.5,
};

export type SaccadeOutcome =
  /** First saccade went the way the task asked. */
  | 'correct'
  /** First saccade went the other way (for anti-saccade: towards the stimulus). */
  | 'error'
  /** Movement began before `minLatencyMs` — the participant guessed. */
  | 'anticipatory'
  /** No qualifying movement within the window. */
  | 'no_response'
  /** Too few usable frames (blinks, head out of position) to tell. */
  | 'lost';

export interface TrialSaccade {
  outcome: SaccadeOutcome;
  /** Onset − stimulus onset, ms. Null when no saccade was found. */
  latencyMs: number | null;
  /** Signed displacement of the primary saccade along the axis, px (after landing). */
  amplitudePx: number | null;
  /** |amplitude| / expected distance. Below 1 on a webcam tracker even for a perfect saccade (regression attenuation). */
  gain: number | null;
  /** Error trials only: a later saccade crossed back past the baseline in the correct direction. */
  corrected?: boolean;
  /** Error trials only: time of that correction after stimulus onset, ms. */
  correctionLatencyMs?: number;
  validFraction: number;
}

interface Sample {
  t: number;
  p: number;
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Usable frames in [t0, t1], projected onto the axis. */
function axisSamples(frames: readonly GazeFrame[], axis: SaccadeAxis, t0: number, t1: number): Sample[] {
  const out: Sample[] = [];
  for (const f of frames) {
    if (f.t < t0 || f.t > t1 || f.q !== GazeFrameQuality.OK) continue;
    const p = axis === 'x' ? f.x : f.y;
    if (Number.isFinite(p)) out.push({ t: f.t, p });
  }
  return out;
}

/** 3-sample running median — removes single-frame spikes, keeps a step a step. */
function median3(s: Sample[]): Sample[] {
  if (s.length < 3) return s;
  return s.map((x, i) => {
    if (i === 0 || i === s.length - 1) return x;
    const a = s[i - 1]!.p, b = x.p, c = s[i + 1]!.p;
    return { t: x.t, p: Math.max(Math.min(a, b), Math.min(Math.max(a, b), c)) };
  });
}

/** Central-difference velocity, px/ms (one-sided at the ends). */
function velocity(s: Sample[]): number[] {
  return s.map((_, i) => {
    const a = s[Math.max(0, i - 1)]!, b = s[Math.min(s.length - 1, i + 1)]!;
    const dt = b.t - a.t;
    return dt > 0 ? (b.p - a.p) / dt : 0;
  });
}

/** Time at which the trace first crosses `level` at or after index `from`, interpolated. */
function crossingTime(s: Sample[], from: number, level: number, sign: number): number | null {
  for (let i = Math.max(1, from); i < s.length; i++) {
    const a = (s[i - 1]!.p - level) * sign, b = (s[i]!.p - level) * sign;
    if (a < 0 && b >= 0) {
      const f = -a / (b - a);
      return s[i - 1]!.t + f * (s[i]!.t - s[i - 1]!.t);
    }
  }
  return null;
}

interface FoundSaccade {
  onsetT: number;
  sign: number;
  amplitude: number;
  /** Index after which the saccade has landed. */
  endIndex: number;
}

/**
 * First saccade in `s` from index `from` on, relative to `baseline`.
 * `sign` restricts the direction (0 = either way).
 */
function findSaccade(
  s: Sample[],
  v: number[],
  from: number,
  baseline: number,
  vThreshold: number,
  minDisplacement: number,
  sign: number,
): FoundSaccade | null {
  for (let i = from; i < s.length; i++) {
    const vi = v[i]!;
    if (Math.abs(vi) < vThreshold) continue;
    const dir = Math.sign(vi);
    if (sign !== 0 && dir !== sign) continue;
    // Landing: follow the movement while velocity keeps its sign, then take the
    // median of the next ~150 ms as where the eye arrived.
    let j = i;
    while (j + 1 < s.length && Math.sign(v[j + 1]!) === dir && Math.abs(v[j + 1]!) >= vThreshold * 0.5) j++;
    const landT = s[j]!.t;
    const landing = s.filter((x) => x.t >= landT && x.t <= landT + 150).map((x) => x.p);
    const landed = landing.length > 0 ? median(landing) : s[j]!.p;
    const displacement = landed - baseline;
    if (Math.sign(displacement) !== dir || Math.abs(displacement) < minDisplacement) continue;
    // Onset: 20% of the way from the pre-movement position to the landing.
    const start = s[Math.max(0, i - 1)]!.p;
    const level = start + 0.2 * (landed - start);
    const onsetT = crossingTime(s, Math.max(1, i - 1), level, dir) ?? s[i]!.t;
    return { onsetT, sign: dir, amplitude: displacement, endIndex: j };
  }
  return null;
}

/**
 * Primary saccade of one trial.
 *
 * @param stimulusOnset  Time the stimulus appeared (performance.now clock, same as frame times).
 * @param correctSign    +1 / −1: the direction along `axis` the task asks the eye to go.
 * @param expectedDistancePx  How far the correct target is from the fixation point, px.
 */
export function detectTrialSaccade(
  frames: readonly GazeFrame[],
  stimulusOnset: number,
  axis: SaccadeAxis,
  correctSign: 1 | -1,
  expectedDistancePx: number,
  options: Partial<SaccadeDetectionOptions> = {},
): TrialSaccade {
  const o = { ...DEFAULT_SACCADE_OPTIONS, ...options };
  const pre = axisSamples(frames, axis, stimulusOnset - o.baselineMs, stimulusOnset);
  const post = axisSamples(frames, axis, stimulusOnset, stimulusOnset + o.maxLatencyMs);

  // Expected frame count from the recording's own rate (~33 ms at 30 Hz).
  const allInWindow = frames.filter((f) => f.t >= stimulusOnset && f.t <= stimulusOnset + o.maxLatencyMs).length;
  const validFraction = allInWindow > 0 ? post.length / allInWindow : 0;
  const empty = { latencyMs: null, amplitudePx: null, gain: null, validFraction };
  if (pre.length < 3 || post.length < 4 || validFraction < o.minValidFraction) {
    return { outcome: 'lost', ...empty };
  }

  const baseline = median(pre.map((x) => x.p));
  const s = median3([...pre, ...post]);
  const v = velocity(s);
  const preV = v.slice(0, pre.length).map(Math.abs);
  const noise = median(preV) + 6 * 1.4826 * median(preV.map((x) => Math.abs(x - median(preV))));
  const vThreshold = Math.max(noise, (o.minVelocityFracPer100ms * expectedDistancePx) / 100);
  const minDisplacement = o.minAmplitudeFrac * expectedDistancePx;

  const first = findSaccade(s, v, pre.length > 0 ? pre.length - 1 : 0, baseline, vThreshold, minDisplacement, 0);
  if (!first) return { outcome: 'no_response', ...empty };

  const latencyMs = first.onsetT - stimulusOnset;
  const result: TrialSaccade = {
    outcome: latencyMs < o.minLatencyMs ? 'anticipatory' : first.sign === correctSign ? 'correct' : 'error',
    latencyMs,
    amplitudePx: first.amplitude,
    gain: Math.abs(first.amplitude) / expectedDistancePx,
    validFraction,
  };

  if (result.outcome === 'error') {
    // Correction: a later saccade the other way that ends past the baseline.
    const back = findSaccade(s, v, first.endIndex + 1, baseline, vThreshold, minDisplacement, correctSign);
    result.corrected = back !== null;
    if (back) result.correctionLatencyMs = back.onsetT - stimulusOnset;
  }
  return result;
}

export interface SaccadeSummary {
  trials: number;
  correct: number;
  errors: number;
  correctedErrors: number;
  anticipatory: number;
  noResponse: number;
  lost: number;
  /** errors / (correct + errors) — the anti-saccade error rate. Null when neither occurred. */
  errorRate: number | null;
  /** corrected / errors. */
  correctionRate: number | null;
  medianLatencyCorrectMs: number | null;
  meanLatencyCorrectMs: number | null;
  sdLatencyCorrectMs: number | null;
  medianLatencyErrorMs: number | null;
  medianGainCorrect: number | null;
}

export function summariseSaccades(trials: readonly TrialSaccade[]): SaccadeSummary {
  const by = (o: SaccadeOutcome) => trials.filter((t) => t.outcome === o);
  const correct = by('correct');
  const errors = by('error');
  const lat = correct.map((t) => t.latencyMs!).filter(Number.isFinite);
  const mean = lat.length > 0 ? lat.reduce((a, b) => a + b, 0) / lat.length : null;
  const sd = mean !== null && lat.length > 1
    ? Math.sqrt(lat.reduce((a, b) => a + (b - mean) ** 2, 0) / (lat.length - 1))
    : null;
  const decided = correct.length + errors.length;
  const round = (x: number | null) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
  const rate = (x: number) => Math.round(x * 1000) / 1000;
  const med = (xs: number[]) => (xs.length > 0 ? median(xs) : null);
  return {
    trials: trials.length,
    correct: correct.length,
    errors: errors.length,
    correctedErrors: errors.filter((t) => t.corrected).length,
    anticipatory: by('anticipatory').length,
    noResponse: by('no_response').length,
    lost: by('lost').length,
    errorRate: decided > 0 ? rate(errors.length / decided) : null,
    correctionRate: errors.length > 0 ? rate(errors.filter((t) => t.corrected).length / errors.length) : null,
    medianLatencyCorrectMs: round(med(lat)),
    meanLatencyCorrectMs: round(mean),
    sdLatencyCorrectMs: round(sd),
    medianLatencyErrorMs: round(med(errors.map((t) => t.latencyMs!).filter(Number.isFinite))),
    medianGainCorrect: round(med(correct.map((t) => t.gain!).filter(Number.isFinite))),
  };
}

/**
 * Fixation precision from raw frames: RMS sample-to-sample distance and the
 * 68% / 95% bivariate contour ellipse area, px / px². Computed on the raw
 * regressor output — the smoothed stream would report the filter's stillness.
 */
export function fixationPrecision(frames: readonly GazeFrame[], t0: number, t1: number): {
  n: number;
  rmsS2SPx: number | null;
  sdXPx: number | null;
  sdYPx: number | null;
  bcea68Px2: number | null;
  bcea95Px2: number | null;
} {
  const pts = frames.filter((f) => f.t >= t0 && f.t <= t1 && f.q === GazeFrameQuality.OK && Number.isFinite(f.x) && Number.isFinite(f.y));
  const n = pts.length;
  if (n < 5) return { n, rmsS2SPx: null, sdXPx: null, sdYPx: null, bcea68Px2: null, bcea95Px2: null };
  let s2s = 0;
  for (let i = 1; i < n; i++) s2s += (pts[i]!.x - pts[i - 1]!.x) ** 2 + (pts[i]!.y - pts[i - 1]!.y) ** 2;
  const mx = pts.reduce((a, p) => a + p.x, 0) / n;
  const my = pts.reduce((a, p) => a + p.y, 0) / n;
  let vx = 0, vy = 0, cxy = 0;
  for (const p of pts) { vx += (p.x - mx) ** 2; vy += (p.y - my) ** 2; cxy += (p.x - mx) * (p.y - my); }
  vx /= n - 1; vy /= n - 1; cxy /= n - 1;
  const sx = Math.sqrt(vx), sy = Math.sqrt(vy);
  const rho = sx > 0 && sy > 0 ? Math.max(-1, Math.min(1, cxy / (sx * sy))) : 0;
  // BCEA = 2kπ σx σy √(1−ρ²), P = 1 − e^(−k)
  const bcea = (P: number) => 2 * -Math.log(1 - P) * Math.PI * sx * sy * Math.sqrt(1 - rho * rho);
  const r = (x: number) => Math.round(x * 10) / 10;
  return { n, rmsS2SPx: r(Math.sqrt(s2s / (n - 1))), sdXPx: r(sx), sdYPx: r(sy), bcea68Px2: Math.round(bcea(0.68)), bcea95Px2: Math.round(bcea(0.95)) };
}
