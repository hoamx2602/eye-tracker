'use client';

/**
 * What a participant sees when the session ends: that it is finished, and
 * thank you. Nothing else.
 *
 * This used to be a full results report — scores, a radar chart, gaze-error
 * diagrams, per-test breakdowns. Participants are not the audience for any of
 * that: the numbers are only meaningful against the study's own baselines, and
 * a low tracking-accuracy dial is alarming to read about yourself while
 * carrying no advice about what to do with it. The tool is explicitly not a
 * medical device, and the consent form says so.
 *
 * The full report is still there for the research team:
 *   - /admin/neurological-runs/[id]          — every test, with visualisations
 *   - /admin/neurological-runs/[id]/report   — the printable write-up
 *   - /results/[runId]/print                 — the PDF layout, unchanged
 */

import React from 'react';
import Link from 'next/link';
import { REALTIME_TRACKING_LINK_ENABLED } from '@/lib/featureFlags';

interface RunData {
  id: string;
  createdAt: string;
  session: { id: string };
}

export default function ResultsPageClient({ runData }: { runData: RunData }) {
  const finishedOn = new Date(runData.createdAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <div className="border-b border-gray-800/60">
        <div className="mx-auto max-w-4xl flex items-center gap-3 px-4 py-3">
          {/*
            This page only ever renders for a run the server has already
            confirmed is 'completed' (see page.tsx) — there is nothing left
            to lose by leaving, so this is a plain link, not a guarded one.
          */}
          <Link href="/" className="flex items-center gap-3 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
              <svg viewBox="0 0 20 20" fill="none" stroke="white" strokeWidth="1.5" className="w-4 h-4">
                <circle cx="10" cy="10" r="8" />
                <circle cx="10" cy="10" r="3.5" />
                <circle cx="10" cy="10" r="1" fill="white" stroke="none" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-white">Eye Assessment</span>
          </Link>
          {REALTIME_TRACKING_LINK_ENABLED && (
            <Link
              href={`/tracking?sessionId=${runData.session.id}`}
              className="ml-auto px-4 py-1.5 rounded-full bg-blue-600/10 border border-blue-500/20 text-blue-400 text-[10px] sm:text-xs font-semibold hover:bg-blue-600/20 hover:border-blue-500/40 transition-all flex items-center gap-2"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              Real-time Eye Tracking
            </Link>
          )}
        </div>
      </div>

      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-lg text-center flex flex-col items-center gap-6">
          <div
            className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center"
            aria-hidden
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="rgb(52 211 153)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-8 h-8"
            >
              <path d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <div>
            <p className="text-xs uppercase tracking-widest text-emerald-300/90 font-semibold">
              Assessment complete
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">Thank you for taking part</h1>
            <p className="mt-3 text-gray-300/90 leading-relaxed">
              Your session is finished and your responses have been saved. They will help this
              research into neurological assessment using eye tracking.
            </p>
          </div>

          <div className="w-full flex justify-center pt-2">
            {/*
              Reuses the exact same demographics and consent already on file
              for this session — the point of the button is a genuinely
              fresh sitting without making someone retype what they already
              gave, not a way to resume something unfinished. See the
              redoFrom handling in App.tsx (mirrors handleDemographicsSubmit)
              for where that actually happens.

              Fullscreen has to be requested here, synchronously inside this
              click, not after the navigation — by the time /setup mounts
              this gesture's activation window has likely already closed.
            */}
            <Link
              href={`/setup?redoFrom=${runData.session.id}`}
              onClick={() => {
                document.documentElement.requestFullscreen().catch(() => {});
              }}
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition"
            >
              Take the assessment again
            </Link>
          </div>

          {/*
            No "Close this tab" button — window.close() only ever works on a
            tab the page opened itself via window.open(); a tab the
            participant navigated to normally (the only way anyone reaches
            this page) can't be closed by script in any current browser, no
            matter what UI calls it. Every other web-based survey/assessment
            tool hits the same wall and lands on the same text-only copy —
            this isn't a missing feature, it's the honest state of the
            platform.
          */}
          <p className="text-sm text-gray-500">
            You can close this tab now — there's nothing else to do here. Completed {finishedOn}.
          </p>
        </div>
      </main>
    </div>
  );
}
