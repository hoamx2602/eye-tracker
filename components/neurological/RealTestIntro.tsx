'use client';

/**
 * The moment the real test begins.
 *
 * Practice and the recorded test look alike by design — the task is the same —
 * so this screen draws a hard line between them: red, explicit about
 * recording, and counted down, so nobody discovers they are being measured
 * halfway through. The countdown also gives the spoken line room to finish
 * before the task takes over the screen.
 */

import React, { useEffect, useState } from 'react';
import { useVoiceOnMount } from '@/lib/voice/VoiceProvider';

const COUNTDOWN_SECONDS = 5;

export type RealTestIntroProps = {
  /** Test name, e.g. "Saccadic Eye Movement". */
  testLabel: string;
  /** One line on what to do, repeated from the guide as a last reminder. */
  summary?: string | null;
  onStart: () => void;
};

export default function RealTestIntro({ testLabel, summary, onStart }: RealTestIntroProps) {
  const [remaining, setRemaining] = useState(COUNTDOWN_SECONDS);

  useVoiceOnMount('realtest.intro');

  useEffect(() => {
    if (remaining <= 0) {
      onStart();
      return;
    }
    const id = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(id);
  }, [remaining, onStart]);

  return (
    <div
      className="fixed inset-0 z-[55] flex flex-col items-center justify-center bg-gray-950 ring-4 ring-inset ring-red-600/50 p-6"
      role="alertdialog"
      aria-labelledby="real-test-intro-title"
    >
      <div className="flex items-center gap-2 text-red-300">
        <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" aria-hidden />
        <span className="text-xs font-bold uppercase tracking-[0.25em]">Real test — recording</span>
      </div>

      <h2 id="real-test-intro-title" className="mt-4 text-3xl font-bold text-white text-center tracking-tight">
        {testLabel}
      </h2>

      {summary && (
        <p className="mt-3 max-w-md text-center text-gray-300/90 leading-relaxed">{summary}</p>
      )}

      <div className="mt-8 flex flex-col items-center gap-2">
        <div className="text-7xl font-black text-white tabular-nums" aria-live="off">
          {remaining}
        </div>
        <p className="text-sm text-gray-400">Starting — eyes on the screen</p>
      </div>

      <button
        type="button"
        onClick={onStart}
        className="mt-10 px-6 py-3 rounded-2xl border border-gray-600 bg-gray-800 hover:bg-gray-700 hover:border-gray-400 text-white text-sm font-semibold transition"
      >
        Start now
      </button>
    </div>
  );
}
