'use client';

/**
 * The head-position/distance check already runs every frame throughout the
 * whole session — validateHeadPosition() in App.tsx never stopped computing
 * it during the neurological tests, it just had nowhere on screen to show
 * up there. HeadPositionGuide (the calibration/tracking version) is a large
 * centred overlay with a crosshair box and scan animation, sized for a
 * screen with nothing else on it — reusing it here would sit on top of the
 * stimulus every one of the seven tests actually shows. This is the same
 * check, sized to not get in the way of a test that is still running.
 */

import React from 'react';
import type { HeadValidationResult } from '@/services/eyeTrackingService';

export default function NeuroHeadPositionWarning({
  validation,
}: {
  validation: HeadValidationResult | null;
}) {
  if (!validation || validation.valid) return null;

  return (
    <div
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[80] pointer-events-none"
      role="status"
    >
      <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-red-950/90 border border-red-500/60 backdrop-blur shadow-lg">
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" aria-hidden />
        <span className="text-xs font-semibold text-red-200">
          {validation.message || 'Move back into position'}
        </span>
      </div>
    </div>
  );
}
