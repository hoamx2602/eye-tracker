'use client';

import React, { createContext, useContext } from 'react';

/** When true, guide/test content should fill parent (absolute) so camera can show in the other half. */
export const NeuroPanelLayoutContext = createContext<{ inPanel: boolean } | null>(null);

export function useNeuroPanelLayout(): boolean {
  const ctx = useContext(NeuroPanelLayoutContext);
  return ctx?.inPanel ?? false;
}
