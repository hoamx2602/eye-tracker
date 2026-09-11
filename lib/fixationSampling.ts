/**
 * Gaze-contingent calibration sampling.
 *
 * A calibration dot is a stimulus, not a measurement: for the first few hundred
 * ms after it appears the eye is still in saccade latency (150–250 ms, longer
 * after concussion), then the saccade itself (≈ 21 + 2.2·A ms), then usually a
 * corrective saccade for large jumps (primary saccades undershoot by ~10%).
 * Only after that is the eye fixating the dot. Past ~1–1.5 s of a rhythmic
 * sequence it starts drifting / anticipating the next dot.
 *
 * So instead of a fixed clock window, each dot is sampled the way Tobii Pro's
 * calibration flow does it (developer.tobiipro.com/commonconcepts/calibration):
 * collect only once the gaze has settled on the target, judge the per-point
 * quality, and re-collect points that came out bad.
 *
 * Everything here works in *feature space* (iris offset relative to the eye
 * corners, plus head pose), because during the grid no screen mapping exists
 * yet. Thresholds are self-calibrating: they scale with the participant's own
 * fixation noise, which is what makes them usable across webcams and people.
 *
 * Pure module — no React, no DOM — so it can be exercised on synthetic data.
 */
import type { EyeFeatures, HeadPose } from '@/types';

// ─── Tunables ────────────────────────────────────────────────────────────────

export interface FixationOptions {
  /** Never collect before this (saccade latency + saccade). */
  minSettleMs: number;
  /** A stable run this long completes the dot. */
  collectMs: number;
  /** Give up waiting for a stable run after this; fall back to the best run seen. */
  maxMs: number;
  /** Minimum clean inlier frames in a complete run. */
  minFrames: number;
  /** Minimum clean inlier frames for a fallback (low-quality) run. */
  fallbackMinFrames: number;
  /** Frames this long before a detected blink are dropped (lid already moving). */
  blinkPreMs: number;
  /** Frames this long after the last blink frame are dropped (lid + eye recovering). */
  blinkPostMs: number;
  /** Stability radius = max(floor, radiusK · σ) per axis. */
  radiusK: number;
  /** Floor for the gaze radius, in iris-offset units (leftRelative ×10). ≈0.4–0.6° at 60 cm. */
  gazeFloor: number;
  /** Floor for the head-pose radius (rad). */
  headFloorRad: number;
  /** Frames outside the radius a run may contain before it is considered broken. */
  maxOutlierFrac: number;
  /** A frame whose EAR drops below this fraction of the dot's median EAR is a (partial) blink. */
  partialBlinkRatio: number;
  /** Final k·MAD rejection on the gaze axes; Infinity disables it. */
  madK: number;
}

export const DEFAULT_FIXATION_OPTIONS: FixationOptions = {
  minSettleMs: 300,
  collectMs: 700,
  maxMs: 3000,
  minFrames: 8,
  fallbackMinFrames: 4,
  blinkPreMs: 100,
  blinkPostMs: 150,
  radiusK: 3.5,
  gazeFloor: 0.02,
  headFloorRad: (1.5 * Math.PI) / 180,
  maxOutlierFrac: 0.2,
  partialBlinkRatio: 0.65,
  madK: 3,
};

/**
 * Options for a timer-paced dot at a given speed multiplier (FAST 0.5, NORMAL 1,
 * SLOW 1.5). The settle floor stays physiological; only how long we collect and
 * how long we are willing to wait scale with the speed setting.
 */
export function timerFixationOptions(speedMultiplier: number, madK = DEFAULT_FIXATION_OPTIONS.madK): FixationOptions {
  const m = Math.max(0.25, speedMultiplier);
  return {
    ...DEFAULT_FIXATION_OPTIONS,
    collectMs: Math.max(350, 700 * m),
    maxMs: Math.max(1500, 3000 * m),
    minFrames: Math.max(5, Math.round(8 * m)),
    madK,
  };
}

// ─── Small numeric helpers ──────────────────────────────────────────────────

export function median(values: ArrayLike<number>): number {
  const n = values.length;
  if (n === 0) return NaN;
  const s = Float64Array.from(values).sort();
  const mid = n >> 1;
  return n % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** 1.4826·MAD — a consistent estimator of σ for Gaussian data. */
export function robustSigma(values: ArrayLike<number>): number {
  const m = median(values);
  const dev = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) dev[i] = Math.abs(values[i]! - m);
  return 1.4826 * median(dev);
}

