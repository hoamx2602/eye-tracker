
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
}

export type AppState = 'IDLE' | 'LOADING_MODEL' | 'HEAD_POSITIONING' | 'CALIBRATION' | 'TRACKING';

export enum CalibrationPhase {
  INITIAL_MAPPING = 'INITIAL_MAPPING',
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
  calibrationSpeed: 'FAST' | 'NORMAL' | 'SLOW';
  
  // Data Hygiene (Outlier) Params
  outlierMethod: OutlierMethod;
  outlierThreshold: number; // For TRIM: %, For STD_DEV: Sigma count
  
  // Head Positioning
  faceDistance: number; // Target distance in CM (e.g. 50, 60, 70)

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

  calibrationSpeed: 'NORMAL',

  // Outlier Defaults
  outlierMethod: OutlierMethod.TRIM_TAILS,
  outlierThreshold: 0.25, // Trim 25% from each end
  
  // Distance
  faceDistance: 60, // Standard desktop distance (60cm)

  // Recording Defaults
  enableVideoRecording: true,
  faceCaptureInterval: 5 // Capture face every 5 seconds
};
