'use client';

import React, { createContext, useContext } from 'react';

export interface NeuroGazeContextValue {
  /** Gaze position in screen pixels (same as GazeCursor). */
  gaze: { x: number; y: number };
}

const NeuroGazeContext = createContext<NeuroGazeContextValue | null>(null);

export function NeuroGazeProvider({
  gaze,
  children,
}: { gaze: { x: number; y: number }; children: React.ReactNode }) {
  return (
    <NeuroGazeContext.Provider value={{ gaze }}>
      {children}
    </NeuroGazeContext.Provider>
  );
}

export function useNeuroGaze(): NeuroGazeContextValue {
  const ctx = useContext(NeuroGazeContext);
  return ctx ?? { gaze: { x: 0, y: 0 } };
}
