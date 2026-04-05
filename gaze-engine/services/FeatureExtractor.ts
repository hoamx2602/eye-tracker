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
  /** MediaPipe face detection confidence (0–1), forwarded from result. */
  faceConfidence?: number;
  /**
   * Average pupil diameter (normalized by eye width).
   * Used for pupil dilation compensation — rapid changes indicate
   * lighting shifts that cause fake gaze displacement.
   */
  pupilDiameter: number;
  /** Mask detection score (0–1). >0.6 = likely wearing a mask. */
  maskScore: number;
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
  // Iris ring landmarks (top/bottom) for pupil diameter estimation
  LEFT_IRIS_TOP: 469, LEFT_IRIS_BOTTOM: 471,
  RIGHT_IRIS_TOP: 474, RIGHT_IRIS_BOTTOM: 476,
  NOSE: 1, HEAD_TOP: 10, CHIN: 152, LEFT_EDGE: 234, RIGHT_EDGE: 454,
  // Forehead/brow landmarks for mask-resilient pitch estimation
  LEFT_BROW_INNER: 107, RIGHT_BROW_INNER: 336,
  LEFT_BROW_OUTER: 70, RIGHT_BROW_OUTER: 300,
  // Nose bridge (above mask line) for mask detection
  NOSE_BRIDGE: 6,
  // Upper lip (below mask line) for mask detection
  UPPER_LIP: 13,
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

/**
 * Mask-resilient head pose — uses forehead and brow landmarks instead of chin.
 *
 * When a face mask covers the lower face, CHIN (152) is displaced upward and
 * NOSE (1) may shift, corrupting pitch estimation. This fallback uses:
 *   - HEAD_TOP (10) and brow center as the vertical reference
 *   - NOSE_BRIDGE (6) instead of NOSE (1) — the bridge is above mask line
 *   - LEFT/RIGHT_EDGE for yaw/roll (usually unaffected by masks)
 */
function maskResilientHeadPose(lm: NormalizedLandmark[]): HeadPose {
  const le = lm[L.LEFT_EDGE], re = lm[L.RIGHT_EDGE];
  const top = lm[L.HEAD_TOP];
  const noseBridge = lm[L.NOSE_BRIDGE];

  // Brow center as chin substitute (reliable above-mask reference)
  const browCenter = {
    x: (lm[L.LEFT_BROW_INNER].x + lm[L.RIGHT_BROW_INNER].x) / 2,
    y: (lm[L.LEFT_BROW_INNER].y + lm[L.RIGHT_BROW_INNER].y) / 2,
  };

  const roll = Math.atan2(re.y - le.y, re.x - le.x);
  const fw = dist2d(re, le);
  const yaw = fw > 0 ? ((noseBridge.x - (le.x + re.x) / 2) / fw) * Math.PI * 2 : 0;

  // Pitch: use forehead height (top → brow center) instead of full face height
  // The nose bridge Y relative to the top-brow midpoint gives pitch direction
  const foreheadHeight = Math.abs(browCenter.y - top.y);
  const midY = (top.y + browCenter.y) / 2;
  const pitch = foreheadHeight > 0.01
    ? ((noseBridge.y - midY) / foreheadHeight) * Math.PI * 0.5
    : 0;

  return { pitch, yaw, roll };
}

/**
 * Detect whether the user is likely wearing a face mask.
 *
 * Heuristic: Compare the distance between nose bridge (above mask) and upper
 * lip (below mask). With a mask, the upper lip landmark gets pushed upward
 * toward the nose, collapsing the nose-to-lip vertical gap. We also check
 * for abnormal chin position relative to the nose.
 *
 * Returns a 0–1 score where >0.6 strongly suggests a mask.
 */
