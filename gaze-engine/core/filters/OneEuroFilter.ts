/**
 * One Euro Filter — adaptive low-pass filter for real-time noisy signals.
 *
 * Key idea: use a velocity-aware cutoff frequency so the filter is
 * aggressive (heavy smoothing) when the signal is slow/static,
 * but responsive (light smoothing) when the signal moves fast.
 *
 * Reference: Casiez, G., Roussel, N., & Vogel, D. (2012).
 * "1€ Filter: A Simple Speed-based Low-pass Filter for Noisy Input in
 * Interactive Systems." ACM CHI 2012.
 */

/** Internal first-order low-pass filter used by OneEuroFilter. */
class LowPassFilter {
  /** Filtered state. */
  s: number;

  constructor(initVal = 0) {
    this.s = initVal;
  }

  filterWithAlpha(value: number, alpha: number): number {
    this.s = alpha * value + (1 - alpha) * this.s;
    return this.s;
  }

  reset(val = 0): void {
    this.s = val;
  }
}

export interface OneEuroConfig {
  /** Minimum cutoff frequency (Hz). Lower = smoother when still. Default 0.005. */
  minCutoff?: number;
  /** Speed coefficient. Higher = faster response to movement. Default 0.01. */
  beta?: number;
  /** Derivative cutoff (Hz). Controls how fast velocity estimate reacts. Default 1.0. */
  dcutoff?: number;
}

export class OneEuroFilter {
  minCutoff: number;
  beta: number;
  private readonly dcutoff: number;
  private readonly xFilter: LowPassFilter;
  private readonly dxFilter: LowPassFilter;
  private tPrev = 0;

  constructor({ minCutoff = 0.005, beta = 0.01, dcutoff = 1.0 }: OneEuroConfig = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dcutoff = dcutoff;
    this.xFilter = new LowPassFilter(0);
    this.dxFilter = new LowPassFilter(0);
  }

  /**
   * Compute alpha (smoothing coefficient) from cutoff frequency and time step.
   * @param cutoff - Frequency in Hz.
   * @param dt     - Time delta in seconds.
   */
  private alpha(cutoff: number, dt: number): number {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  /**
   * Filter a single scalar value.
   * @param value     - Raw measurement.
   * @param timestamp - performance.now() at measurement time (ms).
   */
  filter(value: number, timestamp: number): number {
    if (this.tPrev === 0) {
      this.tPrev = timestamp;
      this.xFilter.s = value;
      this.dxFilter.s = 0;
      return value;
    }

    let dt = (timestamp - this.tPrev) / 1000;
    if (dt <= 0) dt = 0.001; // guard against duplicate timestamps

    // Estimate derivative (velocity)
    const dx = (value - this.xFilter.s) / dt;
    const edx = this.dxFilter.filterWithAlpha(dx, this.alpha(this.dcutoff, dt));

    // Velocity-adaptive cutoff: higher speed → higher cutoff → less smoothing
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const result = this.xFilter.filterWithAlpha(value, this.alpha(cutoff, dt));
    this.tPrev = timestamp;
    return result;
  }

  updateParams(minCutoff: number, beta: number): void {
    this.minCutoff = minCutoff;
    this.beta = beta;
  }

  reset(): void {
    this.tPrev = 0;
    this.xFilter.reset(0);
    this.dxFilter.reset(0);
  }
}
