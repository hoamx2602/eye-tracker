/**
 * FeatureExtractor — landmark → EyeFeatures → feature vector.
 *
 * Designed to run inside a Web Worker (no DOM dependencies).
 * Extracted and decoupled from eyeTrackingService.ts.
 */

import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HeadPose {
  pitch: number;
  yaw: number;
  roll: number;
}

export interface EyeFeatures {
  leftRelative: { x: number; y: number };
  rightRelative: { x: number; y: number };
  headPose: HeadPose;
  zDistance: number;
  leftEAR: number;
  rightEAR: number;
  blendshapes?: Record<string, number>;
  matrixHeadPose?: HeadPose;
}

export interface FeatureFlags {
  useEAR?: boolean;
  useBlendshapes?: boolean;
  useTransformationMatrix?: boolean;
  useSymmetricFeatures?: boolean;
}

/** Gaze-relevant blendshape names from MediaPipe FaceLandmarker. */
const GAZE_BLENDSHAPES = [
  'eyeLookDownLeft', 'eyeLookDownRight',
  'eyeLookInLeft',   'eyeLookInRight',
  'eyeLookOutLeft',  'eyeLookOutRight',
  'eyeLookUpLeft',   'eyeLookUpRight',
] as const;

/** Landmark indices used for feature extraction. */
const L = {
  LEFT_INNER: 133, LEFT_OUTER: 33, LEFT_TOP: 159, LEFT_BOTTOM: 145, LEFT_IRIS: 468,
  RIGHT_INNER: 362, RIGHT_OUTER: 263, RIGHT_TOP: 386, RIGHT_BOTTOM: 374, RIGHT_IRIS: 473,
  NOSE: 1, HEAD_TOP: 10, CHIN: 152, LEFT_EDGE: 234, RIGHT_EDGE: 454,
} as const;

// ─── Core Extraction ─────────────────────────────────────────────────────────

