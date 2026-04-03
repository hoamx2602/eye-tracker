/**
 * AutoConfigManager — environment-aware configuration recommender.
 *
 * During a short probing phase (3–5 seconds before calibration), the manager
 * collects diagnostic metrics from the gaze engine and recommends optimal
 * settings.  After calibration, it can further refine recommendations based
 * on LOOCV error.
 *
 * Usage:
 *   1. Call `pushProbe(features, fps, faceConfidence)` each frame during the
 *      pre-calibration face-positioning phase.
 *   2. Call `recommend()` to get the recommended config overrides.
 *   3. Optionally call `refineAfterCalibration(loocv)` after calibration to
 *      recommend a regression method switch.
 */

import type { EyeFeatures } from './FeatureExtractor';
import type { LOOCVMetrics } from '../core/IGazeEngine';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EnvironmentProfile {
  /** Measured average frames per second. */
  avgFps: number;
  /** Standard deviation of face detection confidence (lighting stability). */
  confidenceStdDev: number;
  /** Average face detection confidence. */
  avgConfidence: number;
  /** Standard deviation of head yaw (head stability). */
  headYawStdDev: number;
  /** Standard deviation of head pitch. */
  headPitchStdDev: number;
  /** Whether iris jitter suggests glasses/reflections. */
  likelyGlasses: boolean;
  /** Number of probe frames collected. */
  probeFrames: number;
}

export interface ConfigRecommendation {
  regressionMethod: 'RIDGE' | 'HYBRID' | 'TPS';
  smoothingMethod: 'ONE_EURO' | 'KALMAN' | 'MOVING_AVERAGE';
  calibrationPointsCount: number;
  glassesOptimization: boolean;
  minCutoff: number;
  beta: number;
  /** Human-readable reasons for each recommendation. */
  reasons: string[];
}

// ─── Manager ─────────────────────────────────────────────────────────────────

export class AutoConfigManager {
  private fpsValues: number[] = [];
  private confidences: number[] = [];
  private headYaws: number[] = [];
  private headPitches: number[] = [];
  private irisJitters: number[] = [];
  private prevFeatures: EyeFeatures | null = null;
  private lastTs = 0;

  /** Feed one probe frame. Call during pre-calibration phase. */
  pushProbe(features: EyeFeatures, timestamp: number): void {
    // FPS from timestamps
    if (this.lastTs > 0) {
      const dt = timestamp - this.lastTs;
      if (dt > 0) this.fpsValues.push(1000 / dt);
    }
    this.lastTs = timestamp;

    // Face confidence
    if (features.faceConfidence !== undefined) {
      this.confidences.push(features.faceConfidence);
    }

    // Head pose stability
    const hp = features.matrixHeadPose ?? features.headPose;
    this.headYaws.push(hp.yaw);
    this.headPitches.push(hp.pitch);

    // Iris jitter (glasses detection)
    if (this.prevFeatures) {
      const dlx = features.leftRelative.x - this.prevFeatures.leftRelative.x;
      const dly = features.leftRelative.y - this.prevFeatures.leftRelative.y;
      const drx = features.rightRelative.x - this.prevFeatures.rightRelative.x;
      const dry = features.rightRelative.y - this.prevFeatures.rightRelative.y;
      this.irisJitters.push((Math.hypot(dlx, dly) + Math.hypot(drx, dry)) / 2);
    }
    this.prevFeatures = features;
  }

  /** Compute environment profile from collected probes. */
  getProfile(): EnvironmentProfile {
    const avgFps = mean(this.fpsValues);
    const avgConfidence = mean(this.confidences);
    const confidenceStdDev = stddev(this.confidences);
    const headYawStdDev = stddev(this.headYaws);
    const headPitchStdDev = stddev(this.headPitches);
    const avgJitter = mean(this.irisJitters);
    // High average jitter + high jitter variance = likely glasses reflections
    const likelyGlasses = avgJitter > 1.5 || stddev(this.irisJitters) > 1.0;

    return {
      avgFps,
      confidenceStdDev,
      avgConfidence,
      headYawStdDev,
      headPitchStdDev,
      likelyGlasses,
      probeFrames: this.fpsValues.length + 1,
    };
  }

