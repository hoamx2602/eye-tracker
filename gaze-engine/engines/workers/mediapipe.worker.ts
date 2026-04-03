/// <reference lib="webworker" />
/**
 * mediapipe.worker — runs entirely off the main thread.
 *
 * Flow:
 *   Main thread → postMessage('INIT')    → loads FaceLandmarker
 *   Main thread → postMessage('FRAME')   → processes ImageBitmap
 *   Main thread → postMessage('CALIBRATE') → trains HybridRegressor
 *   Worker      → postMessage('GAZE')    → GazeResult
 *   Worker      → postMessage('HEAD_POSE') → HeadPoseResult
 *
 * Zero-copy frame transfer: main thread calls createImageBitmap(video)
 * and posts the bitmap with Transferable ownership — no pixel copying.
 */

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision';
import { extractEyeFeatures, isBlinking, computeConfidence } from '../../services/FeatureExtractor';
import type { EyeFeatures } from '../../services/FeatureExtractor';
import { HybridRegressor, type RegressionMethod } from '../../services/RegressionService';
import { GazeSmoother } from '../../core/filters/GazeSmoother';
import { DriftCompensator } from '../../core/filters/DriftCompensator';
import type { GazeResult, HeadPoseResult, CalibrationSample, LOOCVMetrics } from '../../core/IGazeEngine';

// ─── Worker State ─────────────────────────────────────────────────────────────

let landmarker: FaceLandmarker | null = null;
let regressor: HybridRegressor | null = null;
const smoother = new GazeSmoother({ minCutoff: 0.005, beta: 0.01 });
const driftComp = new DriftCompensator();
let running = false;
let regressionMethod: RegressionMethod = 'HYBRID';
let prevFeatures: EyeFeatures | null = null;

// ─── FPS-Adaptive Tuning ─────────────────────────────────────────────────────

const REF_FPS = 30;
const BASE_MIN_CUTOFF = 0.005;
const BASE_BETA = 0.01;
const BASE_SACCADE_THRESHOLD = 50;
let lastFrameTs = 0;
let fpsAccum = 0;
let fpsCount = 0;
/** How often (in frames) to re-compute FPS and update smoother params. */
const FPS_UPDATE_INTERVAL = 30;

function updateFpsAdaptiveParams(timestamp: number): void {
  if (lastFrameTs > 0) {
    const dt = timestamp - lastFrameTs;
    if (dt > 0) {
      fpsAccum += 1000 / dt;
      fpsCount++;
    }
  }
  lastFrameTs = timestamp;

  if (fpsCount >= FPS_UPDATE_INTERVAL) {
    const actualFps = fpsAccum / fpsCount;
    fpsAccum = 0;
    fpsCount = 0;

    const ratio = actualFps / REF_FPS;
    const sqrtRatio = Math.sqrt(Math.max(0.1, ratio));

    // Lower FPS → more noise per sample → lower cutoff (heavier smoothing)
    // Higher FPS → cleaner velocity → increase beta responsiveness
    smoother.updateConfig({
      minCutoff: BASE_MIN_CUTOFF / sqrtRatio,
      beta: BASE_BETA * sqrtRatio,
      // Saccade threshold scales: at lower FPS, eyes travel further between frames
      saccadeThreshold: BASE_SACCADE_THRESHOLD / sqrtRatio,
    });
  }
}

// ─── Message Dispatcher ───────────────────────────────────────────────────────

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data as { type: string; payload: unknown };

  switch (type) {
    case 'INIT':
      await handleInit(payload as { wasmPath: string; modelPath: string; useBlendshapes: boolean; useMatrix: boolean });
      break;
    case 'FRAME':
      handleFrame(payload as { bitmap: ImageBitmap; timestamp: number });
      break;
    case 'CALIBRATE':
      handleCalibrate(payload as { samples: CalibrationSample[]; method: RegressionMethod });
      break;
    case 'UPDATE_SMOOTHER':
      smoother.updateConfig(payload as Parameters<typeof smoother.updateConfig>[0]);
      break;
    case 'SET_METHOD':
      regressionMethod = payload as RegressionMethod;
      break;
    case 'START':
      running = true;
      break;
    case 'STOP':
      running = false;
      break;
    case 'DESTROY':
      landmarker?.close();
      landmarker = null;
      running = false;
      break;
  }
};

// ─── Init ─────────────────────────────────────────────────────────────────────

async function handleInit(cfg: {
  wasmPath: string;
  modelPath: string;
  useBlendshapes: boolean;
  useMatrix: boolean;
}) {
  try {
    const vision = await FilesetResolver.forVisionTasks(cfg.wasmPath);
    landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: cfg.modelPath, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      // Always capture both so re-evaluation without re-init is possible
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
    self.postMessage({ type: 'READY' });
  } catch (err) {
    self.postMessage({ type: 'ERROR', payload: String(err) });
  }
}

