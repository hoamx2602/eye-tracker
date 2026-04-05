/**
 * ImagePreprocessor — lightweight image conditioning for webcam frames.
 *
 * Runs inside a Web Worker using OffscreenCanvas. Two processing tiers:
 *
 *   Tier 1 (always on, ~0ms): GPU-backed CSS filter for contrast/brightness.
 *   Tier 2 (adaptive, ~2-4ms): Unsharp mask sharpening, only applied when
 *     the frame is detected as blurry via Laplacian variance on the eye region.
 *
 * The preprocessor auto-calibrates during the first N frames: it measures
 * baseline sharpness and brightness, then decides whether to enable
 * enhancement. This avoids wasting CPU on cameras that already produce
 * sharp images.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PreprocessorConfig {
  /** Enable contrast/brightness auto-enhancement. Default true. */
  enableContrastBoost?: boolean;
  /** Enable adaptive sharpening for blurry cameras. Default true. */
  enableSharpening?: boolean;
  /** Laplacian variance threshold below which a frame is considered blurry.
   *  Lower = more permissive. Default 15. */
  blurThreshold?: number;
  /** Number of initial frames to profile the camera. Default 30. */
  probeFrames?: number;
}

export interface FrameQualityInfo {
  /** Laplacian variance of the eye region (higher = sharper). */
  sharpness: number;
  /** Average brightness of the eye region (0–255). */
  brightness: number;
  /** Whether sharpening was applied to this frame. */
  wasSharpened: boolean;
  /** Whether contrast boost was applied. */
  wasContrastBoosted: boolean;
}

// ─── Preprocessor ────────────────────────────────────────────────────────────

export class ImagePreprocessor {
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;
  private enableContrastBoost: boolean;
  private enableSharpening: boolean;
  private blurThreshold: number;

  // Auto-calibration state
  private probeFrames: number;
  private probeCount = 0;
  private sharpnessAccum = 0;
  private brightnessAccum = 0;
  private baselineSharpness = 0;
  private baselineBrightness = 128;
  private calibrated = false;

  // Adaptive decisions (set after calibration)
  private needsContrast = false;
  private needsSharpening = false;

  constructor(config: PreprocessorConfig = {}) {
    this.enableContrastBoost = config.enableContrastBoost ?? true;
    this.enableSharpening = config.enableSharpening ?? true;
    this.blurThreshold = config.blurThreshold ?? 15;
    this.probeFrames = config.probeFrames ?? 30;
  }

  /**
   * Process a frame before feeding to MediaPipe.
   *
   * Returns the (possibly enhanced) ImageBitmap. If no processing is needed,
   * returns the original bitmap untouched (zero cost).
   */
  async process(bitmap: ImageBitmap): Promise<{ bitmap: ImageBitmap; quality: FrameQualityInfo }> {
    const w = bitmap.width, h = bitmap.height;

    // Ensure canvas exists and matches frame size
    if (!this.canvas || this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas = new OffscreenCanvas(w, h);
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    }
    const ctx = this.ctx!;

    // Draw original frame
    ctx.filter = 'none';
    ctx.drawImage(bitmap, 0, 0);

    // Measure eye region quality (center band, roughly where eyes are)
    const eyeRegion = this._getEyeRegionData(ctx, w, h);
    const sharpness = this._laplacianVariance(eyeRegion.data, eyeRegion.width, eyeRegion.height);
    const brightness = this._averageBrightness(eyeRegion.data);

    const quality: FrameQualityInfo = {
      sharpness,
      brightness,
      wasSharpened: false,
      wasContrastBoosted: false,
    };

    // Auto-calibration phase: profile camera for N frames
    if (!this.calibrated) {
      this.sharpnessAccum += sharpness;
      this.brightnessAccum += brightness;
      this.probeCount++;

      if (this.probeCount >= this.probeFrames) {
        this.baselineSharpness = this.sharpnessAccum / this.probeCount;
        this.baselineBrightness = this.brightnessAccum / this.probeCount;
        this.calibrated = true;

        // Decide what this camera needs
        this.needsSharpening = this.enableSharpening && this.baselineSharpness < this.blurThreshold;
        this.needsContrast = this.enableContrastBoost && (
          this.baselineBrightness < 80 || this.baselineBrightness > 200
        );
      }
      // During probing, return original untouched
      return { bitmap, quality };
    }

    // If camera is fine, skip all processing (zero overhead)
    if (!this.needsContrast && !this.needsSharpening) {
      return { bitmap, quality };
    }

    // ── Tier 1: Contrast/Brightness boost (GPU-backed CSS filter) ────────
    let applied = false;
    if (this.needsContrast) {
      const contrastFactor = this.baselineBrightness < 80 ? 1.3 : 1.1;
      const brightnessFactor = this.baselineBrightness < 80 ? 1.15 : 0.95;
      ctx.filter = `contrast(${contrastFactor}) brightness(${brightnessFactor})`;
      ctx.drawImage(this.canvas, 0, 0);
      ctx.filter = 'none';
      quality.wasContrastBoosted = true;
      applied = true;
    }

    // ── Tier 2: Adaptive sharpening (unsharp mask) ───────────────────────
    // Only sharpen if this frame is actually blurry (not every frame)
    if (this.needsSharpening && sharpness < this.blurThreshold * 1.5) {
      this._applyUnsharpMask(ctx, w, h, 0.4);
      quality.wasSharpened = true;
      applied = true;
    }

    if (!applied) {
      return { bitmap, quality };
    }

    // Create new bitmap from processed canvas
    const processed = this.canvas.transferToImageBitmap();
    bitmap.close(); // release original
    return { bitmap: processed, quality };
  }

