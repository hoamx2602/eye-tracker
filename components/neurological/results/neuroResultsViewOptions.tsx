'use client';

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type NeurologicalResultsViewOptions = {
  /** Hiển thị lại stimulus (số, card, target…) giống lúc test. Tắt = chỉ gaze / heatmap. */
  showStimulusReplay: boolean;
  setShowStimulusReplay: (v: boolean) => void;
  /** Heatmap gaze (tích lũy độ mờ). */
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

/** Toggle tái hiện stimulus + heatmap — ngoài provider thì mặc định (nút không hoạt động). */
export function useNeurologicalResultsViewOptions(): NeurologicalResultsViewOptions {
  return useContext(Ctx) ?? DEFAULT_OPTIONS;
}
