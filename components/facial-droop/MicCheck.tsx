'use client';

import React from 'react';
import type { MicActivity } from './useMicLevel';

function MicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
    </svg>
  );
}

/**
 * Microphone check: a mic icon whose halo swells with loudness, a live
 * equaliser across the speech range, and a status that confirms the mic once
 * sustained sound has been heard.
 */
export default function MicCheck({ activity }: { activity: MicActivity }) {
  const { level, bands, heard, suspended } = activity;
  const status = suspended
    ? 'Click anywhere to start the microphone test.'
    : heard
      ? 'Microphone is working'
      : 'Listening… say a few words.';

  return (
    <div className="flex w-full max-w-xl items-center gap-4 rounded-xl border border-gray-800 bg-gray-900 px-5 py-4">
      <div className="relative grid h-12 w-12 shrink-0 place-items-center">
        <span
          className={`absolute inset-0 rounded-full transition-transform duration-100 ${heard ? 'bg-emerald-400/25' : 'bg-blue-400/25'}`}
          style={{ transform: `scale(${1 + level * 0.45})` }}
          aria-hidden
        />
        <span className={`relative grid h-12 w-12 place-items-center rounded-full ${heard ? 'bg-emerald-500/20 text-emerald-300' : 'bg-blue-500/20 text-blue-300'}`}>
          <MicIcon className="h-6 w-6" />
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-semibold">
          Microphone
          <span className={`text-xs font-medium ${heard ? 'text-emerald-300' : 'text-gray-400'}`} role="status" aria-live="polite">
            {heard ? '✓ ' : ''}{status}
          </span>
        </p>
        <div className="mt-2 flex h-10 items-end gap-[3px]" aria-hidden>
          {bands.map((value, k) => (
            <span
              key={k}
              className={`flex-1 rounded-sm transition-[height] duration-75 ${heard ? 'bg-emerald-400' : 'bg-blue-400'}`}
              style={{ height: `${Math.max(8, value * 100)}%`, opacity: 0.35 + value * 0.65 }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
