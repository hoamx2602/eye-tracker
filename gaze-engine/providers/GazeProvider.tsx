'use client';

/**
 * GazeProvider — React context that owns the active IGazeEngine instance.
 *
 * Responsibilities:
 *   • Initialise the engine when a video element is available
 *   • Forward gaze + head pose results to context consumers
 *   • Allow runtime engine swapping (MediaPipe ↔ Mock ↔ Remote) via setEngine()
 *   • Tear down the previous engine cleanly before activating a new one
 *
 * Usage:
 *   <GazeProvider engine={new MediaPipeEngine()} videoRef={videoRef}>
 *     <App />
 *   </GazeProvider>
 *
 * Consume via useGaze() or useHeadPose() — never import the engine directly in UI.
 */

import React, {
  createContext, useCallback, useContext,
  useEffect, useRef, useState,
} from 'react';
import type { IGazeEngine, GazeResult, HeadPoseResult } from '../core/IGazeEngine';

// ─── Context Shape ────────────────────────────────────────────────────────────

interface GazeContextValue {
  /** Latest gaze result. Null until calibration completes. */
  gaze: GazeResult | null;
  /** Latest head pose. Null until engine is ready. */
  headPose: HeadPoseResult | null;
  /** True once engine.calibrate() has resolved successfully. */
  gazeModelReady: boolean;
  /** True while engine.initialize() is in progress. */
  engineLoading: boolean;
  /** Non-null once engine is initialised. */
  engine: IGazeEngine | null;
  /**
   * Swap the active engine at runtime.
   * Automatically destroys the old engine and initialises the new one.
   */
  setEngine: (engine: IGazeEngine) => Promise<void>;
  /** Mark calibration as done (called by useCalibration after engine.calibrate()). */
  markCalibrated: () => void;
  /** Reset calibration state. */
  resetCalibration: () => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const GazeContext = createContext<GazeContextValue | null>(null);

// ─── Provider ────────────────────────────────────────────────────────────────

export interface GazeProviderProps {
  children: React.ReactNode;
  /** Initial engine — can be swapped later via setEngine(). */
  engine?: IGazeEngine;
  /** Ref to the <video> element used for camera input. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

export function GazeProvider({ children, engine: initialEngine, videoRef }: GazeProviderProps) {
  const [gaze, setGaze]           = useState<GazeResult | null>(null);
  const [headPose, setHeadPose]   = useState<HeadPoseResult | null>(null);
  const [gazeModelReady, setReady] = useState(false);
  const [engineLoading, setLoading] = useState(false);
  const engineRef = useRef<IGazeEngine | null>(null);
  // Track current engine as state so consumers re-render on swap
  const [, setEngineVersion] = useState(0);

  // ── Activate engine ────────────────────────────────────────────────────────
  const activateEngine = useCallback(async (next: IGazeEngine) => {
    // Tear down existing
    if (engineRef.current) {
      engineRef.current.stop();
      engineRef.current.destroy();
      engineRef.current = null;
    }

    setGaze(null);
    setHeadPose(null);
    setReady(false);
    setLoading(true);

    next.onGazeResult((r) => setGaze(r));
    next.onHeadPoseResult((r) => setHeadPose(r));
    if (next.onError) next.onError((msg) => console.error(`[GazeEngine:${next.id}]`, msg));

    try {
      const video = videoRef.current;
      if (!video) throw new Error('No video element — pass a videoRef with a mounted <video>');
      await next.initialize(video);
      engineRef.current = next;
      next.start();
    } catch (err) {
      console.error('[GazeProvider] Engine init failed:', err);
    } finally {
      setLoading(false);
      setEngineVersion(v => v + 1);
    }
  }, [videoRef]);

  // ── Mount / unmount ────────────────────────────────────────────────────────
  useEffect(() => {
    if (initialEngine) activateEngine(initialEngine);
    return () => {
      engineRef.current?.stop();
      engineRef.current?.destroy();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─────────────────────────────────────────────────────────────────────────────

  const value: GazeContextValue = {
    gaze,
    headPose,
    gazeModelReady,
    engineLoading,
    engine: engineRef.current,
    setEngine: activateEngine,
    markCalibrated:  () => setReady(true),
    resetCalibration: () => { setReady(false); setGaze(null); },
  };

  return <GazeContext.Provider value={value}>{children}</GazeContext.Provider>;
}

// ─── Raw context accessor (use hooks below in components) ─────────────────────

export function useGazeContext(): GazeContextValue {
  const ctx = useContext(GazeContext);
  if (!ctx) throw new Error('useGazeContext must be used inside <GazeProvider>');
  return ctx;
}
