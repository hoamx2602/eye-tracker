/**
 * Zero-lag gates on the live gaze stream (TRACKING / NEURO_FLOW).
 *
 * Both only *drop* a frame — the last output is held — and never delay one, so
 * saccade latency and peak-velocity measurements are untouched. Spike removal
 * that needs look-ahead (Hampel, median) belongs to the charts, where the whole
 * series is available: see lib/smoothing.ts (ROBUST). A causal spike filter on
 * the live stream mistakes the first samples of every real saccade for a spike
 * and delays it by two samples (measured: 133 ms at 15 Hz).
 */
import type { EyeFeatures } from '@/types';
import { median } from '@/lib/fixationSampling';

/**
 * How far past the screen edge (fraction of width/height) a prediction may land
 * and still count as gaze. Beyond it the regressor is extrapolating outside the
 * calibrated range; stored Test-mode trajectories reach 1600% of the viewport.
 */
export const PLAUSIBLE_GAZE_MARGIN = 0.25;

export function isPlausibleGaze(x: number, y: number, width: number, height: number, margin = PLAUSIBLE_GAZE_MARGIN): boolean {
  return Number.isFinite(x) && Number.isFinite(y)
    && x >= -margin * width && x <= (1 + margin) * width
    && y >= -margin * height && y <= (1 + margin) * height;
}

/**
 * Partial blinks never cross the fixed blink threshold but still pull the iris
 * landmark down. A frame whose eye aperture (min EAR of both eyes) drops below
 * `ratio` × the median of the last `windowMs` is treated as one.
 *
 * Every frame joins the reference, so a lasting change of aperture (looking
 * down, squinting) becomes the new normal within half the window instead of
 * being rejected for good; a blink (100–400 ms) is shorter than that and stays
 * detectable.
 */
export class PartialBlinkGate {
  private ears: { t: number; ear: number }[] = [];

  constructor(
    private readonly windowMs = 1000,
    private readonly ratio = 0.65,
    private readonly minSamples = 8,
  ) {}

  isPartialBlink(f: Pick<EyeFeatures, 'leftEAR' | 'rightEAR'>, t: number): boolean {
    const ear = Math.min(f.leftEAR, f.rightEAR);
    if (!Number.isFinite(ear)) return false;
    while (this.ears.length && this.ears[0]!.t < t - this.windowMs) this.ears.shift();
    const partial = this.ears.length >= this.minSamples && ear < this.ratio * median(this.ears.map((e) => e.ear));
    this.ears.push({ t, ear });
    return partial;
  }

  reset(): void {
    this.ears = [];
  }
}
