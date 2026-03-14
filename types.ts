
export interface Point {
  x: number;
  y: number;
}

export interface CalibrationPoint extends Point {
  id: number;
  completed: boolean;
}

export interface HeadPose {
  pitch: number; // Up/Down (X-axis rotation)
  yaw: number;   // Left/Right (Y-axis rotation)
  roll: number;  // Tilt (Z-axis rotation)
}

export interface EyeFeatures {
  leftPupil: Point;
  rightPupil: Point;
  leftEyeCenter: Point;
  rightEyeCenter: Point;
  // Normalized vector (0-1) of pupil position relative to eye corners
  leftRelative: Point;
  rightRelative: Point;
  headPose: HeadPose; // Added for compensation
}

export interface TrainingSample {
  screenX: number;
  screenY: number;
  features: number[]; // Flattened vector for regression
  timestamp?: number; // For API export (calibration capture)
  /** Head validation snapshot at capture time (for per-sample storage). */
  head?: HeadSnapshot;
  /** Filled after upload when saving session. */
  imageUrl?: string;
  /** In-memory only: blob to upload for this sample (exercise). Omitted when sending to API. */
  blobForUpload?: Blob;
  /** Pattern name for display (e.g. "Grid point 1", "horizontal", "h_pattern"). */
  patternName?: string;
}

/** Serializable head validation snapshot for calibration samples. */
export interface HeadSnapshot {
  valid: boolean;
  message: string;
  faceWidth?: number;
  minFaceWidth?: number;
  maxFaceWidth?: number;
  targetDistanceCm?: number;
}

export type AppState = 'IDLE' | 'LOADING_MODEL' | 'HEAD_POSITIONING' | 'CALIBRATION' | 'TRACKING' | 'POST_CALIBRATION_CHOICE' | 'NEURO_FLOW';

export type TrackingMode = 'free_gaze' | 'random_dots' | 'article_reading';

export enum CalibrationPhase {
  INITIAL_MAPPING = 'INITIAL_MAPPING',
  EXERCISES = 'EXERCISES',
  FINE_TUNING = 'FINE_TUNING',
  VALIDATION = 'VALIDATION'
}

export enum EyeLandmarkIndices {
  // Left Eye
  LEFT_INNER = 133,
  LEFT_OUTER = 33,
  LEFT_TOP = 159,
  LEFT_BOTTOM = 145,
  LEFT_IRIS_CENTER = 468,

  // Right Eye
  RIGHT_INNER = 362,
  RIGHT_OUTER = 263,
  RIGHT_TOP = 386,
  RIGHT_BOTTOM = 374,
  RIGHT_IRIS_CENTER = 473,

  // Face Layout for Head Pose
  NOSE_TIP = 1,
  HEAD_TOP = 10,
  CHIN_BOTTOM = 152,
  LEFT_FACE_EDGE = 234,  // Cheek/Ear region
  RIGHT_FACE_EDGE = 454  // Cheek/Ear region
}

// --- CONFIGURATION TYPES ---

export enum RegressionMethod {
  RIDGE = 'RIDGE', // Simple, Global
  HYBRID = 'HYBRID', // Ridge + k-NN Residuals
  TPS = 'TPS' // Thin Plate Splines (Best non-linear)
}

export enum SmoothingMethod {
  NONE = 'NONE',
  MOVING_AVERAGE = 'MOVING_AVERAGE', // Simple averaging
  ONE_EURO = 'ONE_EURO', // Adaptive
  KALMAN = 'KALMAN' // Predictive
}

export enum OutlierMethod {
  NONE = 'NONE',
  TRIM_TAILS = 'TRIM_TAILS', // Cut off top/bottom %
  STD_DEV = 'STD_DEV' // Keep within Mean +/- Sigma
}

export enum CalibrationMethod {
  TIMER = 'TIMER', // Original auto-timer
  CLICK_HOLD = 'CLICK_HOLD' // New click and hold method
}

