/**
 * GazeSmoother — 2-D gaze signal processor.
 *
 * Wraps OneEuro / MovingAverage / Kalman filters with two behavioural layers:
 *   1. Saccade detection  — resets filters on fast jumps so the cursor snaps
 *      immediately instead of "chasing its tail".
 *   2. Fixation boosting  — strengthens smoothing when gaze is stable, damping
 *      micro-tremor without adding perceptible lag during movement.
 */

import { OneEuroFilter } from './OneEuroFilter';

// ─── Lightweight MA and Kalman (no external dep) ────────────────────────────

class MovingAverageFilter {
  private buf: number[] = [];
  constructor(private size = 5) {}

  filter(v: number): number {
    this.buf.push(v);
    if (this.buf.length > this.size) this.buf.shift();
    return this.buf.reduce((a, b) => a + b, 0) / this.buf.length;
  }

  updateSize(size: number): void {
    this.size = size;
    if (this.buf.length > size) this.buf = this.buf.slice(-size);
  }

  reset(): void { this.buf = []; }
}

class KalmanFilter {
  private x = 0;
  private p = 0;
  private initialized = false;
  constructor(private Q = 0.01, private R = 0.1) {}

  filter(v: number): number {
    if (!this.initialized) { this.x = v; this.p = 1; this.initialized = true; return v; }
    this.p += this.Q;
    const k = this.p / (this.p + this.R);
    this.x += k * (v - this.x);
    this.p = (1 - k) * this.p;
    return this.x;
  }

  updateParams(Q: number, R: number): void { this.Q = Q; this.R = R; }
  reset(): void { this.initialized = false; this.x = 0; this.p = 0; }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export type SmootherMethod = 'ONE_EURO' | 'MOVING_AVERAGE' | 'KALMAN' | 'NONE';

export interface SmootherConfig {
  method?: SmootherMethod;
  minCutoff?: number;
  beta?: number;
  maWindow?: number;
  kalmanQ?: number;
  kalmanR?: number;
  /** Pixel jump threshold that triggers saccade detection. Default 50. */
  saccadeThreshold?: number;
}

export class GazeSmoother {
  private method: SmootherMethod = 'ONE_EURO';
  private saccadeThreshold = 50;

  // Fixation detection: last N raw positions; variance < threshold = stable gaze
  private rawBuf: { x: number; y: number }[] = [];
  private static readonly FIX_BUF   = 8;     // frames
  private static readonly FIX_VAR   = 400;   // px² (~20 px std-dev)
  private static readonly FIX_BOOST = 2.0;   // OneEuro minCutoff multiplier

  private lastX = 0;
  private lastY = 0;

  // Filters
  private readonly oeX: OneEuroFilter;
  private readonly oeY: OneEuroFilter;
  private readonly maX = new MovingAverageFilter(5);
  private readonly maY = new MovingAverageFilter(5);
  private readonly kalX = new KalmanFilter(0.01, 0.1);
  private readonly kalY = new KalmanFilter(0.01, 0.1);

  constructor(config: SmootherConfig = {}) {
    const { minCutoff = 0.005, beta = 0.01 } = config;
    this.oeX = new OneEuroFilter({ minCutoff, beta });
    this.oeY = new OneEuroFilter({ minCutoff, beta });
    this.updateConfig(config);
  }

  updateConfig(cfg: SmootherConfig): void {
    if (cfg.method) this.method = cfg.method;
    if (cfg.saccadeThreshold !== undefined) this.saccadeThreshold = cfg.saccadeThreshold;
    if (cfg.minCutoff !== undefined || cfg.beta !== undefined) {
      this.oeX.updateParams(cfg.minCutoff ?? this.oeX.minCutoff, cfg.beta ?? this.oeX.beta);
      this.oeY.updateParams(cfg.minCutoff ?? this.oeY.minCutoff, cfg.beta ?? this.oeY.beta);
    }
    if (cfg.maWindow !== undefined) { this.maX.updateSize(cfg.maWindow); this.maY.updateSize(cfg.maWindow); }
    if (cfg.kalmanQ !== undefined || cfg.kalmanR !== undefined) {
      this.kalX.updateParams(cfg.kalmanQ ?? 0.01, cfg.kalmanR ?? 0.1);
      this.kalY.updateParams(cfg.kalmanQ ?? 0.01, cfg.kalmanR ?? 0.1);
    }
  }

  /** Detect stable gaze from last N raw positions. */
  private inFixation(): boolean {
    if (this.rawBuf.length < GazeSmoother.FIX_BUF) return false;
    const mx = this.rawBuf.reduce((s, p) => s + p.x, 0) / this.rawBuf.length;
    const my = this.rawBuf.reduce((s, p) => s + p.y, 0) / this.rawBuf.length;
    const variance = this.rawBuf.reduce((s, p) => s + (p.x - mx) ** 2 + (p.y - my) ** 2, 0) / this.rawBuf.length;
    return variance < GazeSmoother.FIX_VAR;
  }

  process(x: number, y: number, timestamp: number): { x: number; y: number } {
    // 1. Accumulate raw buffer for fixation detection
    this.rawBuf.push({ x, y });
    if (this.rawBuf.length > GazeSmoother.FIX_BUF) this.rawBuf.shift();

    // 2. Saccade detection — snap immediately, no filter lag
    const dist = Math.hypot(x - this.lastX, y - this.lastY);
    if (dist > this.saccadeThreshold) {
      this.oeX.reset(); this.oeY.reset();
      this.kalX.reset(); this.kalY.reset();
      this.maX.reset(); this.maY.reset();
      this.rawBuf = [{ x, y }];
    }

    // 3. Fixation boost: heavier OneEuro smoothing during stable gaze
    const stable = dist <= this.saccadeThreshold && this.inFixation();
    if (stable && this.method === 'ONE_EURO') {
      const bx = this.oeX.minCutoff, by = this.oeY.minCutoff;
      this.oeX.minCutoff = bx * GazeSmoother.FIX_BOOST;
      this.oeY.minCutoff = by * GazeSmoother.FIX_BOOST;
      const result = { x: this.oeX.filter(x, timestamp), y: this.oeY.filter(y, timestamp) };
      this.oeX.minCutoff = bx; this.oeY.minCutoff = by;
      this.lastX = result.x; this.lastY = result.y;
      return result;
    }

    // 4. Normal filtering
    let result = { x, y };
    switch (this.method) {
      case 'ONE_EURO':
        result = { x: this.oeX.filter(x, timestamp), y: this.oeY.filter(y, timestamp) };
        break;
      case 'MOVING_AVERAGE':
        result = { x: this.maX.filter(x), y: this.maY.filter(y) };
        break;
      case 'KALMAN':
        result = { x: this.kalX.filter(x), y: this.kalY.filter(y) };
        break;
    }

    this.lastX = result.x; this.lastY = result.y;
    return result;
  }

  reset(): void {
    this.oeX.reset(); this.oeY.reset();
    this.maX.reset(); this.maY.reset();
    this.kalX.reset(); this.kalY.reset();
    this.lastX = 0; this.lastY = 0;
    this.rawBuf = [];
  }
}
