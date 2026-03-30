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
    } = opts;

    const samples: CalibrationSample[] = [];

    for (const entry of this.entries) {
      if (!entry.featureBuffer.length) continue;

      // Clean per-point buffer
      const cleaned = DataCleaner.clean(entry.featureBuffer, outlierMethod, outlierThreshold);
      if (!cleaned.length) continue;

      // Average across frames collected at this point
      const dim = cleaned[0].length;
      const avg = new Array<number>(dim).fill(0);
      for (const vec of cleaned) for (let i = 0; i < dim; i++) avg[i] += vec[i] / cleaned.length;

      samples.push({
        screenX: entry.screenX,
        screenY: entry.screenY,
        featureVector: avg,
        rawFeatures: entry.rawFeatures as unknown as Record<string, unknown> | undefined,
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
