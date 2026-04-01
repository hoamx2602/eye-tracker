export type ChartPoint = { t: number; targetX: number; targetY: number; gazeX: number; gazeY: number };
export type ChartSegment = { patternName: string; points: ChartPoint[] };

export interface ChartSmoothingConfig {
  method: string; // 'NONE' | 'MOVING_AVERAGE' | 'GAUSSIAN'
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

export function smoothSegment<T extends { patternName: string; points: ChartPoint[] }>(
  seg: T,
  cfg?: ChartSmoothingConfig
): T {
  if (!cfg || cfg.method === 'NONE' || cfg.window < 2) return seg;
  const gazeXs = applySmoothing(seg.points.map((p) => p.gazeX), cfg);
  const gazeYs = applySmoothing(seg.points.map((p) => p.gazeY), cfg);
  return {
    ...seg,
    points: seg.points.map((p, i) => ({ ...p, gazeX: gazeXs[i], gazeY: gazeYs[i] })),
  };
}