/** Per-field median of EyeFeatures — the robust counterpart of averaging frames. */
export function medianEyeFeatures(feats: EyeFeatures[]): EyeFeatures {
  const med = (fn: (f: EyeFeatures) => number) => median(feats.map(fn));
  const medPose = (fn: (f: EyeFeatures) => HeadPose): HeadPose => ({
    pitch: med((f) => fn(f).pitch),
    yaw: med((f) => fn(f).yaw),
    roll: med((f) => fn(f).roll),
  });
  const first = feats[0]!;
  const blendKeys = first.blendshapes ? Object.keys(first.blendshapes) : [];
  const withMatrix = feats.filter((f) => f.matrixHeadPose);
  return {
    leftPupil: { x: med((f) => f.leftPupil.x), y: med((f) => f.leftPupil.y) },
    rightPupil: { x: med((f) => f.rightPupil.x), y: med((f) => f.rightPupil.y) },
    leftEyeCenter: { x: med((f) => f.leftEyeCenter.x), y: med((f) => f.leftEyeCenter.y) },
    rightEyeCenter: { x: med((f) => f.rightEyeCenter.x), y: med((f) => f.rightEyeCenter.y) },
    leftRelative: { x: med((f) => f.leftRelative.x), y: med((f) => f.leftRelative.y) },
    rightRelative: { x: med((f) => f.rightRelative.x), y: med((f) => f.rightRelative.y) },
    headPose: medPose((f) => f.headPose),
    zDistance: med((f) => f.zDistance),
    leftEAR: med((f) => f.leftEAR),
    rightEAR: med((f) => f.rightEAR),
    blendshapes: first.blendshapes
      ? Object.fromEntries(blendKeys.map((k) => [k, med((f) => f.blendshapes?.[k] ?? 0)]))
      : undefined,
    matrixHeadPose: withMatrix.length === feats.length && withMatrix.length > 0
      ? medPose((f) => f.matrixHeadPose!)
      : undefined,
  };
}

// ─── Signal ──────────────────────────────────────────────────────────────────

/** Axes judged for stability: binocular iris offset (x, y) and head yaw/pitch. */
const N_AXES = 4;
const GAZE_AXES = [0, 1] as const;

/**
 * Binocular iris offset plus matrix head pose. Averaging the two eyes halves the
 * landmark noise; head pose is included so a head turn inside the window breaks
 * the run instead of being averaged into the sample. The geometric head pose is
 * not in real angle units, so the head axes are left out (NaN) without the matrix.
 */
export function gazeSignal(f: EyeFeatures): number[] {
  const pose = f.matrixHeadPose;
  return [
    (f.leftRelative.x + f.rightRelative.x) / 2,
    (f.leftRelative.y + f.rightRelative.y) / 2,
    pose ? pose.yaw : NaN,
    pose ? pose.pitch : NaN,
  ];
}

/**
 * Session-wide fixation noise, learnt from the dots already accepted.
 * Each accepted run contributes its residuals around its own median; their
 * robust spread is the participant's fixation noise (landmark jitter + drift +
 * microsaccades), which is exactly what the stability radius should scale with.
 */
export class FixationNoiseModel {
  private residuals: number[][] = Array.from({ length: N_AXES }, () => []);
  private static readonly MAX_KEEP = 600;
  private static readonly MIN_FOR_ESTIMATE = 20;

  reset(): void {
    this.residuals = Array.from({ length: N_AXES }, () => []);
  }

  addRun(signals: number[][]): void {
    for (let a = 0; a < N_AXES; a++) {
      const col = signals.map((s) => s[a]!).filter(Number.isFinite);
      if (col.length < 3) continue;
      const m = median(col);
      const bucket = this.residuals[a]!;
      for (const v of col) bucket.push(v - m);
      if (bucket.length > FixationNoiseModel.MAX_KEEP) bucket.splice(0, bucket.length - FixationNoiseModel.MAX_KEEP);
    }
  }

  /** Robust σ for an axis, or null until enough accepted data exists. */
  sigma(axis: number): number | null {
    const r = this.residuals[axis]!;
    return r.length >= FixationNoiseModel.MIN_FOR_ESTIMATE ? robustSigma(r) : null;
  }
}

/**
 * σ from frame-to-frame differences, for the first dots before the noise model
 * has data. Median |Δ| is robust to the few saccade frames. Landmark noise is
 * autocorrelated across frames, which makes Δ underestimate σ, hence the 1.5.
 */
