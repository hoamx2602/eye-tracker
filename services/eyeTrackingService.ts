import { FaceLandmarker, FilesetResolver, NormalizedLandmark } from "@mediapipe/tasks-vision";
import { EyeLandmarkIndices, EyeFeatures } from "../types";

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
      outputFaceBlendshapes: false,
      runningMode: this.runningMode,
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5
    });
  }

  detect(videoElement: HTMLVideoElement, startTimeMs: number) {
    if (!this.faceLandmarker) return null;
    return this.faceLandmarker.detectForVideo(videoElement, startTimeMs);
  }

  /**
   * Detects if the eyes are closed based on landmarks
   */
  isBlinking(landmarks: NormalizedLandmark[]): boolean {
      if (!landmarks) return false;

      const getDist = (i1: number, i2: number) => {
        const p1 = landmarks[i1];
        const p2 = landmarks[i2];
        return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
      };
  
      // Vertical Distances
      const leftH = getDist(EyeLandmarkIndices.LEFT_TOP, EyeLandmarkIndices.LEFT_BOTTOM);
      const rightH = getDist(EyeLandmarkIndices.RIGHT_TOP, EyeLandmarkIndices.RIGHT_BOTTOM);
      
      // Horizontal Distances (Eye Width)
      const leftW = getDist(EyeLandmarkIndices.LEFT_INNER, EyeLandmarkIndices.LEFT_OUTER);
      const rightW = getDist(EyeLandmarkIndices.RIGHT_INNER, EyeLandmarkIndices.RIGHT_OUTER);
      
      // Eye Aspect Ratio (EAR)
      // Avoid division by zero
      const leftRatio = leftW > 0 ? leftH / leftW : 0;
      const rightRatio = rightW > 0 ? rightH / rightW : 0;
      
      // Threshold: 0.18 is a common empirical threshold for MediaPipe face mesh to detect closed eyes
      return (leftRatio < 0.18 || rightRatio < 0.18);
  }

  /**
   * Extracts eye features from raw landmarks.
   * Calculates normalized pupil position relative to the eye bounding box (corners).
   * This provides Head Pose Compensation effectively in 2D.
   */
  extractEyeFeatures(landmarks: NormalizedLandmark[]): EyeFeatures | null {
    if (!landmarks || landmarks.length < 478) return null;

    const getPoint = (index: number) => ({ x: landmarks[index].x, y: landmarks[index].y });

    // Iris Centers
    const leftPupil = getPoint(EyeLandmarkIndices.LEFT_IRIS_CENTER);
    const rightPupil = getPoint(EyeLandmarkIndices.RIGHT_IRIS_CENTER);

    // Eye Corners
    const leftInner = getPoint(EyeLandmarkIndices.LEFT_INNER);
    const leftOuter = getPoint(EyeLandmarkIndices.LEFT_OUTER);
    const rightInner = getPoint(EyeLandmarkIndices.RIGHT_INNER);
    const rightOuter = getPoint(EyeLandmarkIndices.RIGHT_OUTER);

    // Calculate relative vectors (Head Pose Compensation Logic)
    // We normalize the pupil position against the width of the eye.
    // X relative: 0.0 (inner corner) -> 1.0 (outer corner)
    
    // Left Eye processing
    const leftWidth = Math.sqrt(Math.pow(leftOuter.x - leftInner.x, 2) + Math.pow(leftOuter.y - leftInner.y, 2));
    // Project pupil vector onto eye-width vector
    const leftRelX = ((leftPupil.x - leftInner.x) * (leftOuter.x - leftInner.x) + (leftPupil.y - leftInner.y) * (leftOuter.y - leftInner.y)) / (leftWidth * leftWidth);
    const leftRelY = (leftPupil.y - (leftInner.y + leftOuter.y) / 2) * 10; // Vertical is trickier, simplified scaling relative to center

    // Right Eye processing
    const rightWidth = Math.sqrt(Math.pow(rightOuter.x - rightInner.x, 2) + Math.pow(rightOuter.y - rightInner.y, 2));
    const rightRelX = ((rightPupil.x - rightInner.x) * (rightOuter.x - rightInner.x) + (rightPupil.y - rightInner.y) * (rightOuter.y - rightInner.y)) / (rightWidth * rightWidth);
    const rightRelY = (rightPupil.y - (rightInner.y + rightOuter.y) / 2) * 10;

    return {
      leftPupil,
      rightPupil,
      leftEyeCenter: { x: (leftInner.x + leftOuter.x)/2, y: (leftInner.y + leftOuter.y)/2 },
      rightEyeCenter: { x: (rightInner.x + rightOuter.x)/2, y: (rightInner.y + rightOuter.y)/2 },
      leftRelative: { x: leftRelX, y: leftRelY },
      rightRelative: { x: rightRelX, y: rightRelY }
    };
  }

  /**
   * Prepares the feature vector for Regression.
   * Input: EyeFeatures
   * Output: Array of numbers [1, Lx, Ly, Rx, Ry, Lx^2, Ly^2...]
   */
  prepareFeatureVector(features: EyeFeatures): number[] {
    const lx = features.leftRelative.x;
    const ly = features.leftRelative.y;
    const rx = features.rightRelative.x;
    const ry = features.rightRelative.y;

    // Polynomial Expansion (2nd Degree) + Interaction terms
    // This allows the linear model to fit curved relationships
    return [
      1, // Bias
      lx, ly, rx, ry, // Linear
      lx * lx, ly * ly, rx * rx, ry * ry, // Quadratic
      lx * ly, rx * ry // Interaction
    ];
  }
}

export const eyeTrackingService = new EyeTrackingService();