/**
 * IGazeEngine — universal contract for all gaze tracking backends.
 *
 * Swap MediaPipe ↔ RemoteModel ↔ Mock without touching a single UI component.
 * Each engine owns its own lifecycle: camera, model, workers, smoothing.
 */

// ─── Shared Data Types ──────────────────────────────────────────────────────

export interface GazeResult {
  /** Screen-space X in pixels. */
  x: number;
  /** Screen-space Y in pixels. */
  y: number;
  /** performance.now() at the time of measurement. */
  timestamp: number;
  /**
   * 0–1. Engines that don't support confidence natively must return 1.
   * Drop to ≤ 0.3 on blink or partial occlusion.
   */
  confidence: number;
}

export interface HeadPoseResult {
  /** Vertical tilt in radians — positive = looking down. */
  pitch: number;
  /** Horizontal turn in radians — positive = looking right. */
  yaw: number;
  /** Head tilt/roll in radians. */
  roll: number;
  timestamp: number;
}

/** A labeled gaze sample fed to the engine after the user completes calibration UI. */
export interface CalibrationSample {
  /** Screen-space target X the user looked at (px). */
  screenX: number;
  /** Screen-space target Y the user looked at (px). */
  screenY: number;
  /**
   * Pre-built feature vector captured during calibration.
   * The engine's regression model trains directly on these vectors.
   */
  featureVector: number[];
  /** Optional: raw eye features for flag-based re-evaluation. */
  rawFeatures?: Record<string, unknown>;
}

export interface LOOCVMetrics {
  /** Mean Leave-One-Out Cross-Validation error in pixels (Ridge). */
  ridgePx: number;
  /** Mean LOOCV error in pixels (Hybrid). */
  hybridPx: number;
}

/** Describes what an engine natively supports. */
export interface EngineCapabilities {
  supportsHeadPose: boolean;
  supportsConfidence: boolean;
  /** Whether the engine can accept an OffscreenCanvas for zero-copy frame transfer. */
  supportsOffscreenCanvas: boolean;
}

// ─── Engine Interface ────────────────────────────────────────────────────────

export interface IGazeEngine {
  /** Unique stable identifier (e.g. 'mediapipe-v1', 'mock-v1'). */
  readonly id: string;
  readonly capabilities: EngineCapabilities;

  /**
   * Load model, allocate workers, open camera stream.
   * Must resolve before start() is called.
   */
  initialize(videoElement: HTMLVideoElement): Promise<void>;

  /** Begin the per-frame processing loop. Engine starts emitting results. */
  start(): void;

  /** Pause the loop — camera stays open, model stays loaded. */
  stop(): void;

  /** Full teardown: terminate workers, release camera, free model memory. */
  destroy(): void;

  /**
   * Train / configure the regression model with labeled calibration samples.
   * Resolves with LOOCV accuracy metrics when training is complete.
   */
  calibrate(samples: CalibrationSample[]): Promise<LOOCVMetrics>;

  /**
   * Re-evaluate the model on stored raw features using updated feature flags.
   * Allows changing flags (EAR, blendshapes, etc.) without re-calibrating.
   * No-op if the engine doesn't support raw feature storage.
   */
  reEvaluate?(samples: CalibrationSample[]): Promise<LOOCVMetrics>;

  /** Register handler called on every processed frame with a valid gaze prediction. */
  onGazeResult(handler: (result: GazeResult) => void): void;

  /** Register handler for head pose updates. No-op if !capabilities.supportsHeadPose. */
  onHeadPoseResult(handler: (result: HeadPoseResult) => void): void;

  /** Register handler for non-fatal engine errors (blink, occlusion, model warnings). */
  onError?(handler: (err: string) => void): void;
}