function sigmaFromDiffs(col: number[]): number | null {
  const d: number[] = [];
  for (let i = 1; i < col.length; i++) {
    const v = col[i]! - col[i - 1]!;
    if (Number.isFinite(v)) d.push(Math.abs(v));
  }
  if (d.length < 4) return null;
  return (1.5 * 1.4826 * median(d)) / Math.SQRT2;
}

// ─── Stable-run search ──────────────────────────────────────────────────────

interface Run {
  start: number;
  end: number;
  /** Indices (into the searched arrays) within the radius of the run median. */
  inliers: number[];
}

/**
 * The latest stable run ending at `end`: extend backwards while at most
 * `maxOutlierFrac` of the frames fall outside the per-axis radius of the run
 * median, and only ever start the run on an inlier frame. A saccade therefore
 * ends the run (every frame before it is far from the post-saccade median),
 * while an isolated glare spike does not.
 */
function latestStableRun(sig: number[][], end: number, radius: number[], maxOutlierFrac: number): Run {
  const within = (s: number[], c: number[]) => {
    for (let a = 0; a < N_AXES; a++) {
      if (!Number.isFinite(radius[a]!) || !Number.isFinite(s[a]!)) continue;
      if (Math.abs(s[a]! - c[a]!) > radius[a]!) return false;
    }
    return true;
  };
  let best: Run = { start: end, end, inliers: [end] };
  for (let j = end - 1; j >= 0; j--) {
    const c: number[] = [];
    for (let a = 0; a < N_AXES; a++) {
      const col: number[] = [];
      for (let i = j; i <= end; i++) col.push(sig[i]![a]!);
      c.push(median(col.filter(Number.isFinite)));
    }
    const inliers: number[] = [];
    for (let i = j; i <= end; i++) if (within(sig[i]!, c)) inliers.push(i);
    const len = end - j + 1;
    if ((len - inliers.length) / len > maxOutlierFrac) break;
    if (within(sig[j]!, c)) best = { start: j, end, inliers };
  }
  return best;
}

// ─── Per-dot collector ──────────────────────────────────────────────────────

export interface TimedFrame {
  t: number;
  f: EyeFeatures;
}

export interface FixationResult {
  /** True when a complete stable run was found; false for a fallback (low-quality) run. */
  ok: boolean;
  /** Inlier frames the sample is built from. */
  frames: TimedFrame[];
  /** Robust center of those frames. */
  center: EyeFeatures;
  /** Absolute times (performance.now clock) of the first/last frame used. */
  tStart: number;
  tEnd: number;
  /** Time from dot onset to the first frame used — a latency-to-stable-fixation proxy. */
  settleMs: number;
  spanMs: number;
  /** RMS distance of the used frames from their median, in iris-offset units. */
  dispersion: number;
}

export interface CollectorStatus {
  /** A stable run has begun (drives the dot's "capturing" state). */
  capturing: boolean;
  /** A complete stable run is available — the dot can be finalized now. */
  complete: boolean;
}

export class FixationCollector {
  private frames: TimedFrame[] = [];
  private blinks: number[] = [];
  private ears: number[] = [];

  constructor(
    readonly onset: number,
    private readonly opts: FixationOptions,
    private readonly noise: FixationNoiseModel,
  ) {}

  addFrame(t: number, f: EyeFeatures): void {
    // Partial blinks never cross the fixed EAR threshold but still pull the iris
    // landmark down. Judging EAR against this dot's own median also keeps the
    // test independent of gaze direction (the upper lid drops on downward gaze).
    const ear = Math.min(f.leftEAR, f.rightEAR);
    if (Number.isFinite(ear) && this.ears.length >= 5 && ear < this.opts.partialBlinkRatio * median(this.ears)) {
      this.addBlink(t);
      return;
    }
    if (Number.isFinite(ear)) this.ears.push(ear);
    this.frames.push({ t, f });
  }

  addBlink(t: number): void {
    this.blinks.push(t);
  }

  get frameCount(): number {
    return this.frames.length;
  }

  private isBlinkPadded(t: number): boolean {
    for (const b of this.blinks) {
      if (t >= b - this.opts.blinkPreMs && t <= b + this.opts.blinkPostMs) return true;
    }
    return false;
  }

  /**
   * Frames usable for a run as of `now`: past the settle floor, clear of blink
   * padding, and old enough (blinkPreMs) that a blink starting right after them
   * would already have been seen.
   */
  private eligible(now: number): TimedFrame[] {
    const from = this.onset + this.opts.minSettleMs;
    const until = now - this.opts.blinkPreMs;
    return this.frames.filter((fr) => fr.t >= from && fr.t <= until && !this.isBlinkPadded(fr.t));
  }

