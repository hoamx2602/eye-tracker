
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
  headPose: HeadPose; // Geometric head pose (heuristic approximation)
  zDistance: number;  // Pseudo-Z axis measurement (inter-ocular distance scaled)
  // --- Optimization fields (populated when MediaPipe outputs are enabled) ---
  leftEAR: number;           // Eye Aspect Ratio: openness metric to compensate partial closure
  rightEAR: number;
  blendshapes?: Record<string, number>; // MediaPipe neural-network eye-gaze blendshape scores
  matrixHeadPose?: HeadPose;            // Head pose from 4×4 transformation matrix (more accurate than geometric)
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
  /**
   * Raw averaged EyeFeatures at capture time.
   * Stored so feature flags can be toggled and LOOCV re-evaluated without re-calibrating.
   * Only populated for grid calibration points (not exercise data).
   */
  rawEyeFeatures?: EyeFeatures;
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

export type AppState = 'IDLE' | 'LOADING_MODEL' | 'DISTANCE_CALIBRATION' | 'HEAD_POSITIONING' | 'CALIBRATION' | 'TRACKING' | 'POST_CALIBRATION_CHOICE' | 'NEURO_FLOW';

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

export enum ChartSmoothingMethod {
  NONE = 'NONE',
  MOVING_AVERAGE = 'MOVING_AVERAGE',
  GAUSSIAN = 'GAUSSIAN',
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
  /**
   * Target eye-to-screen distance in cm (30–60).
   *
   * Closer is not uniformly better. Iris pixels scale as 1/d, but so does the
   * angle the screen subtends: at 30 cm the screen corners sit ~33° from centre,
   * past the ~25° where people start turning the head instead of the eyes, which
   * would turn an oculomotor test into a head-movement test. Below 30 cm the
   * downward gaze to the bottom of the screen also starts occluding the iris
   * behind the eyelid, and many fixed-focus webcams stop focusing.
   */
  faceDistance: number;
  /** Scale for face width from different camera FOV (1 = built-in, &lt;1 e.g. 0.7 for external webcam so 60cm passes) */
  faceWidthScale: number;
  /** Widen acceptable distance band (1 = strict, 2 = 2x band for cameras that auto-zoom). Default 2 to cope with Center Stage / Studio Effects. */
  headDistanceTolerance: number;
  /** Multiplier on the per-axis head-rotation tolerances (lib/positionAnchor.ts). */
  headRotationTolerance: number;

  // Eye Movement Exercises (additional calibration patterns for better accuracy)
  enableExercises: boolean;

  // --- FEATURE FLAGS (can be toggled; re-evaluate LOOCV without re-calibrating) ---
  /** Include Eye Aspect Ratio (openness) in feature vector. Compensates partial-closure noise. */
  useEAR: boolean;
  /** Include MediaPipe neural-network eye-gaze blendshape scores in feature vector. */
  useBlendshapes: boolean;
  /** Use head pose from 3D transformation matrix instead of geometric approximation. */
  useTransformationMatrix: boolean;
  /** Add rx², ry², and binocular vergence (lx−rx) to feature vector for symmetric coverage. */
  useSymmetricFeatures: boolean;

  // --- RECORDING & CAPTURE ---
  enableVideoRecording: boolean;
  faceCaptureInterval: number; // Seconds. 0 to disable.

  // --- CHART DISPLAY ---
  chartSmoothingMethod: ChartSmoothingMethod;
  chartSmoothingWindow: number; // Frames (2–30)

  // --- CALIBRATION CAPTURE ---
  /**
   * Start recording a calibration dot when the eye has actually settled on it,
   * instead of after a fixed wait. The fixed wait recorded the approach saccade
   * on corner dots — the targets that dominate calibration error. The timed
   * behaviour remains as a backstop, so a dot that never settles is still
   * recorded, just flagged. Default true.
   */
  gazeContingentCalibration: boolean;

