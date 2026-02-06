import { FaceLandmarker, FilesetResolver, NormalizedLandmark, FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { EyeLandmarkIndices, EyeFeatures, HeadPose } from "../types";

export interface HeadValidationResult {
  valid: boolean;
  message: string;
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
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
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
   * @param landmarks MediaPipe landmarks
   */
  validateHeadPosition(landmarks: NormalizedLandmark[]): HeadValidationResult {
    if (!landmarks) return { valid: false, message: "No Face Detected" };

    const nose = landmarks[EyeLandmarkIndices.NOSE_TIP];
    const leftEdge = landmarks[EyeLandmarkIndices.LEFT_FACE_EDGE];
    const rightEdge = landmarks[EyeLandmarkIndices.RIGHT_FACE_EDGE];

    // 1. Center Check (Horizontal & Vertical)
    const centerX = 0.5;
    const centerY = 0.5;
    
    // STRICTER TOLERANCE: Force the user to be very close to the center.
    // Previous values (0.15/0.2) were too loose, allowing the face to be halfway out of the box.
    const toleranceX = 0.06; // +/- 6% from center (Total 12% zone)
    const toleranceY = 0.08; // +/- 8% from center (Total 16% zone)

    if (Math.abs(nose.x - centerX) > toleranceX) {
      return { valid: false, message: nose.x < centerX ? "Move Right" : "Move Left" };
    }
    if (Math.abs(nose.y - centerY) > toleranceY) {
      return { valid: false, message: nose.y < centerY ? "Move Down" : "Move Up" };
    }

    // 2. Size/Distance Check (Face Width)
    const faceWidth = Math.sqrt(Math.pow(rightEdge.x - leftEdge.x, 2) + Math.pow(rightEdge.y - leftEdge.y, 2));
    
    // RELAXED LOGIC:
    // Instead of enforcing a specific CM distance, we ensure the face resolution is good enough for TPS.
    // Too small (< 15% width): Webcam can't see eyes clearly.
    // Too big (> 60% width): Face might clip out of frame when looking at corners.
    
    if (faceWidth < 0.15) return { valid: false, message: "Move Closer" };
    if (faceWidth > 0.60) return { valid: false, message: "Move Back" };

    // 3. Tilt Check (Head Rotation)
    const tilt = Math.abs(leftEdge.y - rightEdge.y);
    if (tilt > 0.12) return { valid: false, message: "Straighten Head" };

    return { valid: true, message: "Perfect! Hold Steady..." };
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

  extractEyeFeatures(landmarks: NormalizedLandmark[]): EyeFeatures | null {
    if (!landmarks || landmarks.length < 478) return null;

    const getPoint = (index: number) => ({ x: landmarks[index].x, y: landmarks[index].y });

    const leftPupil = getPoint(EyeLandmarkIndices.LEFT_IRIS_CENTER);
    const rightPupil = getPoint(EyeLandmarkIndices.RIGHT_IRIS_CENTER);
    
    // Eye Centers (Anchor points)
    const leftInner = getPoint(EyeLandmarkIndices.LEFT_INNER);
    const leftOuter = getPoint(EyeLandmarkIndices.LEFT_OUTER);
    const rightInner = getPoint(EyeLandmarkIndices.RIGHT_INNER);
    const rightOuter = getPoint(EyeLandmarkIndices.RIGHT_OUTER);
    
    const leftCenter = { x: (leftInner.x + leftOuter.x)/2, y: (leftInner.y + leftOuter.y)/2 };
    const rightCenter = { x: (rightInner.x + rightOuter.x)/2, y: (rightInner.y + rightOuter.y)/2 };

    const leftWidth = Math.sqrt(Math.pow(leftOuter.x - leftInner.x, 2) + Math.pow(leftOuter.y - leftInner.y, 2));
    const rightWidth = Math.sqrt(Math.pow(rightOuter.x - rightInner.x, 2) + Math.pow(rightOuter.y - rightInner.y, 2));
    
    // Vector from Center to Pupil
    const lx = (leftPupil.x - leftCenter.x) / leftWidth;
    const ly = (leftPupil.y - leftCenter.y) / leftWidth; 
    
    const rx = (rightPupil.x - rightCenter.x) / rightWidth;
    const ry = (rightPupil.y - rightCenter.y) / rightWidth;

    const headPose = this.calculateGeometricHeadPose(landmarks);

    return {
      leftPupil,
      rightPupil,
      leftEyeCenter: leftCenter,
      rightEyeCenter: rightCenter,
      leftRelative: { x: lx * 10, y: ly * 10 }, 
      rightRelative: { x: rx * 10, y: ry * 10 },
      headPose
    };
  }

  prepareFeatureVector(features: EyeFeatures): number[] {
    const lx = features.leftRelative.x;
    const ly = features.leftRelative.y;
    const rx = features.rightRelative.x;
    const ry = features.rightRelative.y;
    
    const pitch = features.headPose.pitch;
    const yaw = features.headPose.yaw;
    const roll = features.headPose.roll;

    const lR = Math.sqrt(lx*lx + ly*ly);
    const lTheta = Math.atan2(ly, lx);
    const rR = Math.sqrt(rx*rx + ry*ry);
    const rTheta = Math.atan2(ry, rx);

    return [
      1, // Bias
      lx, ly, rx, ry, 
      lR, lTheta, rR, rTheta,
      pitch, yaw, roll,
      lx * yaw, rx * yaw,
      ly * pitch, ry * pitch,
      lx * lx, ly * ly
    ];
  }
}

export const eyeTrackingService = new EyeTrackingService();