  private radius(sig: number[][]): number[] {
    const r: number[] = [];
    for (let a = 0; a < N_AXES; a++) {
      const col = sig.map((s) => s[a]!);
      if (!col.some(Number.isFinite)) {
        r.push(NaN); // axis unavailable (no matrix head pose)
        continue;
      }
      const floor = a < 2 ? this.opts.gazeFloor : this.opts.headFloorRad;
      const s = this.noise.sigma(a) ?? sigmaFromDiffs(col.filter(Number.isFinite));
      r.push(Math.max(floor, s == null ? floor : this.opts.radiusK * s));
    }
    return r;
  }

  evaluate(now: number): CollectorStatus {
    const fr = this.eligible(now);
    if (fr.length < 3) return { capturing: false, complete: false };
    const sig = fr.map((x) => gazeSignal(x.f));
    const run = latestStableRun(sig, sig.length - 1, this.radius(sig), this.opts.maxOutlierFrac);
    const span = fr[run.end]!.t - fr[run.start]!.t;
    return {
      capturing: run.inliers.length >= 4 && span >= 150,
      complete: run.inliers.length >= this.opts.minFrames && span >= this.opts.collectMs,
    };
  }

  /**
   * Build the dot's sample. Uses the latest stable run when it is complete;
   * otherwise (timeout, or a click-hold release) the stable run with the most
   * inliers anywhere in the window, flagged `ok: false`. Null when not even a
   * fallback run exists.
   */
  finalize(now: number): FixationResult | null {
    const fr = this.eligible(now);
    if (fr.length < this.opts.fallbackMinFrames) return null;
    const sig = fr.map((x) => gazeSignal(x.f));
    const radius = this.radius(sig);

    let run = latestStableRun(sig, sig.length - 1, radius, this.opts.maxOutlierFrac);
    let ok = run.inliers.length >= this.opts.minFrames && fr[run.end]!.t - fr[run.start]!.t >= this.opts.collectMs;
    if (!ok) {
      for (let end = sig.length - 2; end >= 0; end--) {
        const cand = latestStableRun(sig, end, radius, this.opts.maxOutlierFrac);
        if (cand.inliers.length > run.inliers.length) run = cand;
      }
      ok = run.inliers.length >= this.opts.minFrames && fr[run.end]!.t - fr[run.start]!.t >= this.opts.collectMs;
    }
    if (run.inliers.length < this.opts.fallbackMinFrames) return null;

    const settled = trimLeadingStep(run.inliers.map((i) => fr[i]!), Math.max(5, this.opts.fallbackMinFrames));
    const kept = madFilter(settled, this.opts.madK);
    if (kept.length < this.opts.fallbackMinFrames) return null;
    const keptSig = kept.map((x) => gazeSignal(x.f));
    if (ok) this.noise.addRun(keptSig);

    const tStart = kept[0]!.t;
    const tEnd = kept[kept.length - 1]!.t;
    return {
      ok,
      frames: kept,
      center: medianEyeFeatures(kept.map((x) => x.f)),
      tStart,
      tEnd,
      settleMs: tStart - this.onset,
      spanMs: tEnd - tStart,
      dispersion: gazeDispersion(keptSig),
    };
  }
}

/**
 * Drop a short plateau at the start of a run. The last frames before a small
 * corrective saccade sit a little off the fixation — too little for a per-frame
 * test, which their own presence also inflates — but the mean of k of them has
 * noise σ/√k, so the offset shows clearly. Lead lengths 1–4 are tested against
 * the robust center and spread of the rest, repeatedly, while enough frames remain.
 */
function trimLeadingStep(frames: TimedFrame[], minKeep: number): TimedFrame[] {
  let out = frames;
  for (let guard = 0; guard < 3; guard++) {
    let cut = 0;
    for (const k of [1, 2, 3, 4]) {
      if (out.length - k < minKeep) break;
      const lead = out.slice(0, k).map((x) => gazeSignal(x.f));
      const rest = out.slice(k).map((x) => gazeSignal(x.f));
      const off = GAZE_AXES.some((a) => {
        const col = rest.map((s) => s[a]!);
        const sd = robustSigma(col);
        const leadMean = lead.reduce((s, v) => s + v[a]!, 0) / k;
        return sd > 0 && Math.abs(leadMean - median(col)) > (3.5 * sd) / Math.sqrt(k);
      });
      if (off) { cut = k; break; }
    }
    if (!cut) break;
    out = out.slice(cut);
  }
  return out;
}

