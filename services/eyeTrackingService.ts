import { FaceLandmarker, FilesetResolver, NormalizedLandmark, FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { EyeLandmarkIndices, EyeFeatures, HeadPose, AppConfig } from "../types";

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
  debug?: { faceWidth: number; minFaceWidth: number; maxFaceWidth: number; targetDistanceCm: number };
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
   * Checks if the head is positioned correctly for high-quality tracking.
   * Uses faceDistanceCm from app config to enforce allowed distance (closer = larger face in frame).
   * faceWidthScale compensates for camera FOV; headDistanceTolerance widens the band for cameras that auto-zoom.
   * @param landmarks MediaPipe landmarks
   * @param faceDistanceCm Target distance in cm (40–90). Used to compute allowed face size in frame.
   * @param faceWidthScale Scale applied to raw face width (1 = built-in; 0.65–0.8 typical for external 1080p webcam).
   * @param headDistanceTolerance Widen band (1 = strict, 2 = 2x band). Use 2+ when camera auto-zooms (Center Stage, etc.).
   */
  validateHeadPosition(
    landmarks: NormalizedLandmark[],
    faceDistanceCm: number = 60,
    faceWidthScale: number = 1,
    headDistanceTolerance: number = 1
  ): HeadValidationResult {
    if (!landmarks) return { valid: false, message: "No Face Detected" };

    const nose = landmarks[EyeLandmarkIndices.NOSE_TIP];
    const leftEdge = landmarks[EyeLandmarkIndices.LEFT_FACE_EDGE];
    const rightEdge = landmarks[EyeLandmarkIndices.RIGHT_FACE_EDGE];

    // Raw face width in normalized coords (fraction of frame). Different cameras = different FOV = different value at same distance.
    const rawFaceWidth = Math.sqrt(Math.pow(rightEdge.x - leftEdge.x, 2) + Math.pow(rightEdge.y - leftEdge.y, 2));
    const scale = Math.max(0.5, Math.min(1.5, faceWidthScale ?? 1));
    const faceWidth = Math.max(0.01, Math.min(1, rawFaceWidth * scale));
    const D = Math.max(40, Math.min(90, faceDistanceCm));
    let minFaceWidth = 0.09 + (90 - D) * 0.0012;
    let maxFaceWidth = 0.17 - (D - 40) * 0.0007;
    // Widen band when camera auto-zooms (Center Stage, Studio Effects) so user can still pass
    const tol = Math.max(1, Math.min(3, headDistanceTolerance ?? 1));
    if (tol > 1) {
      const center = (minFaceWidth + maxFaceWidth) / 2;
      const halfBand = ((maxFaceWidth - minFaceWidth) / 2) * tol;
      minFaceWidth = Math.max(0.05, center - halfBand);
      maxFaceWidth = Math.min(0.35, center + halfBand);
    }
    const debug = { faceWidth, minFaceWidth, maxFaceWidth, targetDistanceCm: D };

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

    // 2. Size/Distance Check
    if (faceWidth < minFaceWidth) return { valid: false, message: "Move Closer", debug };
    if (faceWidth > maxFaceWidth) return { valid: false, message: "Move Back", debug };

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

    // Z-Distance proxy (inter-ocular distance; larger = closer to camera)
    const zDistance = Math.abs(leftOuter.x - rightOuter.x) * 10;

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