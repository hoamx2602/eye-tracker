'use client';

/**
 * GazeEngineBridge — adapter between new GazeProvider and existing App.tsx.
 *
 * Drop this component ABOVE App's video loop logic to progressively migrate
 * without rewriting App.tsx all at once.
 *
 * ─── Migration Steps ────────────────────────────────────────────────────────
 *
 * Step 1 (done by this file): Wire GazeProvider so new engine produces gaze.
 *
 * Step 2: In App.tsx replace:
 *   neuroLiveGazeRef.current = { x: smoothed.x, y: smoothed.y };
 *   setGazePos(smoothed);
 * With:
 *   // Nothing — the bridge handles it via onGazeResult callback
 *
 * Step 3: Replace direct neuroLiveGazeRef usage in tests with useGazeRef():
 *   import { useGazeRef } from '@/gaze-engine';
 *   const gazeRef = useGazeRef();
 *   // gazeRef.current → { x, y, timestamp, confidence }
 *
 * Step 4: Remove processVideo() / adaptive frame-skipping loop from App.tsx.
 *         The Worker handles frame scheduling with its own rAF loop.
 *
 * ─── Example usage in app/layout.tsx or a wrapper ────────────────────────────
 *
 *   const videoRef = useRef<HTMLVideoElement>(null);
 *   const engine = useMemo(() => new MediaPipeEngine(), []);
 *
 *   <GazeProvider engine={engine} videoRef={videoRef}>
 *     <GazeEngineBridge onGaze={setGazePos} onModelReady={setGazeModelReady} />
 *     <CameraFeed ref={cameraFeedRef} hidden />
 *     <App />
 *   </GazeProvider>
 */

import { useEffect } from 'react';
import { useGaze, useHeadPose } from './hooks/useGaze';
import type { GazeResult } from './core/IGazeEngine';
import type { HeadPoseResult } from './core/IGazeEngine';

export interface GazeEngineBridgeProps {
  /** Receives every gaze update — pass to App's setGazePos(). */
  onGaze?: (gaze: GazeResult) => void;
  /** Fires when the model becomes ready. */
  onModelReady?: (ready: boolean) => void;
  /** Receives head pose updates. */
  onHeadPose?: (pose: HeadPoseResult) => void;
}

/**
 * Renderless bridge: subscribes to GazeProvider state and forwards
 * values to App.tsx via callbacks. Zero DOM output.
 */
export function GazeEngineBridge({ onGaze, onModelReady, onHeadPose }: GazeEngineBridgeProps) {
  const { gaze, gazeModelReady } = useGaze();
  const headPose = useHeadPose();

  // Forward gaze to App.tsx state setter
  useEffect(() => {
    if (gaze) onGaze?.(gaze);
  }, [gaze, onGaze]);

  // Forward readiness flag
  useEffect(() => {
    onModelReady?.(gazeModelReady);
  }, [gazeModelReady, onModelReady]);

  // Forward head pose
  useEffect(() => {
    if (headPose) onHeadPose?.(headPose);
  }, [headPose, onHeadPose]);

  return null; // renderless
}

// ─── Engine factory helpers ───────────────────────────────────────────────────

/**
 * Returns the appropriate engine based on environment.
 * Use in useMemo() at app root.
 *
 * @example
 * const engine = useMemo(() => createEngine(), []);
 */
export function createEngine(opts?: {
  /** Force mock engine (e.g. for dev/test). */
  mock?: boolean;
  /** WebSocket URL to use RemoteModelEngine instead of MediaPipe. */
  remoteUrl?: string;
}) {
  if (opts?.mock || process.env.NODE_ENV === 'test') {
    const { MockEngine } = require('./engines/MockEngine');
    return new MockEngine();
  }
  if (opts?.remoteUrl) {
    const { RemoteModelEngine } = require('./engines/RemoteModelEngine');
    return new RemoteModelEngine(opts.remoteUrl);
  }
  const { MediaPipeEngine } = require('./engines/MediaPipeEngine');
  return new MediaPipeEngine();
}