/** Drop frames outside k·MAD of the median on either gaze axis (keeps all if that leaves too few). */
function madFilter(frames: TimedFrame[], k: number): TimedFrame[] {
  if (!Number.isFinite(k) || frames.length < 5) return frames;
  const sig = frames.map((x) => gazeSignal(x.f));
  const keep = frames.map(() => true);
  for (const a of GAZE_AXES) {
    const col = sig.map((s) => s[a]!);
    const m = median(col);
    const tol = Math.max(k * robustSigma(col), 1e-9);
    col.forEach((v, i) => { if (Math.abs(v - m) > tol) keep[i] = false; });
  }
  const out = frames.filter((_, i) => keep[i]);
  return out.length >= 3 ? out : frames;
}

function gazeDispersion(sig: number[][]): number {
  const mx = median(sig.map((s) => s[0]!));
  const my = median(sig.map((s) => s[1]!));
  let acc = 0;
  for (const s of sig) acc += (s[0]! - mx) ** 2 + (s[1]! - my) ** 2;
  return Math.sqrt(acc / sig.length);
}

/** Which of two attempts at the same dot to keep. */
export function isBetterResult(candidate: FixationResult, current: FixationResult | undefined): boolean {
  if (!current) return true;
  if (candidate.ok !== current.ok) return candidate.ok;
  if (candidate.frames.length < current.frames.length / 2) return false;
  return candidate.dispersion < current.dispersion;
}

// ─── Per-point quality review (Tobii steps 8–9) ─────────────────────────────

export interface ResidualPoint {
  screenX: number;
  screenY: number;
  gx: number;
  gy: number;
}

function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    if (Math.abs(M[p]![c]!) < 1e-12) return null;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r]![c]! / M[c]![c]!;
      for (let cc = c; cc <= n; cc++) M[r]![cc]! -= k * M[c]![cc]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

/**
 * Leave-one-dot-out reprojection error (px) of a small polynomial map from the
 * binocular iris offset to the screen — the browser-side equivalent of Tobii's
 * calibration plot. Deliberately low-dimensional: the production regressor has
 * ~30 features and would fit any single bad dot exactly, hiding it. Quadratic
 * only with plenty of dots; with a 3×3 grid a quadratic has almost no spare
 * degrees of freedom and one bad dot would bend it for everyone else.
 */
export function leaveOneOutResidualsPx(pts: ResidualPoint[], quadratic = pts.length >= 12): number[] {
  const n = pts.length;
  const mu = [median(pts.map((p) => p.gx)), median(pts.map((p) => p.gy))];
  const sd = [
    Math.max(1e-6, robustSigma(pts.map((p) => p.gx)) || 1),
    Math.max(1e-6, robustSigma(pts.map((p) => p.gy)) || 1),
  ];
  const basis = (p: ResidualPoint) => {
    const u = (p.gx - mu[0]!) / sd[0]!;
    const v = (p.gy - mu[1]!) / sd[1]!;
    return quadratic ? [1, u, v, u * u, u * v, v * v] : [1, u, v];
  };
  const X = pts.map(basis);
  const d = X[0]!.length;
  const lambda = 1e-3 * n;

  const errs: number[] = [];
  for (let hold = 0; hold < n; hold++) {
    const A = Array.from({ length: d }, () => new Array<number>(d).fill(0));
    const bx = new Array<number>(d).fill(0);
    const by = new Array<number>(d).fill(0);
    for (let i = 0; i < n; i++) {
      if (i === hold) continue;
      const xi = X[i]!;
      for (let r = 0; r < d; r++) {
        bx[r]! += xi[r]! * pts[i]!.screenX;
        by[r]! += xi[r]! * pts[i]!.screenY;
        for (let c = 0; c < d; c++) A[r]![c]! += xi[r]! * xi[c]!;
      }
    }
    for (let r = 1; r < d; r++) A[r]![r]! += lambda;
    const wx = solveLinear(A, bx);
    const wy = solveLinear(A, by);
    if (!wx || !wy) { errs.push(NaN); continue; }
    const xh = X[hold]!;
    const px = xh.reduce((s, v, k) => s + v * wx[k]!, 0);
    const py = xh.reduce((s, v, k) => s + v * wy[k]!, 0);
    errs.push(Math.hypot(px - pts[hold]!.screenX, py - pts[hold]!.screenY));
  }
  return errs;
}