// ─── Per-Frame Processing ─────────────────────────────────────────────────────

function handleFrame({ bitmap, timestamp }: { bitmap: ImageBitmap; timestamp: number }) {
  if (!running || !landmarker) {
    bitmap.close();
    return;
  }

  // Track frame rate and auto-tune smoother when FPS deviates from reference
  updateFpsAdaptiveParams(timestamp);

  // ImageBitmap can be passed directly to detectForVideo in a worker
  let result: FaceLandmarkerResult;
  try {
    result = landmarker.detectForVideo(bitmap as unknown as HTMLVideoElement, timestamp);
  } finally {
    bitmap.close(); // always release memory
  }

  const landmarks = result.faceLandmarks?.[0];
  if (!landmarks) return;

  // Skip frames during blinks to avoid polluting predictions
  if (isBlinking(landmarks)) {
    self.postMessage({
      type: 'GAZE',
      payload: null, // signal: blink — consumer should ignore
    });
    return;
  }

  const blendshapes = result.faceBlendshapes?.[0]?.categories;
  const matrix = result.facialTransformationMatrixes?.[0];
  // Forward MediaPipe's face detection confidence for multi-factor scoring
  const resultAny = result as unknown as Record<string, unknown>;
  const faceConf = resultAny.faceDetectionConfidences
    ? (resultAny.faceDetectionConfidences as number[])[0]
    : undefined;
  const features = extractEyeFeatures(landmarks, blendshapes, matrix, faceConf);
  if (!features) return;

  // Head pose (always emit regardless of regressor state)
  const hp = features.matrixHeadPose ?? features.headPose;
  const headPayload: HeadPoseResult = { pitch: hp.pitch, yaw: hp.yaw, roll: hp.roll, timestamp };
  self.postMessage({ type: 'HEAD_POSE', payload: headPayload });

  // Gaze prediction (only after calibration)
  if (!regressor?.hasModel()) return;

  // Feature vector is built inside the worker using stored flags — no cross-thread flag sync needed
  // For now use default flags; UPDATE_FLAGS message can carry new flags
  const featureVec = currentFeatureVec(features);
  const raw = regressor.predict(featureVec, regressionMethod);

  // Multi-factor confidence: face detection, EAR, head angle, iris jitter
  const confidence = computeConfidence(features, prevFeatures);
  prevFeatures = features;

  // Drift compensation: correct systematic offset using fixation-based estimation
  const driftCorrected = driftComp.correct(raw.x, raw.y, confidence);

  // Feed confidence as frameQuality into smoother so low-confidence frames get heavier smoothing
  const smoothed = smoother.process(driftCorrected.x, driftCorrected.y, timestamp, confidence);

  const gazePayload: GazeResult = { x: smoothed.x, y: smoothed.y, timestamp, confidence };
  self.postMessage({ type: 'GAZE', payload: gazePayload });
}

// Simple passthrough — worker receives pre-built vectors during calibration
// so no flag state needed here for the live path
let _featureVecFn: ((f: ReturnType<typeof extractEyeFeatures>) => number[]) | null = null;

function currentFeatureVec(features: NonNullable<ReturnType<typeof extractEyeFeatures>>): number[] {
  // Import at top would create circular issue; use dynamic require pattern
  // The feature vector is received from the main thread during calibration
  // but for live prediction we need it here — use a cached builder
  if (_featureVecFn) return _featureVecFn(features);

  // Fallback: build from raw features (same flags as calibration assumed)
  const { buildFeatureVector } = require('../../services/FeatureExtractor');
  _featureVecFn = (f) => buildFeatureVector(f, currentFlags);
  return _featureVecFn!(features);
}

let currentFlags: import('../../services/FeatureExtractor').FeatureFlags = {};

// ─── Calibration ──────────────────────────────────────────────────────────────

function handleCalibrate(payload: { samples: CalibrationSample[]; method: RegressionMethod; flags?: import('../../services/FeatureExtractor').FeatureFlags }) {
  regressionMethod = payload.method;
  if (payload.flags) {
    currentFlags = payload.flags;
    _featureVecFn = null; // reset cached fn so it picks up new flags
  }

  const inputs = payload.samples.map(s => s.featureVector);
  const outputs = payload.samples.map(s => [s.screenX, s.screenY]);
  // Use per-sample weights for confidence-weighted regression when available
  const weights = payload.samples.some(s => s.weight !== undefined && s.weight !== 1)
    ? payload.samples.map(s => s.weight ?? 1)
    : undefined;

  regressor = new HybridRegressor();
  const ok = regressor.train(inputs, outputs, weights);
  smoother.reset();
  driftComp.reset();
  prevFeatures = null;

  const metrics: LOOCVMetrics = ok
    ? regressor.loocv
    : { ridgePx: 0, hybridPx: 0 };

  self.postMessage({ type: 'CALIBRATE_DONE', payload: { ok, metrics } });
}
