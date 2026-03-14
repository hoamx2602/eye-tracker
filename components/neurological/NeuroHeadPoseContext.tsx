'use client';

import React, { createContext, useContext } from 'react';
import type { HeadPose } from '@/types';

export interface NeuroHeadPoseContextValue {
  headPose: HeadPose | null;
}

const NeuroHeadPoseContext = createContext<NeuroHeadPoseContextValue | null>(null);

export function NeuroHeadPoseProvider({
  headPose,
  children,
}: { headPose: HeadPose | null; children: React.ReactNode }) {
  return (
    <NeuroHeadPoseContext.Provider value={{ headPose }}>
      {children}
    </NeuroHeadPoseContext.Provider>
  );
}

export function useNeuroHeadPose(): NeuroHeadPoseContextValue {
  const ctx = useContext(NeuroHeadPoseContext);
  return ctx ?? { headPose: null };
}