/**
 * Dots whose held-out error stands out from the rest. A bad dot also inflates
 * everyone else's leave-one-out error (it is in all their fits), so it is
 * judged against the *other* dots' residuals recomputed without it: flagged
 * when above both median + 3·(robust σ) and 2× the median of those. Repeated
 * worst-first for at most a quarter of the dots — a calibration where most dots
 * look bad is a model or posture problem that re-collecting single dots will
 * not fix.
 */
export function residualOutliers(
  pts: ResidualPoint[],
  opts: { quadraticMinDots?: number } = {},
): { indices: number[]; residualsPx: number[] } {
  const MIN_DOTS = 6;
  if (pts.length < MIN_DOTS) return { indices: [], residualsPx: [] };
  const quadratic = pts.length >= (opts.quadraticMinDots ?? 12);
  const residualsPx = leaveOneOutResidualsPx(pts, quadratic);
  const cap = Math.max(1, Math.floor(pts.length / 4));

  let active = pts.map((_, i) => i);
  const flagged: number[] = [];
  while (flagged.length < cap && active.length > MIN_DOTS) {
    const res = leaveOneOutResidualsPx(active.map((i) => pts[i]!), quadratic);
    let w = -1;
    res.forEach((r, k) => { if (Number.isFinite(r) && (w < 0 || r > res[w]!)) w = k; });
    if (w < 0) break;
    const others = active.filter((_, k) => k !== w);
    const rest = leaveOneOutResidualsPx(others.map((i) => pts[i]!), quadratic).filter(Number.isFinite);
    if (rest.length < MIN_DOTS - 1) break;
    const med = median(rest);
    const limit = Math.max(med + 3 * robustSigma(rest), 2 * med);
    if (!(res[w]! > limit)) break;
    flagged.push(active[w]!);
    active = others;
  }
  return { indices: flagged, residualsPx };
}

// ─── Exercises: endpoint pauses + latency-compensated pursuit ───────────────

export interface ExerciseFrame {
  t: number;
  targetX: number;
  targetY: number;
  f: EyeFeatures;
}

export interface ExerciseSample {
  screenX: number;
  screenY: number;
  center: EyeFeatures;
  /** Index into the input frames of the frame closest to the sample's middle. */
  frameIndex: number;
  kind: 'pause' | 'pursuit';
  nFrames: number;
  spanMs: number;
  dispersion: number;
}

export interface ExerciseSamplingResult {
  samples: ExerciseSample[];
  /** Estimated target→feature delay (camera + inference + pursuit lag). */
  lagMs: number;
  lagEstimated: boolean;
}

export const EXERCISE_SAMPLING = {
  /** Consecutive frames with the target this still are one pause. */
  stillTolPx: 0.5,
  minPauseMs: 600,
  pauseOptions: {
    ...DEFAULT_FIXATION_OPTIONS,
    minSettleMs: 250,
    collectMs: 350,
    minFrames: 5,
    fallbackMinFrames: 5,
  } satisfies FixationOptions,
  /** Pursuit is unreliable right after the target starts moving (initiation + catch-up saccade). */
  pursuitOnsetSkipMs: 250,
  lagSearchMaxMs: 400,
  lagStepMs: 10,
  defaultLagMs: 120,
  minLagCorrelation: 0.6,
  pursuitBinMs: 200,
  maxPursuitSamples: 8,
};

function interp(ts: number[], vs: number[], t: number): number {
  if (t <= ts[0]!) return vs[0]!;
  if (t >= ts[ts.length - 1]!) return vs[vs.length - 1]!;
  let lo = 0;
  let hi = ts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ts[mid]! <= t) lo = mid; else hi = mid;
  }
  const span = ts[hi]! - ts[lo]!;
  const a = span > 0 ? (t - ts[lo]!) / span : 0;
  return vs[lo]! + a * (vs[hi]! - vs[lo]!);
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 5) return NaN;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i]! - ma) * (b[i]! - mb);
    saa += (a[i]! - ma) ** 2;
    sbb += (b[i]! - mb) ** 2;
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : NaN;
}

/**
 * Delay τ such that the iris signal at t best matches the target at t − τ.
 * Frames are timestamped when processed, after the camera and the landmark
 * model, and the eye itself trails a moving target — labelling a frame with the
 * target's *current* position biases every pursuit sample along the motion.
 */