export function detectMask(lm: NormalizedLandmark[]): number {
  if (!lm || lm.length < 478) return 0;

  const noseBridge = lm[L.NOSE_BRIDGE];
  const upperLip = lm[L.UPPER_LIP];
  const chin = lm[L.CHIN];
  const top = lm[L.HEAD_TOP];

  // Full face height (top → chin)
  const faceH = Math.abs(chin.y - top.y);
  if (faceH < 0.01) return 0;

  // Nose-bridge to upper-lip gap (normalized by face height)
  // Normal: ~0.12–0.18; with mask: <0.08 (lip landmark collapses toward nose)
  const noseLipGap = Math.abs(upperLip.y - noseBridge.y) / faceH;

  // Chin-to-nose ratio (normalized)
  // Normal: chin is ~0.35–0.40 of face height below nose
  // With mask: chin landmark shifts up, ratio shrinks
  const chinNoseRatio = Math.abs(chin.y - noseBridge.y) / faceH;

  let maskScore = 0;

  // Collapsed nose-lip gap
  if (noseLipGap < 0.08) maskScore += 0.5;
  else if (noseLipGap < 0.12) maskScore += 0.3;

  // Abnormal chin position
  if (chinNoseRatio < 0.25) maskScore += 0.4;
  else if (chinNoseRatio < 0.30) maskScore += 0.2;

  // Z-depth anomaly: mask surface pushes chin z forward
  const chinNoseZ = Math.abs((chin.z ?? 0) - (noseBridge.z ?? 0));
  if (chinNoseZ > 0.05) maskScore += 0.2;

  return Math.min(1, maskScore);
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
  faceConfidence?: number,
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

  // Pupil diameter: vertical iris span normalized by eye width (average of both eyes)
  const lIrisD = lw > 0 ? dist2d(landmarks[L.LEFT_IRIS_TOP], landmarks[L.LEFT_IRIS_BOTTOM]) / lw : 0;
  const rIrisD = rw > 0 ? dist2d(landmarks[L.RIGHT_IRIS_TOP], landmarks[L.RIGHT_IRIS_BOTTOM]) / rw : 0;
  const pupilDiameter = (lIrisD + rIrisD) / 2;

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

  // Mask detection: use forehead-based pose when mask covers lower face
  const maskScore = detectMask(landmarks);
  const geoHeadPose = maskScore > 0.5
    ? maskResilientHeadPose(landmarks)
    : geometricHeadPose(landmarks);

  return {
    leftRelative:  { x: lx * 10, y: ly * 10 },
    rightRelative: { x: rx * 10, y: ry * 10 },
    headPose:      geoHeadPose,
    zDistance,
    leftEAR,
    rightEAR,
    pupilDiameter,
    maskScore,
    blendshapes,
    matrixHeadPose: transformMatrix ? matrixHeadPose(transformMatrix.data) : undefined,
    faceConfidence,
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

// ─── Multi-Factor Confidence Score ──────────────────────────────────────────

/** Hermite smoothstep: 0 at edge0, 1 at edge1, smooth in between. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Compute a continuous multi-factor confidence score (0–1).
 *
 * Factors:
 *   1. Face detection confidence from MediaPipe (raw detector score).
 *   2. Eye openness — continuous EAR curve, not a binary blink gate.
 *   3. Head angle penalty — gaze accuracy degrades at extreme yaw/pitch.
 *   4. Temporal iris stability — high frame-to-frame jitter = low quality.
 *   5. Pupil dilation stability — rapid diameter change = lighting shift.
 *   6. Mask penalty — lower face occlusion degrades head pose reliability.
 *
 * The returned score is suitable for:
 *   - Weighting smoother aggressiveness (low confidence → heavier smoothing)
 *   - Gating glasses-mode artifact rejection
 *   - UI feedback (cursor opacity)
 */
export function computeConfidence(
  features: EyeFeatures,
  prevFeatures: EyeFeatures | null,
): number {
  let score = 1.0;

  // 1. Face detection confidence (if available)
  if (features.faceConfidence !== undefined) {
    // Map [0.5, 1.0] → [0.5, 1.0]; below 0.5 detection is unreliable
    score *= Math.max(0.5, features.faceConfidence);
  }

  // 2. Eye openness (continuous, not binary)
  //    smoothstep(0.15, 0.25) → 0 when EAR≤0.15 (closed), 1 when EAR≥0.25 (open)
  const minEAR = Math.min(features.leftEAR, features.rightEAR);
  score *= smoothstep(0.15, 0.25, minEAR);

  // 3. Head angle penalty — accuracy drops at extreme angles
  const hp = features.matrixHeadPose ?? features.headPose;
  const angleSum = Math.abs(hp.yaw) + Math.abs(hp.pitch);
  // Full confidence up to ~0.3 rad (~17°), drops linearly to 0.3 at π
  score *= Math.max(0.3, 1 - angleSum / Math.PI);

  if (prevFeatures) {
    // 4. Temporal iris consistency (jitter detection)
    const dlx = features.leftRelative.x  - prevFeatures.leftRelative.x;
    const dly = features.leftRelative.y  - prevFeatures.leftRelative.y;
    const drx = features.rightRelative.x - prevFeatures.rightRelative.x;
    const dry = features.rightRelative.y - prevFeatures.rightRelative.y;
    // Average iris displacement (already ×10 scale)
    const jitter = (Math.hypot(dlx, dly) + Math.hypot(drx, dry)) / 2;
    // Typical stable jitter < 0.5; artifact > 3.0
    const jitterPenalty = Math.max(0.2, 1 - jitter / 4.0);
    score *= jitterPenalty;

    // 5. Pupil dilation stability — rapid diameter change means lighting shift
    //    which displaces iris landmarks and creates fake gaze movement.
    //    Typical stable delta < 0.02; sudden light change > 0.08.
    const pupilDelta = Math.abs(features.pupilDiameter - prevFeatures.pupilDiameter);
    const dilationPenalty = Math.max(0.3, 1 - pupilDelta / 0.12);
    score *= dilationPenalty;
  }

  // 6. Mask penalty — with a mask the head pose is less reliable (even with
  //    the forehead fallback), so we slightly reduce confidence to make the
  //    smoother more conservative. Eye landmarks themselves are unaffected.
  if (features.maskScore > 0.5) {
    // maskScore 0.5→1.0 maps to multiplier 0.85→0.7
    score *= 0.85 - 0.15 * (features.maskScore - 0.5) / 0.5;
  }

  return score;
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
