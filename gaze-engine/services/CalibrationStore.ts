/**
 * CalibrationStore — manages raw calibration data across collection phases.
 *
 * Separates concerns from App.tsx:
 *   • Buffers per-point feature vectors during collection
 *   • Stores raw EyeFeatures for flag-based re-evaluation
 *   • Applies outlier removal and builds final training arrays
 */

import type { EyeFeatures, FeatureFlags } from './FeatureExtractor';
import { buildFeatureVector } from './FeatureExtractor';
import { DataCleaner, type OutlierMethod } from './RegressionService';
import type { CalibrationSample } from '../core/IGazeEngine';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RawCalibrationEntry {
  screenX: number;
  screenY: number;
  /** Accumulated feature vectors during the dwell period. */
  featureBuffer: number[][];
  /** Averaged EyeFeatures for flag re-evaluation. */
  rawFeatures?: EyeFeatures;
  patternName?: string;
}

export interface CleanCalibrationOptions {
  outlierMethod?: OutlierMethod;
  outlierThreshold?: number;
  flags?: FeatureFlags;
  /**
   * When true, each sample gets a quality weight (0–1) based on:
   *   - Spatial: center-of-screen points weighted higher than corners
   *   - Temporal: later frames in a dwell period weighted higher than early ones
   * Requires screenWidth/screenHeight to compute spatial weights.
   */
  useConfidenceWeights?: boolean;
  screenWidth?: number;
  screenHeight?: number;
}

// ─── Store ───────────────────────────────────────────────────────────────────

export class CalibrationStore {
  private entries: RawCalibrationEntry[] = [];

  /** Start a new collection session; clears all previous data. */
  reset(): void {
    this.entries = [];
  }

  /** Begin collecting for a new target point. */
  addPoint(screenX: number, screenY: number, patternName?: string): void {
    this.entries.push({ screenX, screenY, featureBuffer: [], patternName });
  }

  /** Push a feature vector into the current (last) point's buffer. */
  pushVector(vec: number[]): void {
    const entry = this.entries.at(-1);
    if (entry) entry.featureBuffer.push(vec);
  }

  /** Store averaged raw features for the current point (for re-evaluation). */
  setRawFeatures(features: EyeFeatures): void {
    const entry = this.entries.at(-1);
    if (entry) entry.rawFeatures = features;
  }

  get pointCount(): number { return this.entries.length; }

  /**
   * Build final CalibrationSample[] ready for engine.calibrate().
   * Averages each point's buffer, removes outliers, applies feature flags.
   */
  buildSamples(opts: CleanCalibrationOptions = {}): CalibrationSample[] {
    const {
      outlierMethod = 'NONE',
      outlierThreshold = 0.1,
      flags = {},
      useConfidenceWeights = false,
      screenWidth = 1920,
      screenHeight = 1080,
    } = opts;

    const samples: CalibrationSample[] = [];

    for (const entry of this.entries) {
      if (!entry.featureBuffer.length) continue;

      // Clean per-point buffer
      const cleaned = DataCleaner.clean(entry.featureBuffer, outlierMethod, outlierThreshold);
      if (!cleaned.length) continue;

      // Temporal weighting: later frames in dwell are more stable.
      // Weight ramps from 0.5 (first frame) to 1.0 (last frame).
      const dim = cleaned[0].length;
      let avg: number[];
      if (useConfidenceWeights && cleaned.length > 1) {
        const totalWeight = cleaned.reduce((s, _, i) => s + (0.5 + 0.5 * i / (cleaned.length - 1)), 0);
        avg = new Array<number>(dim).fill(0);
        for (let fi = 0; fi < cleaned.length; fi++) {
          const tw = (0.5 + 0.5 * fi / (cleaned.length - 1)) / totalWeight;
          for (let d = 0; d < dim; d++) avg[d] += cleaned[fi][d] * tw;
        }
      } else {
        avg = new Array<number>(dim).fill(0);
        for (const vec of cleaned) for (let i = 0; i < dim; i++) avg[i] += vec[i] / cleaned.length;
      }

      // Spatial weight: center points are more reliable than corners.
      // Normalized distance from screen center: 0 at center, 1 at corner.
      let weight = 1.0;
      if (useConfidenceWeights) {
        const cx = screenWidth / 2, cy = screenHeight / 2;
        const maxDist = Math.hypot(cx, cy);
        const dist = Math.hypot(entry.screenX - cx, entry.screenY - cy);
        // Weight: 1.0 at center, 0.6 at corners
        weight = 1.0 - 0.4 * (dist / maxDist);
      }

      samples.push({
        screenX: entry.screenX,
        screenY: entry.screenY,
        featureVector: avg,
        rawFeatures: entry.rawFeatures as unknown as Record<string, unknown> | undefined,
        weight,
      });
    }

    return samples;
  }

  /**
   * Re-build samples from stored raw EyeFeatures with new feature flags.
   * Allows changing flags (EAR, blendshapes, etc.) without re-calibrating.
   */
  rebuildWithFlags(flags: FeatureFlags, opts: Omit<CleanCalibrationOptions, 'flags'> = {}): CalibrationSample[] {
    const { outlierMethod = 'NONE', outlierThreshold = 0.1 } = opts;
    const samples: CalibrationSample[] = [];

    for (const entry of this.entries) {
      if (!entry.rawFeatures) continue;
      const vec = buildFeatureVector(entry.rawFeatures, flags);
      samples.push({
        screenX: entry.screenX,
        screenY: entry.screenY,
        featureVector: vec,
        rawFeatures: entry.rawFeatures as unknown as Record<string, unknown>,
      });
    }

    return samples;
  }
}