export function estimatePursuitLagMs(frames: ExerciseFrame[], moving: boolean[]): { lagMs: number; estimated: boolean } {
  const cfg = EXERCISE_SAMPLING;
  const ts = frames.map((f) => f.t);
  const tx = frames.map((f) => f.targetX);
  const ty = frames.map((f) => f.targetY);
  const idx = frames.map((_, i) => i).filter((i) => moving[i]);
  if (idx.length < 20) return { lagMs: cfg.defaultLagMs, estimated: false };
  const sig = frames.map((f) => gazeSignal(f.f));
  const varOf = (v: number[]) => {
    const m = v.reduce((s, x) => s + x, 0) / v.length;
    return v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length;
  };
  const wx = varOf(idx.map((i) => tx[i]!));
  const wy = varOf(idx.map((i) => ty[i]!));

  let bestLag = cfg.defaultLagMs;
  let bestScore = -Infinity;
  for (let lag = 0; lag <= cfg.lagSearchMaxMs; lag += cfg.lagStepMs) {
    const shiftedX = idx.map((i) => interp(ts, tx, ts[i]! - lag));
    const shiftedY = idx.map((i) => interp(ts, ty, ts[i]! - lag));
    const rx = wx > 1 ? pearson(idx.map((i) => sig[i]![0]!), shiftedX) : NaN;
    const ry = wy > 1 ? pearson(idx.map((i) => sig[i]![1]!), shiftedY) : NaN;
    let num = 0, den = 0;
    if (Number.isFinite(rx)) { num += wx * rx; den += wx; }
    if (Number.isFinite(ry)) { num += wy * ry; den += wy; }
    if (den === 0) continue;
    const score = num / den;
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  const atEdge = bestLag === 0 || bestLag >= cfg.lagSearchMaxMs;
  if (!(bestScore >= cfg.minLagCorrelation) || atEdge) return { lagMs: cfg.defaultLagMs, estimated: false };
  return { lagMs: bestLag, estimated: true };
}

/**
 * Turn one exercise's frame stream into training samples.
 *
 *  • Endpoint pauses (target still ≥ 600 ms) are static calibration dots in
 *    disguise — at the edges and corners, where they are most useful — and are
 *    sampled exactly like grid dots (settle, stable run, median).
 *  • Moving segments are relabelled with the target position τ earlier, skip
 *    the pursuit-onset transient, drop catch-up saccade frames, and are reduced
 *    to short (~200 ms) median bins so each sample sits at a well-defined place.
 */
export function buildExerciseSamples(
  frames: ExerciseFrame[],
  blinkTimes: number[],
  noise: FixationNoiseModel,
): ExerciseSamplingResult {
  const cfg = EXERCISE_SAMPLING;
  if (frames.length < 10) return { samples: [], lagMs: cfg.defaultLagMs, lagEstimated: false };

  const padded = (t: number) =>
    blinkTimes.some((b) => t >= b - DEFAULT_FIXATION_OPTIONS.blinkPreMs && t <= b + DEFAULT_FIXATION_OPTIONS.blinkPostMs);

  // Segment by target motion.
  type Seg = { kind: 'pause' | 'move'; from: number; to: number };
  const segs: Seg[] = [];
  let segStart = 0;
  const still = (i: number) =>
    Math.abs(frames[i]!.targetX - frames[i - 1]!.targetX) <= cfg.stillTolPx &&
    Math.abs(frames[i]!.targetY - frames[i - 1]!.targetY) <= cfg.stillTolPx;
  for (let i = 1; i <= frames.length; i++) {
    const boundary = i === frames.length || still(i) !== still(Math.max(1, segStart + 1));
    if (i === frames.length || (i > segStart + 1 && boundary)) {
      const isStill = segStart + 1 < frames.length ? still(Math.min(frames.length - 1, segStart + 1)) : false;
      segs.push({ kind: isStill ? 'pause' : 'move', from: segStart, to: i - 1 });
      segStart = i;
    }
  }

  const moving = frames.map(() => false);
  for (const s of segs) if (s.kind === 'move') for (let i = s.from; i <= s.to; i++) moving[i] = true;
  const { lagMs, estimated } = estimatePursuitLagMs(frames, moving);

  const samples: ExerciseSample[] = [];

  // Pauses → static dots.
  for (const s of segs) {
    if (s.kind !== 'pause') continue;
    const t0 = frames[s.from]!.t;
    const t1 = frames[s.to]!.t;
    if (t1 - t0 < cfg.minPauseMs) continue;
    const col = new FixationCollector(t0, cfg.pauseOptions, noise);
    for (const b of blinkTimes) if (b >= t0 - 500 && b <= t1 + 500) col.addBlink(b);
    for (let i = s.from; i <= s.to; i++) col.addFrame(frames[i]!.t, frames[i]!.f);
    const res = col.finalize(t1 + cfg.pauseOptions.blinkPreMs);
    if (!res) continue;
    const mid = (res.tStart + res.tEnd) / 2;
    let frameIndex = s.from;
    for (let i = s.from; i <= s.to; i++) if (Math.abs(frames[i]!.t - mid) < Math.abs(frames[frameIndex]!.t - mid)) frameIndex = i;
    samples.push({
      screenX: frames[s.from]!.targetX,
      screenY: frames[s.from]!.targetY,
      center: res.center,
      frameIndex,
      kind: 'pause',
      nFrames: res.frames.length,
      spanMs: res.spanMs,
      dispersion: res.dispersion,
    });
  }

  // Moving segments → latency-compensated pursuit bins.
  const ts = frames.map((f) => f.t);
  const tx = frames.map((f) => f.targetX);
  const ty = frames.map((f) => f.targetY);
  const sig = frames.map((f) => gazeSignal(f.f));
  const moveIdx = frames.map((_, i) => i).filter((i) => moving[i]);
  const diffs = (a: number) => {
    const d: number[] = [];
    for (let k = 1; k < moveIdx.length; k++) {
      const i = moveIdx[k]!;
      if (moveIdx[k - 1] === i - 1) d.push(Math.abs(sig[i]![a]! - sig[i - 1]![a]!));
    }
    return d;
  };
  const jumpTol = GAZE_AXES.map((a) => {
    const d = diffs(a);
    return d.length >= 5 ? Math.max(DEFAULT_FIXATION_OPTIONS.gazeFloor, 5 * 1.4826 * median(d)) : Infinity;
  });

  const skipMs = Math.max(cfg.pursuitOnsetSkipMs, lagMs + 100);
  const bins: { i: number[] }[] = [];
  for (const s of segs) {
    if (s.kind !== 'move') continue;
    const tMoveStart = frames[s.from]!.t;
    let bin: number[] = [];
    let binStart = -Infinity;
    for (let i = s.from; i <= s.to; i++) {
      const t = frames[i]!.t;
      if (t - tMoveStart < skipMs || padded(t)) continue;
      // Catch-up saccade: this frame and the next jump away from the pursuit track.
      const jump = i > 0 && GAZE_AXES.some((a) => Math.abs(sig[i]![a]! - sig[i - 1]![a]!) > jumpTol[a]!);
      const afterJump = i > 1 && GAZE_AXES.some((a) => Math.abs(sig[i - 1]![a]! - sig[i - 2]![a]!) > jumpTol[a]!);
      if (jump || afterJump) continue;
      if (t - binStart > cfg.pursuitBinMs) {
        if (bin.length >= 3) bins.push({ i: bin });
        bin = [];
        binStart = t;
      }
      bin.push(i);
    }
    if (bin.length >= 3) bins.push({ i: bin });
  }

  const step = Math.max(1, bins.length / cfg.maxPursuitSamples);
  for (let k = 0; k < bins.length && samples.filter((x) => x.kind === 'pursuit').length < cfg.maxPursuitSamples; k += step) {
    const b = bins[Math.floor(k)]!;
    const idx = b.i;
    const labelsX = idx.map((i) => interp(ts, tx, ts[i]! - lagMs));
    const labelsY = idx.map((i) => interp(ts, ty, ts[i]! - lagMs));
    const binSig = idx.map((i) => sig[i]!);
    samples.push({
      screenX: median(labelsX),
      screenY: median(labelsY),
      center: medianEyeFeatures(idx.map((i) => frames[i]!.f)),
      frameIndex: idx[idx.length >> 1]!,
      kind: 'pursuit',
      nFrames: idx.length,
      spanMs: frames[idx[idx.length - 1]!]!.t - frames[idx[0]!]!.t,
      dispersion: gazeDispersion(binSig),
    });
  }

  return { samples, lagMs, lagEstimated: estimated };
}

// ─── Point order ────────────────────────────────────────────────────────────

/**
 * Fisher–Yates shuffle. A raster order is predictable (participants anticipate
 * the next dot) and puts a full-width saccade at every row change; a random
 * order removes the anticipation, and the gaze-contingent start absorbs the
 * larger jumps.
 */
export function shuffled<T>(items: readonly T[], rand: () => number = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
