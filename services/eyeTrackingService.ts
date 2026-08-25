import { FaceLandmarker, FilesetResolver, NormalizedLandmark, FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { EyeLandmarkIndices, EyeFeatures, HeadPose, AppConfig } from "../types";
import {
  MAX_TARGET_DISTANCE_CM,
  MIN_TARGET_DISTANCE_CM,
  checkDistance,
  faceFitsInFrame,
  faceScale,
  frameFitMargin,
  nearestFittingDistanceCm,
  type DistanceCalibration,
  type FaceBounds,
} from "../lib/viewingDistance";
import { checkAnchor, type HeadSignature, type PositionAnchor, type AnchorTolerance } from "../lib/positionAnchor";

/**
 * Smallest fraction of frame width the face may span.
 *
 * An iris is about 8% of face width, so a face at 0.13 of a 1920-px frame puts
 * roughly 20 px across the iris — around the floor at which landmark and
 * appearance estimates hold up. This is a property of the image alone: it does
 * not depend on the camera's field of view or on how far away the participant
 * is, which is exactly why it can be checked without measuring either.
 */
const MIN_FACE_WIDTH_FOR_QUALITY = 0.13;

/**
 * Last-resort width ceiling.
 *
 * This used to be 0.5 and used to be the *real* near limit, standing in for
 * "landmarks running off the frame edge". That proxy was wrong in both
 * directions once targets below 30 cm became configurable: it blocked a 65°
 * webcam at 20 cm where the distance check said the participant was exactly
 * where they were asked to be, and it would happily pass a 90° camera whose
 * frame the head genuinely did not fit.
 *
 * The edge condition is now checked directly against the landmarks — see
 * `faceFitsInFrame` — which needs no field-of-view assumption at all. What is
 * left here is a guard against a reading so large it can only be a detector
 * failure, and against the minimum focus distance of fixed-focus webcams, which
 * landmarks cannot see.
 */
const MAX_FACE_WIDTH_SANITY = 0.8;

// Lightweight inline types for optional MediaPipe outputs (avoids importing extra @mediapipe types)
interface BlendshapeCategory { categoryName: string; score: number; }
interface TransformMatrixData { data: number[] | Float32Array; }

/** Eye-gaze relevant blendshape names from MediaPipe FaceLandmarker. */
const GAZE_BLENDSHAPES = [
  'eyeLookDownLeft', 'eyeLookDownRight',
  'eyeLookInLeft',   'eyeLookInRight',
  'eyeLookOutLeft',  'eyeLookOutRight',
  'eyeLookUpLeft',   'eyeLookUpRight',
] as const;

export interface HeadValidationResult {
  valid: boolean;
  message: string;
  /** Debug: face width in normalized coords (for tuning distance thresholds) */
  debug?: {
    faceWidth: number;
    /** Face width before the FOV fudge — what the distance calibration consumes. */
    rawFaceWidth?: number;
    minFaceWidth: number;
    maxFaceWidth: number;
    targetDistanceCm: number;
    /** Present only when a measured calibration was supplied. */
    measuredDistanceCm?: number;
    distanceBandCm?: number;
    /** Present only when checked against a position anchor. */
    anchorFault?: string;
    /** Smallest gap between the face and any frame edge; negative means clipped. */
    frameFitMargin?: number;
    depthRatio?: number;
    driftFaceWidths?: number;
    depthCm?: number;
    lateralCm?: number;
  };
}

export class EyeTrackingService {
  private faceLandmarker: FaceLandmarker | null = null;
  private runningMode: "IMAGE" | "VIDEO" = "VIDEO";

  async initialize() {
    const filesetResolver = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
    );
    this.faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
        delegate: "GPU"
      },
      // Always enabled so data is available for feature-flag re-evaluation without re-init.
      // Feature flags in AppConfig control whether they are USED in the feature vector.
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      runningMode: this.runningMode,
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5
    });
  }

  detect(videoElement: HTMLVideoElement, startTimeMs: number): FaceLandmarkerResult | null {
    if (!this.faceLandmarker) return null;
    return this.faceLandmarker.detectForVideo(videoElement, startTimeMs);
  }

  /**
   * Bounding box of every landmark, in normalised frame coordinates.
   *
   * MediaPipe extrapolates landmarks past the image edge, so values outside
   * [0,1] are exactly the signal wanted here: they mean part of the face is not
   * actually being seen.
   */
  faceBounds(landmarks: NormalizedLandmark[]): FaceBounds | null {
    if (!landmarks || !landmarks.length) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < landmarks.length; i++) {
      const lm = landmarks[i];
      if (lm.x < minX) minX = lm.x;
      if (lm.x > maxX) maxX = lm.x;
      if (lm.y < minY) minY = lm.y;
      if (lm.y > maxY) maxY = lm.y;
    }
    return { minX, maxX, minY, maxY };
  }

  /**
   * Where the head is, as the position anchor understands it.
   *
   * The reference point is the midpoint between the two outer eye corners
   * rather than the nose: parallax error is set by where the *eyes* are, and
   * the nose swings noticeably around them as the head turns.
   */
  headSignature(landmarks: NormalizedLandmark[]): HeadSignature | null {
    if (!landmarks || landmarks.length < 478) return null;
    const leftEdge = landmarks[EyeLandmarkIndices.LEFT_FACE_EDGE];
    const rightEdge = landmarks[EyeLandmarkIndices.RIGHT_FACE_EDGE];
    const lo = landmarks[EyeLandmarkIndices.LEFT_OUTER];
    const ro = landmarks[EyeLandmarkIndices.RIGHT_OUTER];
    if (!leftEdge || !rightEdge || !lo || !ro) return null;

    const rawFaceWidth = Math.hypot(rightEdge.x - leftEdge.x, rightEdge.y - leftEdge.y);
    const pose = this.calculateGeometricHeadPose(landmarks);
    return {
      faceScale: faceScale(rawFaceWidth, pose?.yaw ?? 0),
      cx: (lo.x + ro.x) / 2,
      cy: (lo.y + ro.y) / 2,
      yaw: pose?.yaw ?? 0,
      pitch: pose?.pitch ?? 0,
      roll: pose?.roll ?? 0,
    };
  }

  /**
   * Checks if the head is positioned correctly for high-quality tracking.
   *
   * Distance handling has two modes. When a `distanceCalibration` is supplied
   * (measured with the bank-card + blind-spot procedure — see
   * lib/viewingDistance.ts) the check is done in **centimetres**: face size is
   * converted to a real distance and compared to the target. Without one it
   * falls back to the original hand-tuned band on normalised face width, which
   * silently assumes a camera field of view and an average face size and can be
   * 30–40% wrong — that fallback exists so a session is never blocked, not
   * because it is trustworthy.
   *
   * @param landmarks MediaPipe landmarks
   * @param faceDistanceCm Target distance in cm (30–60).
   * @param faceWidthScale Fallback-only fudge for camera FOV (1 = built-in; 0.65–0.8 typical external 1080p).
   * @param headDistanceTolerance Widen the accepted band (1 = strict, 2 = 2x).
   * @param distanceCalibration Measured face-size→cm calibration, when available.
   */
  validateHeadPosition(
    landmarks: NormalizedLandmark[],
    faceDistanceCm: number = 60,
    faceWidthScale: number = 1,
    headDistanceTolerance: number = 1,
    distanceCalibration: DistanceCalibration | null = null,
    anchor: PositionAnchor | null = null,
    anchorTolerance?: AnchorTolerance,
  ): HeadValidationResult {
    if (!landmarks) return { valid: false, message: "No Face Detected" };

    // Once an anchor exists, "correct position" means *where calibration
    // happened*, not some absolute pose. That is the quantity that actually
    // governs error: the gaze mapping bakes in the head position it was fitted
    // at, so a centimetre of drift is about a centimetre of screen error no
    // matter how well-centred in frame the participant looks.
    if (anchor) {
      const sig = this.headSignature(landmarks);
      const res = checkAnchor(anchor, sig, anchorTolerance);
      return {
        valid: res.ok,
        message: res.message,
        debug: {
          faceWidth: sig?.faceScale ?? 0,
          rawFaceWidth: sig?.faceScale ?? 0,
          minFaceWidth: 0,
          maxFaceWidth: 0,
          targetDistanceCm: faceDistanceCm,
          anchorFault: res.fault,
          depthRatio: res.deviation.depthRatio,
          driftFaceWidths: Math.hypot(
            res.deviation.lateralFaceWidths || 0,
            res.deviation.verticalFaceWidths || 0,
          ),
          ...(res.deviation.depthCm != null ? { depthCm: res.deviation.depthCm } : {}),
          ...(res.deviation.lateralCm != null ? { lateralCm: res.deviation.lateralCm } : {}),
        },
      };
    }

    const nose = landmarks[EyeLandmarkIndices.NOSE_TIP];
    const leftEdge = landmarks[EyeLandmarkIndices.LEFT_FACE_EDGE];
    const rightEdge = landmarks[EyeLandmarkIndices.RIGHT_FACE_EDGE];

    // Raw face width in normalized coords (fraction of frame). Different cameras = different FOV = different value at same distance.
    const rawFaceWidth = Math.sqrt(Math.pow(rightEdge.x - leftEdge.x, 2) + Math.pow(rightEdge.y - leftEdge.y, 2));
    const scale = Math.max(0.5, Math.min(1.5, faceWidthScale ?? 1));
    const faceWidth = Math.max(0.01, Math.min(1, rawFaceWidth * scale));
    const D = Math.max(MIN_TARGET_DISTANCE_CM, Math.min(MAX_TARGET_DISTANCE_CM, faceDistanceCm));
    const tol = Math.max(1, Math.min(3, headDistanceTolerance ?? 1));

    // Yaw foreshortens the measured width by cos(yaw); without removing it, a
    // participant who merely turns their head is told they have moved away.
    const yaw = this.calculateGeometricHeadPose(landmarks)?.yaw ?? 0;
    const scaleInvariant = faceScale(rawFaceWidth, yaw);
    const distCheck = distanceCalibration
      ? checkDistance(distanceCalibration, scaleInvariant, D, tol)
      : null;

    // Face-size band. This checks IMAGE QUALITY, not distance.
    //
    // It used to be derived from the target distance — 0.09 + (90-D)*0.0012 and
    // so on — which quietly assumed a particular camera field of view. On a
    // narrower-FOV webcam the face legitimately fills more of the frame at the
    // same distance, and the participant was told to move back until the image
    // got *worse*. That is the wrong direction on the one axis that matters:
    // how many pixels land on the iris depends on the fraction of frame the
    // face occupies, and nothing else. Bigger is simply better.
    //
    // So the floor is a quality minimum and the ceiling is a sanity check for a
    // face so close that landmarks reach the frame edge and most fixed-focus
    // webcams stop focusing. Actual distance is checked separately, and only
    // when it has actually been measured.
    const minFaceWidth = Math.max(0.05, MIN_FACE_WIDTH_FOR_QUALITY / tol);
    const maxFaceWidth = MAX_FACE_WIDTH_SANITY;
    const debug = {
      faceWidth,
      rawFaceWidth,
      minFaceWidth,
      maxFaceWidth,
      targetDistanceCm: D,
      ...(distCheck && Number.isFinite(distCheck.distanceCm)
        ? { measuredDistanceCm: distCheck.distanceCm, distanceBandCm: distCheck.bandCm }
        : {}),
    };

    // 1. Center Check (Horizontal & Vertical)
    const centerX = 0.5;
    const centerY = 0.5;
    
    const toleranceX = 0.06; // +/- 6% from center (Total 12% zone)
    const toleranceY = 0.08; // +/- 8% from center (Total 16% zone)

    // Mirror-aware: video is shown flipped, so swap Left/Right so instructions match what user sees
    if (Math.abs(nose.x - centerX) > toleranceX) {
      return { valid: false, message: nose.x < centerX ? "Move Left" : "Move Right", debug };
    }
    if (Math.abs(nose.y - centerY) > toleranceY) {
      return { valid: false, message: nose.y < centerY ? "Move Down" : "Move Up", debug };
    }

    // 2. Distance check. A measured calibration wins outright — it knows the
    // camera and this face, where the band below only guesses at both. The
    // message carries the actual centimetres so the participant can aim, rather
    // than nudging blindly until an opaque gate turns green.
    if (distCheck && distCheck.verdict !== 'unknown') {
      const at = `${distCheck.distanceCm.toFixed(0)}cm → ${D}cm`;
      if (distCheck.verdict === 'too-close') return { valid: false, message: `Move Back (${at})`, debug };
      if (distCheck.verdict === 'too-far') return { valid: false, message: `Move Closer (${at})`, debug };
    }
    // Image-quality floor applies either way: too few pixels on the iris cannot
    // be fixed by anything downstream.
    if (faceWidth < minFaceWidth) return { valid: false, message: "Move Closer", debug };
    if (faceWidth > maxFaceWidth) return { valid: false, message: "Move Back", debug };

    // Does the face actually fit in the frame?
    //
    // Checked against the landmarks rather than inferred from a width fraction,
    // because the binding constraint is the *shorter* frame axis and a width
    // proxy cannot see it. A 16:9 frame at 20 cm on a 65° webcam is about 14 cm
    // tall against a ~22 cm head: the crown and chin leave the image, and with
    // them HEAD_TOP and CHIN_BOTTOM, which is where pitch comes from.
    //
    // The message carries the distance this camera can actually reach, so a
    // target it cannot serve fails with a number instead of repeating "Move
    // Back" at someone who is already exactly where they were told to be.
    const bounds = this.faceBounds(landmarks);
    if (bounds && !faceFitsInFrame(bounds)) {
      const spanY = bounds.maxY - bounds.minY;
      const nearest =
        distCheck && Number.isFinite(distCheck.distanceCm)
          ? nearestFittingDistanceCm(spanY, distCheck.distanceCm)
          : NaN;
      const advice = Number.isFinite(nearest)
        ? ` — this camera needs ${Math.ceil(nearest)}cm or more`
        : '';
      return {
        valid: false,
        message: `Move Back${advice}`,
        debug: { ...debug, frameFitMargin: frameFitMargin(bounds) },
      };
    }

    // 3. Tilt Check (Head Rotation)
    const tilt = Math.abs(leftEdge.y - rightEdge.y);
    if (tilt > 0.12) return { valid: false, message: "Straighten Head", debug };

    return { valid: true, message: "Perfect! Hold Steady...", debug };
  }

  isBlinking(landmarks: NormalizedLandmark[]): boolean {
      if (!landmarks) return false;

      const getDist = (i1: number, i2: number) => {
        const p1 = landmarks[i1];
        const p2 = landmarks[i2];
        return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
      };
  
      const leftH = getDist(EyeLandmarkIndices.LEFT_TOP, EyeLandmarkIndices.LEFT_BOTTOM);
      const leftW = getDist(EyeLandmarkIndices.LEFT_INNER, EyeLandmarkIndices.LEFT_OUTER);
      const rightH = getDist(EyeLandmarkIndices.RIGHT_TOP, EyeLandmarkIndices.RIGHT_BOTTOM);
      const rightW = getDist(EyeLandmarkIndices.RIGHT_INNER, EyeLandmarkIndices.RIGHT_OUTER);
      
      const leftRatio = leftW > 0 ? leftH / leftW : 0;
      const rightRatio = rightW > 0 ? rightH / rightW : 0;
      
      return (leftRatio < 0.18 || rightRatio < 0.18);
  }

  calculateGeometricHeadPose(landmarks: NormalizedLandmark[]): HeadPose {
    const nose = landmarks[EyeLandmarkIndices.NOSE_TIP];
    const leftEdge = landmarks[EyeLandmarkIndices.LEFT_FACE_EDGE];
    const rightEdge = landmarks[EyeLandmarkIndices.RIGHT_FACE_EDGE];
    const top = landmarks[EyeLandmarkIndices.HEAD_TOP];
    const chin = landmarks[EyeLandmarkIndices.CHIN_BOTTOM];

    const roll = Math.atan2(rightEdge.y - leftEdge.y, rightEdge.x - leftEdge.x);

    const faceCenterX = (leftEdge.x + rightEdge.x) / 2;
    const faceWidth = Math.sqrt(Math.pow(rightEdge.x - leftEdge.x, 2) + Math.pow(rightEdge.y - leftEdge.y, 2));
    const yaw = ((nose.x - faceCenterX) / faceWidth) * Math.PI * 2; 

    const faceCenterY = (top.y + chin.y) / 2;
    const faceHeight = Math.sqrt(Math.pow(chin.x - top.x, 2) + Math.pow(chin.y - top.y, 2));
    const pitch = ((nose.y - faceCenterY) / faceHeight) * Math.PI;

    return { pitch, yaw, roll };
  }

  extractEyeFeatures(
    landmarks: NormalizedLandmark[],
    blendshapeCategories?: BlendshapeCategory[],
    transformMatrixData?: TransformMatrixData
  ): EyeFeatures | null {
    if (!landmarks || landmarks.length < 478) return null;

    const getPoint = (index: number) => ({ x: landmarks[index].x, y: landmarks[index].y });

    const leftPupil = getPoint(EyeLandmarkIndices.LEFT_IRIS_CENTER);
    const rightPupil = getPoint(EyeLandmarkIndices.RIGHT_IRIS_CENTER);

    // Eye corners
    const leftInner  = getPoint(EyeLandmarkIndices.LEFT_INNER);
    const leftOuter  = getPoint(EyeLandmarkIndices.LEFT_OUTER);
    const leftTop    = getPoint(EyeLandmarkIndices.LEFT_TOP);
    const leftBottom = getPoint(EyeLandmarkIndices.LEFT_BOTTOM);
    const rightInner  = getPoint(EyeLandmarkIndices.RIGHT_INNER);
    const rightOuter  = getPoint(EyeLandmarkIndices.RIGHT_OUTER);
    const rightTop    = getPoint(EyeLandmarkIndices.RIGHT_TOP);
    const rightBottom = getPoint(EyeLandmarkIndices.RIGHT_BOTTOM);

    const leftCenter  = { x: (leftInner.x  + leftOuter.x)  / 2, y: (leftInner.y  + leftOuter.y)  / 2 };
    const rightCenter = { x: (rightInner.x + rightOuter.x) / 2, y: (rightInner.y + rightOuter.y) / 2 };

    const dist = (a: {x:number;y:number}, b: {x:number;y:number}) =>
      Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

    const leftWidth  = dist(leftOuter,  leftInner);
    const rightWidth = dist(rightOuter, rightInner);

    // Normalized pupil-to-center vectors
    const lx = leftWidth  > 0 ? (leftPupil.x  - leftCenter.x)  / leftWidth  : 0;
    const ly = leftWidth  > 0 ? (leftPupil.y  - leftCenter.y)  / leftWidth  : 0;
    const rx = rightWidth > 0 ? (rightPupil.x - rightCenter.x) / rightWidth : 0;
    const ry = rightWidth > 0 ? (rightPupil.y - rightCenter.y) / rightWidth : 0;

    const headPose = this.calculateGeometricHeadPose(landmarks);

    // Z-Distance proxy: IPD normalized by face width.
    // Using the full 2D distance (sqrt of x²+y²) avoids head-tilt confound —
    // when the head tilts, raw horizontal-only IPD shrinks even at the same depth.
    // Dividing by faceWidth removes camera-FOV and face-size variation,
    // giving a stable inverse-depth signal (larger = closer to camera).
    const leftFaceEdge  = landmarks[EyeLandmarkIndices.LEFT_FACE_EDGE];
    const rightFaceEdge = landmarks[EyeLandmarkIndices.RIGHT_FACE_EDGE];
    const faceWidth = Math.sqrt(
      (rightFaceEdge.x - leftFaceEdge.x) ** 2 +
      (rightFaceEdge.y - leftFaceEdge.y) ** 2
    );
    const ipd = Math.sqrt(
      (leftOuter.x - rightOuter.x) ** 2 +
      (leftOuter.y - rightOuter.y) ** 2
    );
    const zDistance = faceWidth > 0.01 ? (ipd / faceWidth) * 10 : 0;

    // --- EAR: Eye Aspect Ratio (openness) ---
    // EAR = vertical_opening / horizontal_width. Drops toward 0 when squinting/blinking.
    const leftEAR  = leftWidth  > 0 ? dist(leftTop,  leftBottom)  / leftWidth  : 0;
    const rightEAR = rightWidth > 0 ? dist(rightTop, rightBottom) / rightWidth : 0;

    // --- Blendshapes (MediaPipe neural-network gaze estimates) ---
    let blendshapes: Record<string, number> | undefined;
    if (blendshapeCategories && blendshapeCategories.length > 0) {
      blendshapes = {};
      for (const cat of blendshapeCategories) {
        if ((GAZE_BLENDSHAPES as readonly string[]).includes(cat.categoryName)) {
          blendshapes[cat.categoryName] = cat.score;
        }
      }
    }

    // --- Matrix Head Pose (from 4×4 column-major transform matrix) ---
    // More accurate than the geometric heuristic for larger rotation angles.
    let matrixHeadPose: HeadPose | undefined;
    if (transformMatrixData?.data && transformMatrixData.data.length >= 16) {
      const m = transformMatrixData.data;
      // Column-major layout: m[col*4 + row]
      // R[row][col] → R[0][0]=m[0], R[1][0]=m[1], R[2][0]=m[2]
      //               R[0][1]=m[4], R[1][1]=m[5], R[2][1]=m[6]
      //               R[0][2]=m[8], R[1][2]=m[9], R[2][2]=m[10]
      const r00=m[0], r10=m[1], r20=m[2];
      const r01=m[4],            r21=m[6], r22=m[10];
      const sy = Math.sqrt(r00 * r00 + r10 * r10);
      if (sy > 1e-6) {
        matrixHeadPose = {
          pitch: Math.atan2(-r20, sy),           // up/down
          yaw:   Math.atan2(r10, r00),            // left/right
          roll:  Math.atan2(r21, r22),            // tilt
        };
      }
    }

    return {
      leftPupil,
      rightPupil,
      leftEyeCenter:  leftCenter,
      rightEyeCenter: rightCenter,
      leftRelative:   { x: lx * 10, y: ly * 10 },
      rightRelative:  { x: rx * 10, y: ry * 10 },
      headPose,
      zDistance,
      leftEAR,
      rightEAR,
      blendshapes,
      matrixHeadPose,
    };
  }

  /**
   * Builds the regression feature vector from raw EyeFeatures.
   *
   * @param features   Raw eye/head measurements from extractEyeFeatures()
   * @param config     Optional AppConfig (or subset). Feature flags default to false when omitted.
   *
   * Feature flags control which optional features are appended after the fixed core vector,
   * so toggling a flag changes vector dimensionality — the regressor must be re-trained
   * (or re-evaluated via reEvaluateWithCurrentFlags) after any flag change.
   *
   * Core vector layout (always present, indices 0-24):
   *   [0]       bias
   *   [1..4]    lx, ly, rx, ry          (normalized pupil-center vectors ×10)
   *   [5..8]    lR, lΘ, rR, rΘ          (polar form)
   *   [9..11]   pitch, yaw, roll         (geometric or matrix head pose)
   *   [12..15]  lx·yaw, rx·yaw, ly·pitch, ry·pitch   (cross terms)
   *   [16..17]  lx², ly²
   *   [18]      z                        (inter-ocular distance proxy)
   *   [19..24]  lx·z, ly·z, rx·z, ry·z, pitch·z, yaw·z
   *
   * Optional appended features (enabled via flags):
   *   useSymmetricFeatures → rx², ry², (lx−rx)       (+3)
   *   useEAR               → leftEAR, rightEAR        (+2)
   *   useBlendshapes       → 8 gaze blendshape scores (+8)
   */
  prepareFeatureVector(
    features: EyeFeatures,
    config?: Pick<AppConfig, 'useEAR' | 'useBlendshapes' | 'useTransformationMatrix' | 'useSymmetricFeatures'>
  ): number[] {
    const lx = features.leftRelative.x;
    const ly = features.leftRelative.y;
    const rx = features.rightRelative.x;
    const ry = features.rightRelative.y;

    // Use matrix-derived pose if flag is enabled and data is available; else fallback to geometric
    const pose = (config?.useTransformationMatrix && features.matrixHeadPose)
      ? features.matrixHeadPose
      : features.headPose;
    const { pitch, yaw, roll } = pose;

    const lR     = Math.sqrt(lx*lx + ly*ly);
    const lTheta = Math.atan2(ly, lx);
    const rR     = Math.sqrt(rx*rx + ry*ry);
    const rTheta = Math.atan2(ry, rx);
    const z      = features.zDistance;

    // Core vector (fixed layout — same as original, backward-compatible)
    const vec: number[] = [
      1,                                          // bias
      lx, ly, rx, ry,                             // eye vectors
      lR, lTheta, rR, rTheta,                     // polar form
      pitch, yaw, roll,                           // head pose
      lx * yaw,  rx * yaw,                        // cross: horizontal gaze × yaw
      ly * pitch, ry * pitch,                     // cross: vertical gaze × pitch
      lx * lx, ly * ly,                           // quadratic (left eye)
      z,                                          // Z proxy
      lx * z, ly * z, rx * z, ry * z,             // gaze × distance
      pitch * z, yaw * z,                         // head pose × distance
    ];

    // --- Optional features (change dimensionality; require regressor re-train) ---

    if (config?.useSymmetricFeatures) {
      // Mirror of left-eye quadratic terms + binocular vergence
      vec.push(rx * rx, ry * ry, lx - rx);
    }

    if (config?.useEAR) {
      // Eye openness — compensates for iris position shift when squinting
      vec.push(features.leftEAR, features.rightEAR);
    }

    if (config?.useBlendshapes && features.blendshapes) {
      // Neural-network gaze estimates from MediaPipe (higher accuracy than geometric)
      for (const name of GAZE_BLENDSHAPES) {
        vec.push(features.blendshapes[name] ?? 0);
      }
    }

    return vec;
  }
}

export const eyeTrackingService = new EyeTrackingService();