function dist2d(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function geometricHeadPose(lm: NormalizedLandmark[]): HeadPose {
  const nose = lm[L.NOSE], le = lm[L.LEFT_EDGE], re = lm[L.RIGHT_EDGE];
  const top  = lm[L.HEAD_TOP], chin = lm[L.CHIN];
  const roll  = Math.atan2(re.y - le.y, re.x - le.x);
  const fw    = dist2d(re, le);
  const yaw   = fw > 0 ? ((nose.x - (le.x + re.x) / 2) / fw) * Math.PI * 2 : 0;
  const fh    = dist2d(chin, top);
  const pitch = fh > 0 ? ((nose.y - (top.y + chin.y) / 2) / fh) * Math.PI : 0;
  return { pitch, yaw, roll };
}

function matrixHeadPose(data: ArrayLike<number>): HeadPose | undefined {
  if (data.length < 16) return undefined;
  // Column-major 4×4 rotation matrix → Euler angles
  const r00 = data[0], r10 = data[1], r20 = data[2];
  const r21 = data[6], r22 = data[10];
  const sy = Math.sqrt(r00 * r00 + r10 * r10);
  if (sy < 1e-6) return undefined;
  return {
    pitch: Math.atan2(-r20, sy),
    yaw:   Math.atan2(r10, r00),
    roll:  Math.atan2(r21, r22),
  };
}

/**
 * Extract eye features from raw MediaPipe landmarks.
 * Returns null if landmarks are incomplete (< 478 points).
 */
export function extractEyeFeatures(
  landmarks: NormalizedLandmark[],
  blendshapeCategories?: { categoryName: string; score: number }[],
  transformMatrix?: { data: ArrayLike<number> },
): EyeFeatures | null {
  if (!landmarks || landmarks.length < 478) return null;

  const lp = landmarks[L.LEFT_IRIS], rp = landmarks[L.RIGHT_IRIS];
  const li = landmarks[L.LEFT_INNER], lo = landmarks[L.LEFT_OUTER];
  const ri = landmarks[L.RIGHT_INNER], ro = landmarks[L.RIGHT_OUTER];
  const lt = landmarks[L.LEFT_TOP], lb = landmarks[L.LEFT_BOTTOM];
  const rt = landmarks[L.RIGHT_TOP], rb = landmarks[L.RIGHT_BOTTOM];

  const lc = { x: (li.x + lo.x) / 2, y: (li.y + lo.y) / 2 };
  const rc = { x: (ri.x + ro.x) / 2, y: (ri.y + ro.y) / 2 };
  const lw = dist2d(lo, li), rw = dist2d(ro, ri);

  // Normalized pupil-to-center vectors (×10 for regressor scale)
  const lx = lw > 0 ? (lp.x - lc.x) / lw : 0;
  const ly = lw > 0 ? (lp.y - lc.y) / lw : 0;
  const rx = rw > 0 ? (rp.x - rc.x) / rw : 0;
  const ry = rw > 0 ? (rp.y - rc.y) / rw : 0;

  // Z-distance: IPD / face-width (stable inverse-depth proxy)
  const le = landmarks[L.LEFT_EDGE], re = landmarks[L.RIGHT_EDGE];
  const fw = dist2d(re, le);
  const ipd = dist2d(lo, ro);
  const zDistance = fw > 0.01 ? (ipd / fw) * 10 : 0;

  // EAR: vertical-opening / horizontal-width
  const leftEAR  = lw > 0 ? dist2d(lt, lb) / lw : 0;
  const rightEAR = rw > 0 ? dist2d(rt, rb) / rw : 0;

  // Blendshapes
  let blendshapes: Record<string, number> | undefined;
  if (blendshapeCategories?.length) {
    blendshapes = {};
    for (const cat of blendshapeCategories) {
      if ((GAZE_BLENDSHAPES as readonly string[]).includes(cat.categoryName)) {
        blendshapes[cat.categoryName] = cat.score;
      }
    }
  }

  return {
    leftRelative:  { x: lx * 10, y: ly * 10 },
    rightRelative: { x: rx * 10, y: ry * 10 },
    headPose:      geometricHeadPose(landmarks),
    zDistance,
    leftEAR,
    rightEAR,
    blendshapes,
    matrixHeadPose: transformMatrix ? matrixHeadPose(transformMatrix.data) : undefined,
  };
}

/**
 * Build the regression feature vector from EyeFeatures.
 *
 * Core vector layout (always present, indices 0–24):
 *   [0]       bias
 *   [1–4]     lx, ly, rx, ry              (pupil-center vectors ×10)
 *   [5–8]     lR, lΘ, rR, rΘ             (polar form)
 *   [9–11]    pitch, yaw, roll            (head pose)
 *   [12–15]   lx·yaw, rx·yaw, ly·pitch, ry·pitch
 *   [16–17]   lx², ly²
 *   [18]      z                           (depth proxy)
 *   [19–24]   lx·z, ly·z, rx·z, ry·z, pitch·z, yaw·z
 *
 * Optional (change vector dimensionality — re-train required):
 *   useSymmetricFeatures → +3 (rx², ry², lx−rx)
 *   useEAR               → +2 (leftEAR, rightEAR)
 *   useBlendshapes       → +8 (gaze blendshape scores)
 */
export function buildFeatureVector(f: EyeFeatures, flags: FeatureFlags = {}): number[] {
  const lx = f.leftRelative.x, ly = f.leftRelative.y;
  const rx = f.rightRelative.x, ry = f.rightRelative.y;
  const pose = (flags.useTransformationMatrix && f.matrixHeadPose) ? f.matrixHeadPose : f.headPose;
  const { pitch, yaw, roll } = pose;
  const z = f.zDistance;

  const vec: number[] = [
    1,
    lx, ly, rx, ry,
    Math.sqrt(lx * lx + ly * ly), Math.atan2(ly, lx),
    Math.sqrt(rx * rx + ry * ry), Math.atan2(ry, rx),
    pitch, yaw, roll,
    lx * yaw, rx * yaw, ly * pitch, ry * pitch,
    lx * lx, ly * ly,
    z,
    lx * z, ly * z, rx * z, ry * z, pitch * z, yaw * z,
  ];

  if (flags.useSymmetricFeatures) vec.push(rx * rx, ry * ry, lx - rx);
  if (flags.useEAR) vec.push(f.leftEAR, f.rightEAR);
  if (flags.useBlendshapes && f.blendshapes) {
    for (const name of GAZE_BLENDSHAPES) vec.push(f.blendshapes[name] ?? 0);
  }

  return vec;
}

/**
 * Blink detection using Eye Aspect Ratio.
 * EAR < 0.18 on either eye → blink in progress.
 */
export function isBlinking(landmarks: NormalizedLandmark[]): boolean {
  if (!landmarks) return false;
  const lw = dist2d(landmarks[L.LEFT_OUTER],  landmarks[L.LEFT_INNER]);
  const rw = dist2d(landmarks[L.RIGHT_OUTER], landmarks[L.RIGHT_INNER]);
  const lEAR = lw > 0 ? dist2d(landmarks[L.LEFT_TOP],  landmarks[L.LEFT_BOTTOM])  / lw : 0;
  const rEAR = rw > 0 ? dist2d(landmarks[L.RIGHT_TOP], landmarks[L.RIGHT_BOTTOM]) / rw : 0;
  return lEAR < 0.18 || rEAR < 0.18;
}
