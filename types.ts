export interface Point {
  x: number;
  y: number;
}

export interface CalibrationPoint extends Point {
  id: number;
  completed: boolean;
}

export interface EyeFeatures {
  leftPupil: Point;
  rightPupil: Point;
  leftEyeCenter: Point;
  rightEyeCenter: Point;
  // Normalized vector (0-1) of pupil position relative to eye corners
  leftRelative: Point;
  rightRelative: Point;
}

export interface TrainingSample {
  screenX: number;
  screenY: number;
  features: number[]; // Flattened vector for regression
}

export type AppState = 'IDLE' | 'LOADING_MODEL' | 'CALIBRATION' | 'TRACKING';

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
  RIGHT_IRIS_CENTER = 473
}