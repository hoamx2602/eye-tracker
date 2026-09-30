'use client';

import React, { useEffect, useState } from 'react';

/** Asks the browser for fullscreen; resolves either way (it can be refused). */
export async function enterFullscreen(): Promise<void> {
  if (typeof document === 'undefined' || document.fullscreenElement || !document.fullscreenEnabled) return;
  try {
    await document.documentElement.requestFullscreen();
  } catch (error) {
    console.warn('Fullscreen denied', error);
  }
}

export async function exitFullscreen(): Promise<void> {
  if (typeof document === 'undefined' || !document.fullscreenElement) return;
  try {
    await document.exitFullscreen();
  } catch (error) {
    console.warn('Could not leave fullscreen', error);
  }
}

/** True while the page is fullscreen, or when the browser cannot do fullscreen at all (e.g. iPhone Safari). */
export function useIsFullscreen(): boolean {
  const [isFullscreen, setIsFullscreen] = useState(true);
  useEffect(() => {
    const update = () => setIsFullscreen(!document.fullscreenEnabled || !!document.fullscreenElement);
    update();
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  return isFullscreen;
}

interface FullscreenGuardProps {
  /** Whether the current stage requires fullscreen. */
  active: boolean;
}

/**
 * Blocks the screen while a stage that requires fullscreen is shown without
 * it, until the participant clicks to go back. Shared by the eye-tracking
 * flow and the facial-droop capture.
 */
export default function FullscreenGuard({ active }: FullscreenGuardProps) {
  const isFullscreen = useIsFullscreen();
  if (!active || isFullscreen) return null;

  return (
    <div
      onClick={() => void enterFullscreen()}
      className="fixed inset-0 z-[99999] bg-[#0a0c10] flex flex-col items-center justify-center cursor-pointer transition-all hover:bg-[#0d1016] text-white p-6 text-center select-none"
    >
      <div className="w-24 h-24 bg-blue-600/20 rounded-full flex items-center justify-center mb-8 animate-pulse">
        <svg viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" className="w-12 h-12">
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M15 3h6m0 0v6m0-6L14 10M9 21H3m0 0v-6m0 6l7-7M3 9V3m0 0h6m0 0L10 14M21 15v6m0 0h-6m0 0l7-7" />
        </svg>
      </div>
      <h2 className="text-2xl font-bold mb-3">Fullscreen Mode Required</h2>
      <p className="text-base text-gray-400 opacity-90 max-w-sm">
        The assessment must be conducted in fullscreen mode to ensure data accuracy and integrity.
      </p>
      <div className="mt-8 px-8 py-3.5 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-bold text-base shadow-xl shadow-blue-900/40 animate-bounce transition-colors flex items-center gap-3">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M7 11.5V14a5 5 0 1010 0v-5.5a1.5 1.5 0 10-3 0V12m-3-4V12m-3-1.5V12" />
        </svg>
        Click here to continue testing
      </div>
    </div>
  );
}