  /**
   * Extract eye region ImageData (horizontal center band, top 30-50% of frame).
   * Eyes are typically in this zone — measuring the full frame would include
   * background noise that inflates sharpness estimates.
   */
  private _getEyeRegionData(
    ctx: OffscreenCanvasRenderingContext2D, w: number, h: number,
  ): { data: Uint8ClampedArray; width: number; height: number } {
    const rx = Math.floor(w * 0.2);
    const ry = Math.floor(h * 0.25);
    const rw = Math.floor(w * 0.6);
    const rh = Math.floor(h * 0.25);
    const imgData = ctx.getImageData(rx, ry, rw, rh);
    return { data: imgData.data, width: rw, height: rh };
  }

  /**
   * Laplacian variance — a fast focus/sharpness metric.
   *
   * Convolves a 3×3 Laplacian kernel over grayscale pixels and returns the
   * variance of the response. High variance = sharp edges; low = blurry.
   * Runs on the eye region only (~100×60 pixels at 640p) so cost is minimal.
   */
  private _laplacianVariance(data: Uint8ClampedArray, w: number, h: number): number {
    // Convert to grayscale (luminance)
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const off = i * 4;
      gray[i] = 0.299 * data[off] + 0.587 * data[off + 1] + 0.114 * data[off + 2];
    }

    // 3×3 Laplacian kernel: [0 1 0; 1 -4 1; 0 1 0]
    let sum = 0, sumSq = 0, count = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const lap = -4 * gray[y * w + x]
          + gray[(y - 1) * w + x]
          + gray[(y + 1) * w + x]
          + gray[y * w + x - 1]
          + gray[y * w + x + 1];
        sum += lap;
        sumSq += lap * lap;
        count++;
      }
    }
    if (count === 0) return 0;
    const mean = sum / count;
    return sumSq / count - mean * mean;
  }

  /** Average brightness (grayscale mean) of RGBA pixel data. */
  private _averageBrightness(data: Uint8ClampedArray): number {
    let sum = 0;
    const pixels = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    return sum / pixels;
  }

  /**
   * Unsharp mask sharpening — the standard photographic sharpening method.
   *
   * Algorithm: sharp = original + amount × (original - blur(original))
   *
   * Uses a lightweight 3×3 box blur as the base. The `amount` parameter
   * controls intensity (0.3–0.6 is typical for webcams).
   */
  private _applyUnsharpMask(
    ctx: OffscreenCanvasRenderingContext2D,
    w: number, h: number,
    amount: number,
  ): void {
    const imgData = ctx.getImageData(0, 0, w, h);
    const src = imgData.data;
    const out = new Uint8ClampedArray(src.length);

    // For each pixel, compute 3×3 box blur then apply unsharp mask
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) {
          // 3×3 box blur (average of 9 neighbors)
          const blur = (
            src[((y-1)*w + x-1)*4 + c] + src[((y-1)*w + x)*4 + c] + src[((y-1)*w + x+1)*4 + c] +
            src[(y*w + x-1)*4 + c]      + src[idx + c]              + src[(y*w + x+1)*4 + c] +
            src[((y+1)*w + x-1)*4 + c] + src[((y+1)*w + x)*4 + c] + src[((y+1)*w + x+1)*4 + c]
          ) / 9;
          // Unsharp mask: original + amount * (original - blur)
          out[idx + c] = Math.max(0, Math.min(255, src[idx + c] + amount * (src[idx + c] - blur)));
        }
        out[idx + 3] = src[idx + 3]; // alpha unchanged
      }
    }

    // Copy border pixels unchanged
    for (let x = 0; x < w; x++) {
      const topIdx = x * 4, botIdx = ((h-1) * w + x) * 4;
      for (let c = 0; c < 4; c++) { out[topIdx+c] = src[topIdx+c]; out[botIdx+c] = src[botIdx+c]; }
    }
    for (let y = 0; y < h; y++) {
      const lIdx = (y*w) * 4, rIdx = (y*w + w-1) * 4;
      for (let c = 0; c < 4; c++) { out[lIdx+c] = src[lIdx+c]; out[rIdx+c] = src[rIdx+c]; }
    }

    imgData.data.set(out);
    ctx.putImageData(imgData, 0, 0);
  }

  /** Reset calibration state (e.g. when camera changes). */
  reset(): void {
    this.calibrated = false;
    this.probeCount = 0;
    this.sharpnessAccum = 0;
    this.brightnessAccum = 0;
    this.needsContrast = false;
    this.needsSharpening = false;
  }
}
