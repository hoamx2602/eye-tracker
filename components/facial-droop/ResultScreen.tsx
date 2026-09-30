'use client';

import React from 'react';
import Link from 'next/link';
import { AnalysisReport } from '@/components/facial-speech/AnalysisReport';
import EyeSpinner from '@/components/ui/EyeSpinner';
import type { ArchivedCapture } from '@/lib/facialSpeechArchive';
import type { FacialSpeechJob } from '@/lib/facialSpeechBackend';
import { MODULE_PATHS } from '@/lib/paths';
import { useVoiceOnMount } from '@/lib/voice/VoiceProvider';
import type { CaptureState } from './useFacialCapture';

export interface ResultInfo {
  state: CaptureState;
  message: string;
  job: FacialSpeechJob | null;
  archived: ArchivedCapture | null;
  archiveError: string | null;
  canRetry: boolean;
}

interface ResultScreenProps {
  result: ResultInfo;
  onRetry: () => void;
  onDownload: () => void;
}

function Headline({ result }: { result: ResultInfo }) {
  const { state, job, archived, archiveError } = result;
  if (state !== 'complete') return <>Saving your recording</>;
  if (archiveError) return <>Recording not saved yet</>;
  if (archived) return <>Recording saved</>;
  if (job?.status === 'failed') return <>Recording captured, analysis unavailable</>;
  if (job?.status === 'complete') return <>Measurement report</>;
  return <>Capture complete</>;
}

/**
 * The end of the flow, centred. While saving or analysing it holds the
 * screen with the app's loading indicator; afterwards it shows the outcome,
 * and the report when there is one - which alone may scroll, inside the card.
 */
export default function ResultScreen({ result, onRetry, onDownload }: ResultScreenProps) {
  useVoiceOnMount('facial.done');
  const busy = result.state === 'saving' || result.state === 'processing';
  const report = result.job?.report;

  return (
    <section className={`flex max-h-full w-full flex-col rounded-2xl border border-gray-800 bg-gray-900 shadow-2xl shadow-black/30 ${report ? 'max-w-5xl' : 'max-w-xl'}`}>
      <header className="border-b border-gray-800 px-6 py-5 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-400">All tasks recorded · thank you</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight"><Headline result={result} /></h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {busy ? (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <EyeSpinner size="xl" label={result.message} />
            {result.job?.status === 'processing' && <p className="text-sm tabular-nums text-gray-400">{result.job.progress}%</p>}
            <p className="text-xs text-gray-500">Keep this page open until it finishes.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className={`text-sm leading-6 ${result.archiveError || result.job?.status === 'failed' ? 'text-red-200' : 'text-gray-300'}`}>{result.message}</p>
            {result.archived && (
              <p className="text-sm leading-6 text-emerald-200/90">
                Your recording and its task timings are stored. The measurements are run later, so there is no report here.
                <span className="mt-2 block font-mono text-xs text-emerald-300/80">Reference: {result.archived.sessionId}</span>
              </p>
            )}
            {result.archiveError && (
              <p className="text-sm text-gray-400">The recording is still held on this page: retry, or download it so nothing is lost.</p>
            )}
            {report && <AnalysisReport report={report} />}
          </div>
        )}
      </div>
      {!busy && (
        <footer className="flex flex-wrap items-center justify-center gap-3 border-t border-gray-800 px-6 py-4">
          {result.canRetry && (
            <button type="button" onClick={onRetry} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold hover:bg-blue-500">
              {result.archiveError ? 'Retry saving' : 'Retry analysis'}
            </button>
          )}
          <button type="button" onClick={onDownload} className="rounded-xl border border-gray-600 px-5 py-2.5 text-sm text-gray-100 hover:border-blue-400">
            Download video + metadata
          </button>
          <Link href={MODULE_PATHS.HUB} className="rounded-xl px-5 py-2.5 text-sm text-gray-300 hover:text-white">All assessments</Link>
        </footer>
      )}
    </section>
  );
}
