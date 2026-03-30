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
import { extractEyeFeatures, isBlinking } from '../../services/FeatureExtractor';
import { HybridRegressor, type RegressionMethod } from '../../services/RegressionService';
import { GazeSmoother } from '../../core/filters/GazeSmoother';
import type { GazeResult, HeadPoseResult, CalibrationSample, LOOCVMetrics } from '../../core/IGazeEngine';

// ─── Worker State ─────────────────────────────────────────────────────────────

let landmarker: FaceLandmarker | null = null;
let regressor: HybridRegressor | null = null;
const smoother = new GazeSmoother({ minCutoff: 0.005, beta: 0.01 });
let running = false;
let regressionMethod: RegressionMethod = 'HYBRID';

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
  const features = extractEyeFeatures(landmarks, blendshapes, matrix);
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
  const smoothed = smoother.process(raw.x, raw.y, timestamp);

  const confidence = (features.leftEAR > 0.18 && features.rightEAR > 0.18) ? 1 : 0.3;
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

  regressor = new HybridRegressor();
  const ok = regressor.train(inputs, outputs);
  smoother.reset();

  const metrics: LOOCVMetrics = ok
    ? regressor.loocv
    : { ridgePx: 0, hybridPx: 0 };

  self.postMessage({ type: 'CALIBRATE_DONE', payload: { ok, metrics } });
}
