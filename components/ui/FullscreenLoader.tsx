'use client';

/**
 * Full-screen "the system is working" overlay.
 *
 * Used wherever a step hands off to the server — saving a finished test,
 * submitting a questionnaire — so the wait reads as progress rather than as a
 * frozen screen. It sits above task overlays (z-50) and break screens (z-70).
 */

import React from 'react';
import EyeSpinner from './EyeSpinner';

export type FullscreenLoaderProps = {
  /** What is happening, in the participant's terms. */
  message?: string;
  /** Second line, for reassurance on longer waits. */
  detail?: string;
};

export default function FullscreenLoader({
  message = 'Saving…',
  detail = 'This takes a moment. Please keep this window open.',
}: FullscreenLoaderProps) {
  return (
    <div
      className="fixed inset-0 z-[400] flex flex-col items-center justify-center gap-4 bg-gray-950/95 backdrop-blur-sm p-6"
      role="status"
      aria-live="polite"
    >
      <EyeSpinner size="lg" />
      <p className="text-blue-200 font-semibold animate-pulse">{message}</p>
      {detail && <p className="text-sm text-gray-400 text-center max-w-sm">{detail}</p>}
    </div>
  );
}
