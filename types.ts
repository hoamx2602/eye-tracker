
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
  /** In-memory only: face frame to upload for this sample. Omitted when sending to API. */
  blobForUpload?: Blob;
  /** Pattern name for display (e.g. "Grid point 1", "horizontal", "h_pattern"). */
  patternName?: string;
  /**
   * Robust (per-field median) EyeFeatures of the frames the sample was built from.
   * Stored so feature flags can be toggled and LOOCV re-evaluated without re-calibrating.
   */
  rawEyeFeatures?: EyeFeatures;
  /** How the sample was selected and how clean it was (see lib/fixationSampling). */
  quality?: SampleQuality;
}

/** Per-sample provenance and quality, saved with the calibration samples. */
export interface SampleQuality {
  /**
   * fixation          — gaze-contingent stable run on a dot
   * fixation_fallback — no complete stable run; best run found before timeout
   * pause             — endpoint pause of an eye-movement exercise
   * pursuit           — latency-compensated bin of a moving exercise target
   */
  method: 'fixation' | 'fixation_fallback' | 'pause' | 'pursuit';
  nFrames: number;
  spanMs: number;
  /** Dot onset → first frame used: a latency-to-stable-fixation proxy. */
  settleMs?: number;
  /** RMS spread of the used frames around their median, in iris-offset units. */
  dispersion?: number;
  /** How many times this dot was presented before this sample was kept. */
  attempts?: number;
  /** Target→feature delay applied to pursuit labels. */
  lagMs?: number;
  /** Validation dots: RMS sample-to-sample distance of the mapped frames (px). */
  precisionRmsS2SPx?: number;
  /** Validation dots: SD of the mapped frames around their mean (px). */
  precisionSdPx?: number;
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

/**
 * Range of target viewing distances the app will accept, in cm.
 *
 * One definition for the setup sliders and for the head-position check in
 * `services/eyeTrackingService.ts`, so a slider can never offer a distance the
 * check refuses.
 */
export const MIN_FACE_DISTANCE_CM = 30;
export const MAX_FACE_DISTANCE_CM = 90;

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
  /** Drop off-screen samples and spikes, leaving gaps; no smoothing (lib/smoothing.ts). */
  REMOVE_OUTLIERS = 'REMOVE_OUTLIERS',
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

/** One line per exercise, shown on the break screen so the next task is never a surprise. */
export const EXERCISE_KIND_DESCRIPTIONS: Record<EyeMovementKind, string> = {
  wiggling: 'A dot traces a smooth looping path. Follow it with your eyes, head still.',
  horizontal: 'A dot moves side to side, pausing at each edge. Follow it left and right.',
  vertical: 'A dot moves up and down, pausing at the top and bottom. Keep your chin level.',
  forward_backward: 'A dot in the centre grows and shrinks. Keep your eyes on its centre.',
  diagonal: 'A dot jumps between the corners of the screen. Follow it into each corner.',
  h_pattern: 'A dot traces the shape of a letter H, pausing at each turning point.',
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
  faceDistance: number; // Target distance in CM, within MIN/MAX_FACE_DISTANCE_CM (e.g. 30, 50, 60)
  /** Scale for face width from different camera FOV (1 = built-in, &lt;1 e.g. 0.7 for external webcam so 60cm passes) */
  faceWidthScale: number;
  /** Widen acceptable distance band (1 = strict, 2 = 2x band for cameras that auto-zoom). Default 2 to cope with Center Stage / Studio Effects. */
  headDistanceTolerance: number;

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
  // Replayed over 69 stored sessions (scripts/check-gaze-mapping.ts): TPS beat the
  // ridge on 52% of them — a coin toss — while the standardised ridge beats the old
  // unstandardised one on 67%. The extra machinery bought nothing, so ridge is the default.
  regressionMethod: RegressionMethod.RIDGE,
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
  // 24 dots = 6 x 4, a full rectangle at roughly equal angular spacing both ways.
  // Replaying the stored sessions, validation error falls steadily with dot count
  // (6: 277 px, 9: 226, 12: 199, 16: 195, 20: 181), and the outer ring is what
  // holds the edges together. At ~2.5 s a dot this is about a minute of grid.
  calibrationPointsCount: 24,
  clickDuration: 1.5, // 1.5 seconds hold

  // Outlier Defaults — 10% trim keeps the middle 80% of each capture window,
  // up from the previous 50% (was 25% each end). More data = more stable regression.
  outlierMethod: OutlierMethod.TRIM_TAILS,
  outlierThreshold: 0.10, // Trim 10% from each end (was 0.25)
  
  // Distance
  faceDistance: 60, // Standard desktop distance (60cm)
  faceWidthScale: 1, // 1 = built-in cam; use ~0.65–0.8 for external 1080p webcam
  headDistanceTolerance: 2, // 2 = wider band so auto-zoom cameras (Center Stage etc.) don't block

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
  // Outliers are dropped for every method except NONE; this one adds no smoothing
  // on top, so what is plotted is measured data (scripts/check-gaze-postprocess.ts).
  chartSmoothingMethod: ChartSmoothingMethod.REMOVE_OUTLIERS,
  chartSmoothingWindow: 5,

  // Glasses Optimization Defaults
  glassesOptimization: true,
  glassesEarThreshold: 0.15,
  glassesMaxJumpPx: 200,
  glassesMaxHoldFrames: 5,
  glassesKalmanRMultiplier: 9,
  glassesMaxOutputJumpPx: 150,
};
