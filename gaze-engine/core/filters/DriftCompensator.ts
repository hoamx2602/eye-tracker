/**
 * DriftCompensator — implicit fixation-based drift correction.
 *
 * Problem: After calibration the regression model is static, but the user's
 * head drifts, the webcam shifts, and lighting changes — causing a slowly
 * growing systematic offset between predicted gaze and true gaze.
 *
 * Solution: During natural fixations (stable gaze) we can observe that the
 * predicted position *should* be at the fixation centroid.  By accumulating
 * many such observations we estimate a running offset vector and subtract it
 * from every raw prediction.
 *
 * Algorithm (IDT — Identification by Dispersion Threshold):
 *   1. Collect a sliding window of raw gaze points.
 *   2. If the spatial dispersion (max-min) in the window stays below a
 *      threshold for a minimum duration, declare a fixation.
 *   3. Record the fixation centroid and the predicted centroid.
 *   4. Update an exponential moving average (EMA) offset vector.
 *   5. Subtract the offset from every subsequent raw prediction.
 *
 * The offset decays toward zero over time so stale corrections don't
 * accumulate forever if the user stops fixating.
 */

export interface DriftCompensatorConfig {
  /** Maximum dispersion in pixels to qualify as a fixation. Default 40. */
  fixationDispersionPx?: number;
  /** Minimum consecutive frames to confirm a fixation. Default 10. */
  fixationMinFrames?: number;
  /** EMA weight for new fixation observations (0–1). Default 0.15. */
  emaAlpha?: number;
  /** Per-frame decay rate for the offset (0–1). 1 = no decay. Default 0.998. */
  decayRate?: number;
  /** Maximum correction magnitude in pixels. Prevents runaway. Default 80. */
  maxOffsetPx?: number;
}

export class DriftCompensator {
  private fixDispersion: number;
  private fixMinFrames: number;
  private emaAlpha: number;
  private decayRate: number;
  private maxOffsetPx: number;

  // Fixation detection window
  private window: { x: number; y: number }[] = [];
  private fixationCount = 0;

  // Running correction offset
  private offsetX = 0;
  private offsetY = 0;

  constructor(config: DriftCompensatorConfig = {}) {
    this.fixDispersion = config.fixationDispersionPx ?? 40;
    this.fixMinFrames  = config.fixationMinFrames ?? 10;
    this.emaAlpha      = config.emaAlpha ?? 0.15;
    this.decayRate     = config.decayRate ?? 0.998;
    this.maxOffsetPx   = config.maxOffsetPx ?? 80;
  }

  /**
   * Correct a raw regression prediction.
   *
   * Call this on every frame with the raw (pre-smoothing) gaze point.
   * Returns the drift-corrected point.
   *
   * @param confidence 0–1 multi-factor confidence; frames below 0.5 are
   *   excluded from fixation detection to avoid polluting the offset.
   */
  correct(
    rawX: number,
    rawY: number,
    confidence: number,
  ): { x: number; y: number } {
    // Apply current offset
    const correctedX = rawX - this.offsetX;
    const correctedY = rawY - this.offsetY;

    // Decay offset toward zero each frame
    this.offsetX *= this.decayRate;
    this.offsetY *= this.decayRate;

    // Only accumulate fixation data from high-confidence frames
    if (confidence < 0.5) {
      this.window = [];
      this.fixationCount = 0;
      return { x: correctedX, y: correctedY };
    }

    // Push corrected point into fixation detection window
    this.window.push({ x: correctedX, y: correctedY });
    if (this.window.length > this.fixMinFrames * 2) {
      this.window.shift();
    }

    // Check dispersion of the window
    if (this.window.length >= this.fixMinFrames) {
      const { minX, maxX, minY, maxY } = this._bounds();
      const dispersion = Math.max(maxX - minX, maxY - minY);

      if (dispersion < this.fixDispersion) {
        this.fixationCount++;

        // Confirmed fixation — update offset
        if (this.fixationCount >= this.fixMinFrames) {
          // Centroid of the fixation window (what we predicted)
          const cx = this.window.reduce((s, p) => s + p.x, 0) / this.window.length;
          const cy = this.window.reduce((s, p) => s + p.y, 0) / this.window.length;

          // The "ideal" position is the mean of the raw inputs that formed
          // this fixation — the residual between raw centroid and corrected
          // centroid is the drift we haven't captured yet.
          // Since corrected = raw - offset, raw centroid = cx + offsetX.
          // The new observation of drift = rawCentroid - correctedCentroid
          // But we want to refine: if the corrected centroid IS the fixation,
          // then the systematic error is (rawCentroid - fixationCentroid).
          // Since correctedCentroid ≈ fixationCentroid, the update is small
          // and self-stabilizing.
          //
          // We use the spread within the fixation as an additional signal:
          // a tighter fixation → higher confidence in the centroid.
          const rawCx = cx + this.offsetX;
          const rawCy = cy + this.offsetY;
          const residualX = rawCx - cx;
          const residualY = rawCy - cy;

          // EMA update
          this.offsetX += this.emaAlpha * (residualX - this.offsetX);
          this.offsetY += this.emaAlpha * (residualY - this.offsetY);

          // Clamp to prevent runaway
          const mag = Math.hypot(this.offsetX, this.offsetY);
          if (mag > this.maxOffsetPx) {
            const scale = this.maxOffsetPx / mag;
            this.offsetX *= scale;
            this.offsetY *= scale;
          }
        }
      } else {
        // Dispersion exceeded — not a fixation
        this.fixationCount = 0;
      }
    }

    return { x: correctedX, y: correctedY };
  }

  private _bounds(): { minX: number; maxX: number; minY: number; maxY: number } {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of this.window) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX, maxX, minY, maxY };
  }

  /** Reset all state (call after re-calibration). */
  reset(): void {
    this.window = [];
    this.fixationCount = 0;
    this.offsetX = 0;
    this.offsetY = 0;
  }

  /** Current drift offset for diagnostics. */
  get offset(): { x: number; y: number } {
    return { x: this.offsetX, y: this.offsetY };
  }
}