  // --- GLASSES OPTIMIZATION ---
  /** Master toggle. When true + participant reports wearing glasses, all sub-features activate. */
  glassesOptimization: boolean;
  /** EAR below this → frame treated as artifact (glare/blink). Default 0.15. */
  glassesEarThreshold: number;
  /** Max gaze delta px/frame before hard rejection. Default 200. */
  glassesMaxJumpPx: number;
  /** Max consecutive hold-last-valid frames before tracking-lost. Default 5. */
  glassesMaxHoldFrames: number;
  /** Kalman R multiplier at quality=0 (1 = no boost, 9 = 9× R). Default 9. */
  glassesKalmanRMultiplier: number;
  /** Post-smoother output clamp px/frame. Default 150. */
  glassesMaxOutputJumpPx: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  regressionMethod: RegressionMethod.TPS, // Default to TPS now
  smoothingMethod: SmoothingMethod.ONE_EURO,
  
  // Smoothing Defaults — tuned for clinical assessment (low lag + fast saccade response).
  // beta was 0.01 (≈200ms saccade lag, corrupts reaction-time tests). Raise toward 0.7
  // if the cursor still trails during fast saccades; lower if it looks jittery.
  minCutoff: 0.01, // was 0.005 — less lag during smooth pursuit
  beta: 0.5,       // was 0.01  — responds to saccades within 1–2 frames
  maWindow: 5,
  kalmanQ: 0.01,
  kalmanR: 0.1,
  
  saccadeThreshold: 50, // If jump > 50px, reduce smoothing temporarily

  // Calibration Defaults
  calibrationMethod: CalibrationMethod.TIMER,
  calibrationSpeed: 'NORMAL',
  calibrationPointsCount: 9, // Default to 9 points
  clickDuration: 1.5, // 1.5 seconds hold

  // Outlier Defaults — 10% trim keeps the middle 80% of each capture window,
  // up from the previous 50% (was 25% each end). More data = more stable regression.
  outlierMethod: OutlierMethod.TRIM_TAILS,
  outlierThreshold: 0.10, // Trim 10% from each end (was 0.25)
  
  // Distance
  // Closer is better on both terms that matter: the iris gets more pixels (noise
  // scales with 1/d), and a given angular error lands fewer centimetres off on
  // screen. 40 cm is where that stops paying — nearer, the screen subtends so
  // much visual angle that the participant turns their head to reach the corners
  // instead of just their eyes, which is exactly what the position anchor is
  // there to reject. Admin can still move it; this is only where it starts.
  faceDistance: 40,
  faceWidthScale: 1, // 1 = built-in cam; use ~0.65–0.8 for external 1080p webcam
  // Multiplier on the science-derived distance band (lib/viewingDistance.ts).
  // 1 = ±5% of the target, which is 10% on BCEA and the most posture may spend.
  //
  // This was 2, sized for auto-zoom cameras back when distance was inferred from
  // a hand-tuned face-width band. Both halves of that rationale are gone: zoom is
  // pinned to its minimum and re-applied every two seconds, and distance is now
  // measured rather than guessed. Widen it only for a rig that genuinely cannot
  // hold position, and knowing it widens the task, not just the tolerance.
  headDistanceTolerance: 1,
  // Multiplier on yaw 12° / pitch 15° / roll 25°. The three differ because the
  // three cost different amounts — see AnchorTolerance. Raise this if
  // participants are being sent back for movements that are not actually
  // breaking the mapping; the head-positioning readout prints the live figures.
  headRotationTolerance: 1,

  // Exercises
  enableExercises: true,

  // Feature Flags — enabled for accuracy (verified safe: calibration collects ~300+
  // samples across the 9 points, so N ≫ vector dim even at 30D — TPS N>D+1 holds).
  // Blendshapes stay off (need ≥12–16 calibration points for the +8 dims).
  useEAR: true,                 // was false — compensates squint-induced vertical error
  useBlendshapes: false,
  useTransformationMatrix: true,// was false — accurate head pose beyond ~15° rotation
  useSymmetricFeatures: true,   // was false — adds rx², ry², (lx−rx) vergence; fixes asymmetric correction

  // Recording Defaults
  enableVideoRecording: true,
  faceCaptureInterval: 5, // Capture face every 5 seconds

  // Chart Display Defaults
  chartSmoothingMethod: ChartSmoothingMethod.MOVING_AVERAGE,
  chartSmoothingWindow: 7,

  // Calibration Capture Defaults
  gazeContingentCalibration: true,

  // Glasses Optimization Defaults
  glassesOptimization: true,
  glassesEarThreshold: 0.15,
  glassesMaxJumpPx: 200,
  glassesMaxHoldFrames: 5,
  glassesKalmanRMultiplier: 9,
  glassesMaxOutputJumpPx: 150,
};
