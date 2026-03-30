'use client';

/**
 * useGaze — consume live gaze data from the active engine.
 *
 * Components never import IGazeEngine or MediaPipe directly.
 * Switching the engine in GazeProvider transparently updates all consumers.
 */

import { useRef } from 'react';
import { useGazeContext } from '../providers/GazeProvider';
import type { GazeResult } from '../core/IGazeEngine';

/**
 * Returns the latest gaze result and a readiness flag.
 * Re-renders the component on every new gaze sample (~30 fps).
 *
 * @example
 * const { gaze, gazeModelReady } = useGaze();
 * if (!gazeModelReady) return <Loading />;
 * return <Dot x={gaze.x} y={gaze.y} />;
 */
export function useGaze() {
  const { gaze, gazeModelReady } = useGazeContext();
  return { gaze, gazeModelReady };
}

/**
 * Returns a stable ref to the latest gaze — zero extra re-renders.
 *
 * Use this inside animation loops, rAF callbacks, or neurological test timers
 * that need to poll gaze without triggering React renders.
 *
 * @example
 * const gazeRef = useGazeRef();
 * // Inside a setInterval:
 * const { x, y } = gazeRef.current ?? { x: 0, y: 0 };
 */
export function useGazeRef(): React.MutableRefObject<GazeResult | null> {
  const { gaze } = useGazeContext();
  const ref = useRef<GazeResult | null>(null);
  // Keep ref in sync with latest gaze without causing re-renders in consumers
  ref.current = gaze;
  return ref;
}

/**
 * Returns head pose data from the active engine.
 * Re-renders on each head pose update (~15 Hz throttled by engine).
 */
export function useHeadPose() {
  const { headPose } = useGazeContext();
  return headPose;
}

/**
 * Returns engine metadata (id, capabilities, loading state).
 * Useful for debug panels or engine switcher UI.
 */
export function useEngineInfo() {
  const { engine, engineLoading } = useGazeContext();
  return {
    engineId:     engine?.id ?? null,
    capabilities: engine?.capabilities ?? null,
    loading:      engineLoading,
  };
}

// Re-export for convenience
export { useGazeContext } from '../providers/GazeProvider';
