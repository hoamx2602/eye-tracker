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
import { irisDiameterNorm } from "../lib/irisDepth";

/**
 * Smallest fraction of frame width the face may span.
 *
 * An iris is about 8% of face width, so a face at 0.13 of a 1920-px frame puts
 * roughly 20 px across the iris — around the floor at which landmark and
 * appearance estimates hold up. This is a property of the image alone: it does
 * not depend on the camera's field of view or on how far away the participant
 * is, which is exactly why it can be checked without measuring either.
 *
 * Rescaled from 0.13 when the width metric moved from the face silhouette to the
 * outer-eye-corner span — see rigidFaceWidth. Outer canthal distance is about
 * 90 mm against a bizygomatic width near 145 mm, so the same image quality now
 * shows up as a number about 0.62× as large. The threshold moved with it; what
 * it demands of the picture did not.
 */
const MIN_FACE_WIDTH_FOR_QUALITY = 0.08;

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
const MAX_FACE_WIDTH_SANITY = 0.5;

/**
 * How far the nose may sit from frame centre before positioning fails.
 *
 * Exported because the head-positioning canvas has to draw it. It previously
 * drew a fixed 26%×48% rectangle instead — a shape derived from nothing, checked
 * by nothing, and impossible to satisfy at a normal working distance, where the
 * face is already wider than 26% of the frame. Participants were fitting
 * themselves to a box that had no bearing on whether they passed, while the
 * criteria that did were invisible.
 */
/**
 * Head roll allowed while taking up the starting position, degrees.
 *
 * Chosen to be no tighter than the check it replaces was at any distance the
 * flow supports — that one ranged from 21° down to 10.5° purely as an artefact
 * of how near the participant sat. A real angle needs one number.
 */
export const MAX_HEAD_ROLL_DEG = 15;

/**
 * Head yaw allowed while taking up the starting position, degrees.
 *
 * Generous, because this is not a quality bar — it is the point past which the
 * *distance* reading stops being trustworthy, and reporting a number nobody
 * should act on is worse than asking the participant to face forward. A turned
 * head is also poor for gaze estimation in its own right, since calibration is
 * fitted at one orientation and the model has no data either side of it.
 */
export const MAX_HEAD_YAW_DEG = 20;

/**
 * How far the matrix roll may differ from the geometric roll before the matrix
 * is distrusted. Generous: this is checking that the axes are mapped sanely,
 * not that two estimators agree to the degree.
 */
const MATRIX_ROLL_AGREEMENT_DEG = 20;

/**
 * How much the geometric yaw over-reads a real head turn.
 *
 * Simulation gave 2.6× for average proportions; one participant's telemetry
 * showed 49° reported for roughly 12° of actual turn, near 4×. Three is a
 * middle value, and it is only ever used when the matrix pose is unavailable —
 * a fallback that keeps one set of thresholds meaningful across both paths
 * rather than an estimate anyone should rely on.
 */
const GEOMETRIC_YAW_OVERREAD = 3;