// --- EYE MOVEMENT EXERCISE TYPES ---
export type EyeMovementKind =
  | 'wiggling'
  | 'horizontal'
  | 'vertical'
  | 'forward_backward'
  | 'diagonal'
  | 'h_pattern';

export const EXERCISE_KINDS: EyeMovementKind[] = [
  'wiggling',
  'horizontal',
  'vertical',
  'forward_backward',
  'diagonal',
  'h_pattern',
];

/** Human-readable labels for pattern names (Calibration grid uses "Grid point N" separately). */
export const EXERCISE_KIND_LABELS: Record<EyeMovementKind, string> = {
  wiggling: 'Wiggling',
  horizontal: 'Horizontal',
  vertical: 'Vertical',
  forward_backward: 'Forward-Backward',
  diagonal: 'Diagonal',
  h_pattern: 'H-Pattern',
};

export function getPatternDisplayName(kind: EyeMovementKind): string {
  return EXERCISE_KIND_LABELS[kind] ?? kind;
}

export interface AppConfig {
  regressionMethod: RegressionMethod;
  smoothingMethod: SmoothingMethod;
  
  // Smoothing Params
  // 1. OneEuro
  minCutoff: number; 
  beta: number;      
  // 2. Moving Average
  maWindow: number; // Number of frames to average
  // 3. Kalman
  kalmanQ: number; // Process Noise (Sensitivity to movement)
  kalmanR: number; // Measurement Noise (Smoothness)
  
  // Saccade Detection
  saccadeThreshold: number; // Distance in pixels to consider a saccade (jump)

  // Calibration Params
  calibrationMethod: CalibrationMethod;
  calibrationSpeed: 'FAST' | 'NORMAL' | 'SLOW'; // Only used for TIMER method
  calibrationPointsCount: number; // Number of calibration points
  clickDuration: number; // Seconds (for CLICK_HOLD method)
  
  // Data Hygiene (Outlier) Params
  outlierMethod: OutlierMethod;
  outlierThreshold: number; // For TRIM: %, For STD_DEV: Sigma count
  
  // Head Positioning
  faceDistance: number; // Target distance in CM (e.g. 50, 60, 70)
  /** Scale for face width from different camera FOV (1 = built-in, &lt;1 e.g. 0.7 for external webcam so 60cm passes) */
  faceWidthScale: number;

  // Eye Movement Exercises (additional calibration patterns for better accuracy)
  enableExercises: boolean;

  // --- RECORDING & CAPTURE ---
  enableVideoRecording: boolean;
  faceCaptureInterval: number; // Seconds. 0 to disable.
}

export const DEFAULT_CONFIG: AppConfig = {
  regressionMethod: RegressionMethod.TPS, // Default to TPS now
  smoothingMethod: SmoothingMethod.ONE_EURO,
  
  // Smoothing Defaults
  minCutoff: 0.005, // High smoothing when still
  beta: 0.01,
  maWindow: 5,
  kalmanQ: 0.01,
  kalmanR: 0.1,
  
  saccadeThreshold: 50, // If jump > 50px, reduce smoothing temporarily

  // Calibration Defaults
  calibrationMethod: CalibrationMethod.TIMER,
  calibrationSpeed: 'NORMAL',
  calibrationPointsCount: 9, // Default to 9 points
  clickDuration: 1.5, // 1.5 seconds hold

  // Outlier Defaults
  outlierMethod: OutlierMethod.TRIM_TAILS,
  outlierThreshold: 0.25, // Trim 25% from each end
  
  // Distance
  faceDistance: 60, // Standard desktop distance (60cm)
  faceWidthScale: 1, // 1 = built-in cam; use ~0.65–0.8 for external 1080p webcam

  // Exercises
  enableExercises: true,

  // Recording Defaults
  enableVideoRecording: true,
  faceCaptureInterval: 5 // Capture face every 5 seconds
};
