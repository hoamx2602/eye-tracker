/**
 * gaze-engine — public API surface.
 *
 * Import from here in application code; never import from sub-paths directly.
 * This keeps internal organisation flexible without breaking callers.
 */

// ── Core types ───────────────────────────────────────────────────────────────
export type {
  IGazeEngine,
  GazeResult,
  HeadPoseResult,
  CalibrationSample,
  LOOCVMetrics,
  EngineCapabilities,
} from './core/IGazeEngine';

// ── Filters (standalone — safe to use in Workers or utilities) ───────────────
export { OneEuroFilter }   from './core/filters/OneEuroFilter';
export type { OneEuroConfig } from './core/filters/OneEuroFilter';
export { GazeSmoother }    from './core/filters/GazeSmoother';
export type { SmootherConfig, SmootherMethod } from './core/filters/GazeSmoother';

// ── Regression ───────────────────────────────────────────────────────────────
export { HybridRegressor, DataCleaner } from './services/RegressionService';
export type { RegressionMethod, OutlierMethod } from './services/RegressionService';

// ── Feature extraction ───────────────────────────────────────────────────────
export { extractEyeFeatures, buildFeatureVector, isBlinking } from './services/FeatureExtractor';
export type { EyeFeatures, HeadPose, FeatureFlags } from './services/FeatureExtractor';

// ── Calibration data management ──────────────────────────────────────────────
export { CalibrationStore } from './services/CalibrationStore';
export type { RawCalibrationEntry, CleanCalibrationOptions } from './services/CalibrationStore';

// ── Engines ──────────────────────────────────────────────────────────────────
export { MediaPipeEngine }   from './engines/MediaPipeEngine';
export type { MediaPipeEngineConfig } from './engines/MediaPipeEngine';
export { MockEngine }        from './engines/MockEngine';
export type { MockEngineConfig } from './engines/MockEngine';
export { RemoteModelEngine } from './engines/RemoteModelEngine';

// ── React integration ────────────────────────────────────────────────────────
export { GazeProvider, useGazeContext } from './providers/GazeProvider';
export type { GazeProviderProps } from './providers/GazeProvider';

export { useGaze, useGazeRef, useHeadPose, useEngineInfo } from './hooks/useGaze';
export { useCalibration } from './hooks/useCalibration';
export type { CalibrationState, CalibrationResult, UseCalibrationReturn } from './hooks/useCalibration';

// ── UI Components ─────────────────────────────────────────────────────────────
export { default as GazeOverlay }      from './components/GazeOverlay';
export type { GazeOverlayProps }       from './components/GazeOverlay';
export { default as CameraFeed }       from './components/CameraFeed';
export type { CameraFeedHandle, CameraFeedProps } from './components/CameraFeed';
export { default as CalibrationScreen } from './components/CalibrationScreen';
export type { CalibrationScreenProps }  from './components/CalibrationScreen';
export { default as CalibrationDot }   from './components/CalibrationDot';
export type { CalibrationDotProps, CalibrationMode } from './components/CalibrationDot';
