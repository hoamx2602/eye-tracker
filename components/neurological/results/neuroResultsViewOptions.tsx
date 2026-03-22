'use client';

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type NeurologicalResultsViewOptions = {
  /** Overlay stimulus (numbers, cards, targets…) like during the test. Off = gaze / heatmap only. */
  showStimulusReplay: boolean;
  setShowStimulusReplay: (v: boolean) => void;
  /** Gaze heatmap (accumulated blur). */
  showGazeHeatmap: boolean;
  setShowGazeHeatmap: (v: boolean) => void;
};

const Ctx = createContext<NeurologicalResultsViewOptions | null>(null);

const noop = () => {};

const DEFAULT_OPTIONS: NeurologicalResultsViewOptions = {
  showStimulusReplay: true,
  setShowStimulusReplay: noop,
  showGazeHeatmap: false,
  setShowGazeHeatmap: noop,
};

export function NeurologicalResultsViewProvider({ children }: { children: React.ReactNode }) {
  const [showStimulusReplay, setShowStimulusReplay] = useState(true);
  const [showGazeHeatmap, setShowGazeHeatmap] = useState(false);

  const value = useMemo(
    () => ({
      showStimulusReplay,
      setShowStimulusReplay,
      showGazeHeatmap,
      setShowGazeHeatmap,
    }),
    [showStimulusReplay, showGazeHeatmap]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Toggle stimulus replay + heatmap — outside provider, defaults apply (controls no-op). */
export function useNeurologicalResultsViewOptions(): NeurologicalResultsViewOptions {
  return useContext(Ctx) ?? DEFAULT_OPTIONS;
}
