'use client';

import React, { createContext, useContext } from 'react';

export interface NeuroGazeContextValue {
  /** Gaze position in screen pixels (same as GazeCursor). */
  gaze: { x: number; y: number };
  /** False nếu HybridRegressor chưa train — không có ước lượng gaze, state vẫn (0,0). */
  gazeModelReady: boolean;
}

const NeuroGazeContext = createContext<NeuroGazeContextValue | null>(null);

export function NeuroGazeProvider({
  gaze,
  gazeModelReady = true,
  children,
}: {
  gaze: { x: number; y: number };
  gazeModelReady?: boolean;
  children: React.ReactNode;
}) {
  return (
    <NeuroGazeContext.Provider value={{ gaze, gazeModelReady }}>
      {children}
    </NeuroGazeContext.Provider>
  );
}

export function useNeuroGaze(): NeuroGazeContextValue {
  const ctx = useContext(NeuroGazeContext);
  return ctx ?? { gaze: { x: 0, y: 0 }, gazeModelReady: true };
}
