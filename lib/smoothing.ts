export type ChartPoint = { t: number; targetX: number; targetY: number; gazeX: number; gazeY: number };
export type ChartSegment = { patternName: string; points: ChartPoint[] };

export interface ChartSmoothingConfig {
  method: string; // 'NONE' | 'ROBUST' | 'MOVING_AVERAGE' | 'GAUSSIAN'
  window: number;
}

function movingAverage(data: number[], win: number): number[] {
  const half = Math.floor(win / 2);
  return data.map((_, i) => {
    const start = Math.max(0, i - half);
    const end = Math.min(data.length, i + half + 1);
    let sum = 0;
    for (let j = start; j < end; j++) sum += data[j];
    return sum / (end - start);
  });
}

function gaussianKernel(win: number): number[] {
  const sigma = win / 4;
  const center = Math.floor(win / 2);
  const weights = Array.from({ length: win }, (_, i) =>
    Math.exp(-0.5 * ((i - center) / sigma) ** 2)
  );
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => w / total);
}

function gaussianSmooth(data: number[], win: number): number[] {
  const kernel = gaussianKernel(win);
  const half = Math.floor(win / 2);
  return data.map((_, i) => {
    let sum = 0, totalW = 0;
    for (let k = 0; k < win; k++) {
      const idx = i - half + k;
      if (idx >= 0 && idx < data.length) {
        sum += data[idx] * kernel[k];
        totalW += kernel[k];
      }
    }
    return sum / totalW;
  });
}

function applySmoothing(values: number[], cfg: ChartSmoothingConfig): number[] {
  if (cfg.method === 'NONE' || cfg.window < 2) return values;
  if (cfg.method === 'GAUSSIAN') return gaussianSmooth(values, cfg.window);
  // default: MOVING_AVERAGE
  return movingAverage(values, cfg.window);
}

// ─── ROBUST: spike removal that keeps saccades sharp ────────────────────────
//
// Stored gaze has two kinds of jumps that are not eye movements: predictions far
// outside the screen (the mapping extrapolating) and 1–2-sample spikes (landmark
// glitches). Averaging only smears both into bumps. Instead: hold implausible
// samples, replace spikes with the local median (Hampel), then a short centered
// median, which removes what is left without rounding off a real step. Centered
// windows add no lag; this runs on the stored series, never on the live stream.

/** Chart units are % of the viewport; beyond this band the mapping is extrapolating. */
const PLAUSIBLE_MIN_PCT = -25;
const PLAUSIBLE_MAX_PCT = 125;
/** Hampel half-window (samples), threshold (robust σ) and σ floor (% of viewport). */
const HAMPEL_HALF = 3;
const HAMPEL_K = 3;
const HAMPEL_FLOOR_PCT = 1;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

function holdImplausible(xs: number[], ys: number[]): [number[], number[]] {
  const first = xs.findIndex((x, i) => x >= PLAUSIBLE_MIN_PCT && x <= PLAUSIBLE_MAX_PCT && ys[i]! >= PLAUSIBLE_MIN_PCT && ys[i]! <= PLAUSIBLE_MAX_PCT);
  let lx = first >= 0 ? xs[first]! : 50;
  let ly = first >= 0 ? ys[first]! : 50;
  const ox: number[] = [];
  const oy: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]!, y = ys[i]!;
    if (x >= PLAUSIBLE_MIN_PCT && x <= PLAUSIBLE_MAX_PCT && y >= PLAUSIBLE_MIN_PCT && y <= PLAUSIBLE_MAX_PCT) { lx = x; ly = y; }
    ox.push(lx);
    oy.push(ly);
  }
  return [ox, oy];
}

function hampel(values: number[]): number[] {
  return values.map((v, i) => {
    const w = values.slice(Math.max(0, i - HAMPEL_HALF), i + HAMPEL_HALF + 1);
    const m = median(w);
    const sigma = Math.max(HAMPEL_FLOOR_PCT, 1.4826 * median(w.map((x) => Math.abs(x - m))));
    return Math.abs(v - m) > HAMPEL_K * sigma ? m : v;
  });
}

function medianFilter(values: number[], half: number): number[] {
  return values.map((_, i) => median(values.slice(Math.max(0, i - half), i + half + 1)));
}

/** Median half-width from the configured window: 5 → ±2 samples, capped at ±3 so short fixations survive. */
const robustHalf = (window: number) => Math.min(3, Math.max(1, Math.floor(window / 2)));

export function robustSmoothXY(xs: number[], ys: number[], window: number): [number[], number[]] {
  const [hx, hy] = holdImplausible(xs, ys);
  const half = robustHalf(window);
  return [medianFilter(hampel(hx), half), medianFilter(hampel(hy), half)];
}

export function smoothSegment<T extends { patternName: string; points: ChartPoint[] }>(
  seg: T,
  cfg?: ChartSmoothingConfig
): T {
  if (!cfg || cfg.method === 'NONE' || cfg.window < 2) return seg;
  const [gazeXs, gazeYs] = cfg.method === 'ROBUST'
    ? robustSmoothXY(seg.points.map((p) => p.gazeX), seg.points.map((p) => p.gazeY), cfg.window)
    : [applySmoothing(seg.points.map((p) => p.gazeX), cfg), applySmoothing(seg.points.map((p) => p.gazeY), cfg)];
  return {
    ...seg,
    points: seg.points.map((p, i) => ({ ...p, gazeX: gazeXs[i], gazeY: gazeYs[i] })),
  };
}