  /** Generate recommended config based on collected environment probes. */
  recommend(): ConfigRecommendation {
    const env = this.getProfile();
    const reasons: string[] = [];

    // ── Regression method ────────────────────────────────────────────────
    let regressionMethod: ConfigRecommendation['regressionMethod'] = 'TPS';
    if (env.headYawStdDev > 0.15 || env.headPitchStdDev > 0.12) {
      // Unstable head → non-linear mapping benefits from TPS
      regressionMethod = 'TPS';
      reasons.push('Head movement detected — TPS recommended for non-linear correction');
    } else if (env.avgFps < 20) {
      // Low FPS → simpler model is more stable with fewer samples
      regressionMethod = 'RIDGE';
      reasons.push(`Low FPS (${env.avgFps.toFixed(0)}) — Ridge recommended for stability`);
    } else {
      regressionMethod = 'HYBRID';
      reasons.push('Stable environment — Hybrid (Ridge + k-NN) for balanced accuracy');
    }

    // ── Smoothing method ─────────────────────────────────────────────────
    let smoothingMethod: ConfigRecommendation['smoothingMethod'] = 'ONE_EURO';
    if (env.likelyGlasses) {
      smoothingMethod = 'KALMAN';
      reasons.push('Glasses detected — Kalman filter for artifact-resilient smoothing');
    } else {
      reasons.push('One-Euro filter for adaptive speed-responsive smoothing');
    }

    // ── Filter parameters (scaled by FPS) ────────────────────────────────
    const fpsRatio = Math.max(0.1, env.avgFps / 30);
    const sqrtRatio = Math.sqrt(fpsRatio);
    const minCutoff = 0.005 / sqrtRatio;
    const beta = 0.01 * sqrtRatio;
    if (Math.abs(fpsRatio - 1) > 0.2) {
      reasons.push(`FPS-scaled filter: minCutoff=${minCutoff.toFixed(4)}, beta=${beta.toFixed(4)} (${env.avgFps.toFixed(0)} fps)`);
    }

    // ── Calibration points ───────────────────────────────────────────────
    let calibrationPointsCount = 9;
    if (env.headYawStdDev > 0.15 || env.headPitchStdDev > 0.12) {
      calibrationPointsCount = 13;
      reasons.push('Unstable head pose — more calibration points recommended');
    } else if (env.avgConfidence > 0.85 && env.confidenceStdDev < 0.05) {
      calibrationPointsCount = 5;
      reasons.push('Excellent detection stability — fewer calibration points sufficient');
    }

    // ── Glasses optimization ─────────────────────────────────────────────
    const glassesOptimization = env.likelyGlasses;
    if (env.likelyGlasses) {
      reasons.push('Auto-enabled glasses optimization (high iris jitter detected)');
    }

    return {
      regressionMethod,
      smoothingMethod,
      calibrationPointsCount,
      glassesOptimization,
      minCutoff,
      beta,
      reasons,
    };
  }

  /**
   * Post-calibration refinement: recommend regression method switch based on
   * actual LOOCV errors. Call after `engine.calibrate()` returns metrics.
   */
  refineAfterCalibration(loocv: LOOCVMetrics): {
    switchTo?: 'RIDGE' | 'HYBRID' | 'TPS';
    reason?: string;
  } {
    // If Ridge is already good enough, no need for expensive models
    if (loocv.ridgePx < 15) {
      return {
        switchTo: 'RIDGE',
        reason: `Ridge LOOCV ${loocv.ridgePx.toFixed(1)}px — sufficient accuracy, fastest inference`,
      };
    }

    // If Hybrid significantly improves over Ridge
    if (loocv.hybridPx < loocv.ridgePx * 0.75) {
      return {
        switchTo: 'HYBRID',
        reason: `Hybrid ${loocv.hybridPx.toFixed(1)}px vs Ridge ${loocv.ridgePx.toFixed(1)}px — k-NN correction effective`,
      };
    }

    // Both are poor → suggest re-calibrate rather than switching
    if (loocv.ridgePx > 25 && loocv.hybridPx > 20) {
      return {
        reason: `High error (Ridge: ${loocv.ridgePx.toFixed(1)}px, Hybrid: ${loocv.hybridPx.toFixed(1)}px) — consider re-calibration with more points`,
      };
    }

    return {};
  }

  /** Reset all probes for a new session. */
  reset(): void {
    this.fpsValues = [];
    this.confidences = [];
    this.headYaws = [];
    this.headPitches = [];
    this.irisJitters = [];
    this.prevFeatures = null;
    this.lastTs = 0;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}