export const HEAD_CENTRE_TOLERANCE_X = 0.06;
export const HEAD_CENTRE_TOLERANCE_Y = 0.08;

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
    /** MediaPipe iris major-axis diameter in fractions of frame width. */
    irisDiameterNorm?: number;
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
    /** Head rotation change since the anchor, degrees. */
    yawDeg?: number;
    pitchDeg?: number;
    rollDeg?: number;
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

  /**
   * Frame width ÷ height, captured from the video each detect().
   *
   * MediaPipe normalises landmark.x by the frame *width* and landmark.y by its
   * *height*, so the two are in different units. Any geometry that mixes them —
   * an angle, a length — is wrong by exactly this ratio until it is divided out.
   */
  private frameAspect = 16 / 9;

  detect(videoElement: HTMLVideoElement, startTimeMs: number): FaceLandmarkerResult | null {
    if (!this.faceLandmarker) return null;
    if (videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
      this.frameAspect = videoElement.videoWidth / videoElement.videoHeight;
    }
    const result = this.faceLandmarker.detectForVideo(videoElement, startTimeMs);
    // Cache the head-pose matrix for this frame. Kept on the instance rather
    // than threaded through four public signatures: every pose consumer runs in
    // the same frame, immediately after this call.
    const m = (result as { facialTransformationMatrixes?: { data: ArrayLike<number> }[] })
      ?.facialTransformationMatrixes?.[0]?.data;
    this.lastTransform = m && m.length >= 16 ? m : null;
    return result;
  }

  /** Head-pose matrix from the most recent detect(), when the model produced one. */
  private lastTransform: ArrayLike<number> | null = null;

  /**
   * Head pose in REAL degrees, from MediaPipe's transformation matrix.
   *
   * The geometric heuristic this replaces reads yaw from how far the nose sits
   * off the line between two face landmarks, scaled by a hand-picked 2π. That
   * scale depends on how far an individual's nose protrudes past those
   * landmarks, so it is wrong by a different factor for every face: simulation
   * put it at 2.6×, one participant's telemetry showed a 12° turn reported as
   * 49°, near 4×. No threshold can be set in units that mean a different thing
   * per person.
   *
   * MediaPipe already computes a proper 4×4 head pose and the landmarker has
   * always been created with `outputFacialTransformationMatrixes: true`. It was
   * simply never used here.
   *
   * Column-major, so m[col*4 + row]. Standard ZYX Euler extraction; MediaPipe's
   * canonical face has X right, Y up, Z toward the viewer, which makes rotation
   * about Y the yaw, about X the pitch and about Z the roll.
   */
  private matrixHeadPose(): HeadPose | null {
    const m = this.lastTransform;
    if (!m) return null;
    const r00 = m[0], r10 = m[1], r20 = m[2];
    const r21 = m[6], r22 = m[10];
    const sy = Math.hypot(r00, r10);
    if (!(sy > 1e-6)) return null;
    return {
      yaw: Math.atan2(-r20, sy),
      pitch: Math.atan2(r21, r22),
      roll: Math.atan2(r10, r00),
    };
  }

  /** Whether the last headPose() came from the matrix or fell back. */
  poseSource: 'matrix' | 'geometric' = 'geometric';

  /**
   * The pose the position checks use.
   *
   * Prefers the matrix, but verifies it against the geometric roll before
   * trusting it. Roll is the one axis the heuristic gets right — it is an atan2
   * across the eye-corner line, a genuine angle with no scale factor to get
   * wrong — so it makes a free cross-check on the matrix's axis convention. If
   * the two disagree grossly the decomposition is mapped to the wrong axes, and
   * silently returning confidently-wrong angles would be worse than falling
   * back to a heuristic whose flaws are at least known.
   */
  headPose(landmarks: NormalizedLandmark[]): HeadPose {
    const geometric = this.calculateGeometricHeadPose(landmarks);
    const matrix = this.matrixHeadPose();
    if (matrix) {
      const disagreementDeg = Math.abs(((matrix.roll - geometric.roll) * 180) / Math.PI);
      if (disagreementDeg <= MATRIX_ROLL_AGREEMENT_DEG) {
        this.poseSource = 'matrix';
        return matrix;
      }
      if (!this.warnedPoseFallback) {
        this.warnedPoseFallback = true;
        console.warn(
          `[pose] matrix roll disagrees with the geometric roll by ${disagreementDeg.toFixed(0)}° — ` +
          'the Euler decomposition is probably mapped to the wrong axes. Falling back.',
        );
      }
    }
    this.poseSource = 'geometric';
    // Bring the heuristic's yaw into approximately real degrees so one set of
    // thresholds covers both paths. The divisor is an average of a bad estimator
    // and is documented as such; it exists so a fallback frame is not judged by
    // a different yardstick than the frame before it.
    return {
      ...geometric,
      yaw: geometric.yaw / GEOMETRIC_YAW_OVERREAD,
    };
  }

  private warnedPoseFallback = false;

  /**
   * The distance metric for `faceScale`: the span between the outer eye corners.
   *
   * It used to be landmarks 234→454, which the enum itself labels "Cheek/Ear
   * region" — the *silhouette* of a three-dimensional head, not two fixed points
   * on a face. A silhouette does not foreshorten when the head turns; the outline
   * shifts onto the side of the skull and the measured width **grows**. Modelled
   * as an ellipse 15 cm wide and 20 cm deep it is 12% wider at 35° of yaw than
   * face-on.
   *
   * `faceScale` then divided by cos(yaw) to undo a foreshortening that had not
   * happened, so both errors pushed the same way. At 35° of yaw a participant
   * sitting at 35 cm was reported at 26 cm and told to move back — which is
   * exactly what a slightly turned head produced on screen.
   *
   * The outer eye corners are a rigid segment of the face. They really do
   * foreshorten as cos(yaw), which is the model the correction assumes, so the
   * two now agree. The span is shorter — about 9 cm against 15 — so landmark
   * noise counts for proportionally more, and that is the price of measuring the
   * thing the maths describes instead of a thing that merely correlates with it.
   *
   * In frame-width units: the vertical component is divided by the aspect ratio
   * before combining, because landmark.y is normalised by frame height.
   */
  rigidFaceWidth(landmarks: NormalizedLandmark[]): number {
    const lo = landmarks[EyeLandmarkIndices.LEFT_OUTER];
    const ro = landmarks[EyeLandmarkIndices.RIGHT_OUTER];
    if (!lo || !ro) return 0;
    return Math.hypot(ro.x - lo.x, (ro.y - lo.y) / this.frameAspect);
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

    const rawFaceWidth = this.rigidFaceWidth(landmarks);
    const pose = this.headPose(landmarks);
    return {
      faceScale: faceScale(rawFaceWidth),
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
          // Rotation was the one fault the readout could not show, so a
          // participant rejected for turning saw an instruction and a debug line
          // with nothing wrong in it.
          yawDeg: res.deviation.yawDeg,
          pitchDeg: res.deviation.pitchDeg,
          rollDeg: res.deviation.rollDeg,
        },
      };
    }

    const nose = landmarks[EyeLandmarkIndices.NOSE_TIP];
    const leftEdge = landmarks[EyeLandmarkIndices.LEFT_FACE_EDGE];
    const rightEdge = landmarks[EyeLandmarkIndices.RIGHT_FACE_EDGE];

    // Between the outer eye corners — a rigid facial segment. See rigidFaceWidth
    // for why the face silhouette cannot be used for this.
    const rawFaceWidth = this.rigidFaceWidth(landmarks);
    const scale = Math.max(0.5, Math.min(1.5, faceWidthScale ?? 1));
    const faceWidth = Math.max(0.01, Math.min(1, rawFaceWidth * scale));
    const D = Math.max(MIN_TARGET_DISTANCE_CM, Math.min(MAX_TARGET_DISTANCE_CM, faceDistanceCm));
    const tol = Math.max(1, Math.min(3, headDistanceTolerance ?? 1));

    // Uncorrected — see faceScale. The cos(yaw) correction this used to apply
    // did more damage than the foreshortening it removed, because the yaw it
    // relied on over-reads by a factor of three. A turned head is caught by the
    // orientation gate below instead, which needs no scale factor to be right.
    const scaleInvariant = faceScale(rawFaceWidth);
    const irisScale = irisDiameterNorm(landmarks, this.frameAspect);
    const distCheck = distanceCalibration
      ? checkDistance(
          distanceCalibration,
          scaleInvariant,
          D,
          tol,
          Number.isFinite(irisScale) ? irisScale : undefined,
        )
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
      ...(Number.isFinite(irisScale) ? { irisDiameterNorm: irisScale } : {}),
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

    const toleranceX = HEAD_CENTRE_TOLERANCE_X;
    const toleranceY = HEAD_CENTRE_TOLERANCE_Y;

    // Mirror-aware: video is shown flipped, so swap Left/Right so instructions match what user sees
    if (Math.abs(nose.x - centerX) > toleranceX) {
      return { valid: false, message: nose.x < centerX ? "Move Left" : "Move Right", debug };
    }
    if (Math.abs(nose.y - centerY) > toleranceY) {
      return { valid: false, message: nose.y < centerY ? "Move Down" : "Move Up", debug };
    }

    // 2. Orientation, before distance — because a turned head corrupts the
    // distance reading, so checking distance first reports the symptom instead
    // of the cause. This is what put "Move Back (27cm → 35cm)" on screen for
    // someone sitting perfectly still at 35 cm who had merely glanced sideways.
    //
    // Even with the width taken from a rigid segment, the cos(yaw) correction
    // leans on a yaw estimate that is itself a heuristic, and its error grows
    // with the angle. Past this point the distance is not worth reporting.
    const pose = this.headPose(landmarks);
    const yawDeg = Math.abs((pose.yaw * 180) / Math.PI);
    if (yawDeg > MAX_HEAD_YAW_DEG) {
      return { valid: false, message: "Face the Screen", debug };
    }

    // 3. Distance check. A measured calibration wins outright — it knows the
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

    // 4. Tilt check, as an actual angle.
    //
    // This was `|leftEdge.y - rightEdge.y| > 0.12` — a vertical offset in frame
    // heights compared against a fixed number, with no reference to how wide the
    // face was. Face width grows as the participant approaches, so the same
    // physical tilt produced a larger offset up close: the gate was 21° at 60 cm,
    // 14° at 40 cm and 10.5° at 30 cm. Moving nearer, which the flow now asks
    // people to do, silently tightened a check that has nothing to do with
    // distance.
    const rollDeg = Math.abs((pose.roll * 180) / Math.PI);
    if (rollDeg > MAX_HEAD_ROLL_DEG) {
      return { valid: false, message: "Straighten Head", debug };
    }

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
    const a = this.frameAspect;

    // Roll, corrected for the frame's aspect ratio.
    //
    // This was atan2(Δy, Δx) on raw normalised coordinates — x measured in frame
    // widths against y measured in frame heights. On a 16:9 frame that scales
    // the tangent by 1.78, so a real 6° head tilt read as 10.6° and failed a 10°
    // gate. Participants were being rejected for a tilt they could not feel, and
    // the error grew with the angle: a genuine 15° read as 25°.
    const roll = Math.atan2(rightEdge.y - leftEdge.y, (rightEdge.x - leftEdge.x) * a);

    // Yaw and pitch are measured in the FACE's frame, not the image's.
    //
    // They used to be taken along the image axes: yaw from (nose.x −
    // faceCentreX), pitch from (nose.y − faceCentreY). But the nose sits below
    // the line joining the two face edges, so when the head *rolls* the nose
    // swings around that line and its image-x offset changes — with no yaw
    // whatsoever. The estimator reported a turn that had not happened.
    //
    // That did not stay contained in the rotation check. faceScale divides the
    // measured width by cos(yaw) to undo foreshortening, so a phantom yaw
    // inflates the apparent face size, which reads as the participant having
    // moved closer, which fires the depth gate. Tilting your head produced
    // "Move Back" — a distance instruction for a rotation that was not real,
    // aimed at someone sitting perfectly still at the right distance.
    //
    // The fix is to project the nose offset onto the face's own axes: ex along
    // the eye-corner line, ey perpendicular to it. Both rotate with the head, so
    // an in-plane roll leaves the projections untouched and the phantom
    // disappears. At zero roll the two frames coincide, so this changes nothing
    // for a level head — which is what makes it safe to apply to calibrations
    // that were recorded under the old formula.
    const ex = { x: (rightEdge.x - leftEdge.x), y: (rightEdge.y - leftEdge.y) / a };
    const faceWidth = Math.hypot(ex.x, ex.y);
    const ux = faceWidth > 0 ? { x: ex.x / faceWidth, y: ex.y / faceWidth } : { x: 1, y: 0 };
    // Perpendicular, pointing down the face. Rotating (ux) by +90° in a
    // y-down image frame gives (−uy, ux).
    const uy = { x: -ux.y, y: ux.x };

    const faceCenterX = (leftEdge.x + rightEdge.x) / 2;
    const faceCenterY = (leftEdge.y + rightEdge.y) / 2;
    const nx = nose.x - faceCenterX;
    const ny = (nose.y - faceCenterY) / a;

    const alongFace = nx * ux.x + ny * ux.y;
    const yaw = faceWidth > 0 ? (alongFace / faceWidth) * Math.PI * 2 : 0;

    // Pitch keeps its own vertical reference — the crown-to-chin span — because
    // that is what its scale factor was tuned against, and the tolerance is set
    // in those units. Only the measurement axis changes, from the image's y to
    // the face's own.
    //
    // Everything here is in frame-WIDTH units, including faceHeight: mixing the
    // two axes is what the aspect correction exists to prevent, and dividing a
    // width-unit numerator by a height-unit span would have rescaled pitch by
    // 1.78 while leaving the threshold where it was.
    const faceHeight = Math.hypot(chin.x - top.x, (chin.y - top.y) / a);
    const cx = (top.x + chin.x) / 2 - faceCenterX;
    const cy = ((top.y + chin.y) / 2 - faceCenterY) / a;
    const noseBelowEyes = nx * uy.x + ny * uy.y;
    const centreBelowEyes = cx * uy.x + cy * uy.y;
    const pitch =
      faceHeight > 0 ? ((noseBelowEyes - centreBelowEyes) / faceHeight) * Math.PI : 0;

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
