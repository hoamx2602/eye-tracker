'use client';

import React, { createContext, useContext } from 'react';

export interface NeuroGazeContextValue {
  /** Gaze position in screen pixels (same as GazeCursor). */
  gaze: { x: number; y: number };
  /** False nếu HybridRegressor chưa train — không có ước lượng gaze, state vẫn (0,0). */
  gazeModelReady: boolean;
  /**
   * False while the head is outside the setup pose.
   *
   * Gaze prediction is gated on head validity, so `gaze` does not go stale-safe
   * on its own — it simply stops updating and keeps its last value. A test
   * sampling it during that window records a perfectly motionless gaze, which is
   * the best possible fixation-stability score obtained from no data at all.
   * Everything that records gaze must be able to tell the difference.
   */
  gazeValid: boolean;
}

const NeuroGazeContext = createContext<NeuroGazeContextValue | null>(null);

export function NeuroGazeProvider({
  gaze,
  gazeModelReady = true,
  gazeValid = true,
  children,
}: {
  gaze: { x: number; y: number };
  gazeModelReady?: boolean;
  gazeValid?: boolean;
  children: React.ReactNode;
}) {
  return (
    <NeuroGazeContext.Provider value={{ gaze, gazeModelReady, gazeValid }}>
      {children}
    </NeuroGazeContext.Provider>
  );
}

export function useNeuroGaze(): NeuroGazeContextValue {
  const ctx = useContext(NeuroGazeContext);
  return ctx ?? { gaze: { x: 0, y: 0 }, gazeModelReady: true, gazeValid: true };
}
