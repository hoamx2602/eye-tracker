/**
 * Chart preparation for the Test-mode gaze traces (wiggling, horizontal, …).
 *
 * Outliers are *removed*, not replaced: a sample the mapping could not have
 * produced from a real gaze leaves a gap in the line instead of a substituted
 * value, so nothing is invented. Two kinds are dropped:
 *
 *   • off-screen — beyond ±25% outside the viewport, where the regression is
 *     extrapolating (stored traces reach 1600% of the viewport);
 *   • spikes — a sample more than 3 robust σ from its neighbours (Hampel).
 *
 * Removal runs for every method except NONE (raw), so it does not depend on the
 * smoothing setting. Any smoothing then runs over the surviving samples only.
 */
export type ChartPoint = {
  t: number;
  targetX: number;
  targetY: number;
  /** null = removed as an outlier. */
  gazeX: number | null;
  gazeY: number | null;
};
export type ChartSegment = { patternName: string; points: ChartPoint[] };

export interface ChartSmoothingConfig {
  method: string; // 'NONE' | 'REMOVE_OUTLIERS' | 'MOVING_AVERAGE' | 'GAUSSIAN'
  window: number;
}

/** Chart units are % of the viewport; beyond this band the mapping is extrapolating. */
const PLAUSIBLE_MIN_PCT = -25;
const PLAUSIBLE_MAX_PCT = 125;
/** Hampel half-window (samples), threshold (robust σ) and σ floor (% of viewport). */
const HAMPEL_HALF = 3;
const HAMPEL_K = 3;
const HAMPEL_FLOOR_PCT = 1;
/** A there-and-back excursion smaller than this is ordinary gaze noise, not a spike (% of viewport). */
const SPIKE_FLOOR_PCT = 3;

type Series = (number | null)[];

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** Indices whose value is more than HAMPEL_K robust σ away from their neighbourhood. */
function hampelOutliers(values: Series): Set<number> {
  const flagged = new Set<number>();
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!isNum(v)) continue;
    const window: number[] = [];
    for (let j = Math.max(0, i - HAMPEL_HALF); j <= Math.min(values.length - 1, i + HAMPEL_HALF); j++) {
      const w = values[j];
      if (isNum(w)) window.push(w);
    }
    if (window.length < 3) continue;
    const m = median(window);
    const sigma = Math.max(HAMPEL_FLOOR_PCT, 1.4826 * median(window.map((x) => Math.abs(x - m))));
    if (Math.abs(v - m) > HAMPEL_K * sigma) flagged.add(i);
  }
  return flagged;
}

/**
 * Indices that jump away from both neighbours and back: the neighbours agree
 * with each other, the sample between them does not.
 *
 * Hampel alone misses these while the eye is moving fast, because the spread it
 * measures over its window is then large. A real saccade is monotone — its
 * neighbours sit far apart — so requiring the neighbours to agree keeps steps
 * intact.
 */
function returnSpikes(values: Series): Set<number> {
  const flagged = new Set<number>();
  for (let i = 1; i < values.length - 1; i++) {
    const a = values[i - 1], b = values[i], c = values[i + 1];
    if (!isNum(a) || !isNum(b) || !isNum(c)) continue;
    const excursion = Math.abs(b - (a + c) / 2);
    const neighbourGap = Math.abs(c - a);
    if (excursion > SPIKE_FLOOR_PCT && excursion > 2 * neighbourGap) flagged.add(i);
  }
  return flagged;
}

/**
 * Drop the samples that are not plausible gaze. Both axes of a sample go
 * together: half a coordinate is not a position.
 */
export function removeOutliers(xs: Series, ys: Series): { xs: Series; ys: Series; removed: number } {
  const offScreen = (v: number | null) => !isNum(v) || v < PLAUSIBLE_MIN_PCT || v > PLAUSIBLE_MAX_PCT;
  const plausibleX: Series = xs.map((v, i) => (offScreen(v) || offScreen(ys[i]!) ? null : v));
  const plausibleY: Series = ys.map((v, i) => (plausibleX[i] === null ? null : v));

  const flagged = new Set<number>([
    ...hampelOutliers(plausibleX), ...hampelOutliers(plausibleY),
    ...returnSpikes(plausibleX), ...returnSpikes(plausibleY),
  ]);
  let removed = 0;
  const outX = plausibleX.map((v, i) => (flagged.has(i) ? null : v));
  const outY = plausibleY.map((v, i) => (flagged.has(i) ? null : v));
  for (let i = 0; i < xs.length; i++) if (isNum(xs[i]) && !isNum(outX[i])) removed++;
  return { xs: outX, ys: outY, removed };
}

/** Removed samples stay removed; the others are averaged over their surviving neighbours. */
function movingAverage(values: Series, win: number): Series {
  const half = Math.floor(win / 2);
  return values.map((v, i) => {
    if (!isNum(v)) return null;
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) {
      const w = values[j];
      if (isNum(w)) { sum += w; n++; }
    }
    return n ? sum / n : v;
  });
}

function gaussianSmooth(values: Series, win: number): Series {
  const sigma = win / 4;
  const half = Math.floor(win / 2);
  return values.map((v, i) => {
    if (!isNum(v)) return null;
    let sum = 0;
    let totalW = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) {
      const w = values[j];
      if (!isNum(w)) continue;
      const weight = Math.exp(-0.5 * ((j - i) / sigma) ** 2);
      sum += w * weight;
      totalW += weight;
    }
    return totalW ? sum / totalW : v;
  });
}

function applySmoothing(values: Series, cfg: ChartSmoothingConfig): Series {
  if (cfg.window < 2) return values;
  if (cfg.method === 'GAUSSIAN') return gaussianSmooth(values, cfg.window);
  if (cfg.method === 'MOVING_AVERAGE') return movingAverage(values, cfg.window);
  return values; // REMOVE_OUTLIERS: removal only
}

/** Outlier removal (unless NONE) plus any configured smoothing. Never mutates the input. */
export function smoothSegment<T extends { patternName: string; points: ChartPoint[] }>(
  seg: T,
  cfg?: ChartSmoothingConfig
): T {
  const method = cfg?.method ?? 'REMOVE_OUTLIERS';
  if (method === 'NONE') return seg;
  const cleaned = removeOutliers(seg.points.map((p) => p.gazeX), seg.points.map((p) => p.gazeY));
  const gazeXs = applySmoothing(cleaned.xs, { method, window: cfg?.window ?? 0 });
  const gazeYs = applySmoothing(cleaned.ys, { method, window: cfg?.window ?? 0 });
  return {
    ...seg,
    points: seg.points.map((p, i) => ({ ...p, gazeX: gazeXs[i] ?? null, gazeY: gazeYs[i] ?? null })),
  };
}

/** How many samples the removal drops — for captions and reports. */
export function countOutliers(points: ChartPoint[]): number {
  return removeOutliers(points.map((p) => p.gazeX), points.map((p) => p.gazeY)).removed;
}
