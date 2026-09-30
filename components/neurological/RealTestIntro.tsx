'use client';

/**
 * The moment the real test begins.
 *
 * Practice and the recorded test look alike by design — the task is the same —
 * so this screen draws a hard line between them: red, explicit about
 * recording, and counted down, so nobody discovers they are being measured
 * halfway through. The countdown also gives the spoken line room to finish
 * before the task takes over the screen.
 *
 * Its last seconds double as the drift check (lib/driftCorrection): the
 * number gives way to a dot at the exact screen centre, and the gaze while it
 * is fixated re-anchors the mapping for the test that follows. No extra time
 * is added to the session.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useVoiceOnMount } from '@/lib/voice/VoiceProvider';
import { gazeFrameStream } from '@/lib/gazeFrameStream';
import { commitDriftCheck, evaluateDriftCheck, recordSkippedDriftCheck } from '@/lib/driftCorrection';
import { CALIB_DOT_SHRINK_MS, calibDotStyle } from '@/lib/calibrationDot';

const COUNTDOWN_SECONDS = 5;
/** The drift dot replaces the number for the last this-many seconds. */
const DRIFT_DOT_SECONDS = 2;
/** Frames from the first part of the dot are the saccade to it and settling, not fixation. */
const DRIFT_SETTLE_MS = CALIB_DOT_SHRINK_MS;

export type RealTestIntroProps = {
  /** Test name, e.g. "Saccadic Eye Movement". */
  testLabel: string;
  /** One line on what to do, repeated from the guide as a last reminder. */
  summary?: string | null;
  onStart: () => void;
};

export default function RealTestIntro({ testLabel, summary, onStart }: RealTestIntroProps) {
  const [remaining, setRemaining] = useState(COUNTDOWN_SECONDS);
  const showDriftDot = remaining > 0 && remaining <= DRIFT_DOT_SECONDS;
  const captureRef = useRef<{ token: number; shownAt: number } | null>(null);

  useVoiceOnMount('realtest.intro');

  // Open a capture when the dot appears; always close it on unmount.
  useEffect(() => {
    if (showDriftDot && captureRef.current === null) {
      captureRef.current = { token: gazeFrameStream.begin(), shownAt: performance.now() };
    }
  }, [showDriftDot]);
  useEffect(() => () => {
    if (captureRef.current) gazeFrameStream.end(captureRef.current.token);
    captureRef.current = null;
  }, []);

  const finishDriftCheck = useCallback((skipped: boolean) => {
    const cap = captureRef.current;
    captureRef.current = null;
    const frames = cap ? gazeFrameStream.end(cap.token) : [];
    if (skipped || !cap) {
      recordSkippedDriftCheck();
      return;
    }
    const w = window.innerWidth, h = window.innerHeight;
    commitDriftCheck(evaluateDriftCheck(
      frames.filter((f) => f.t >= cap.shownAt + DRIFT_SETTLE_MS),
      { x: w / 2, y: h / 2 },
      { w, h },
    ));
  }, []);

  useEffect(() => {
    if (remaining <= 0) {
      finishDriftCheck(false);
      onStart();
      return;
    }
    const id = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(id);
  }, [remaining, onStart, finishDriftCheck]);

  return (
    <div
      className="fixed inset-0 z-[55] flex flex-col items-center justify-center bg-gray-950 ring-4 ring-inset ring-red-600/50 p-6"
      role="alertdialog"
      aria-labelledby="real-test-intro-title"
    >
      {showDriftDot && (
        <>
          <div
            className="fixed left-1/2 top-1/2 rounded-full bg-red-600 flex items-center justify-center pointer-events-none"
            style={calibDotStyle()}
            aria-hidden
          >
            <div className="w-3 h-3 bg-black rounded-full" />
          </div>
          <p className="fixed left-0 right-0 top-[calc(50%+3rem)] text-center text-sm text-gray-300">Look at the dot</p>
        </>
      )}

      <div className={`flex flex-col items-center ${showDriftDot ? 'invisible' : ''}`}>
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

      </div>

      <button
        type="button"
        onClick={() => {
          finishDriftCheck(true);
          onStart();
        }}
        className="mt-10 px-6 py-3 rounded-2xl border border-gray-600 bg-gray-800 hover:bg-gray-700 hover:border-gray-400 text-white text-sm font-semibold transition"
      >
        Start now
      </button>
    </div>
  );
}
