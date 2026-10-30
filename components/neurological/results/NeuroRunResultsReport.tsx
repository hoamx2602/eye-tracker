'use client';

/**
 * Renders the pre/post symptom comparison plus the per-test visualizations
 * for a completed NeurologicalRun. Extracted so the same report can be
 * embedded both in the admin run-detail page and the doctor session page,
 * instead of linking out to the participant-facing "thank you" screen at
 * /results/[runId] (that page intentionally shows no results — see its
 * own comment).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import SmoothPursuitResultsPreview from '@/components/neurological/results/SmoothPursuitResultsPreview';
import NeurologicalResultParamsDrawer from '@/components/neurological/results/NeurologicalResultParamsDrawer';
import { NeurologicalResultsViewProvider } from '@/components/neurological/results/neuroResultsViewOptions';
import { ResultVizSessionViewportProvider } from '@/components/neurological/results/resultVizLayout';
import HeadOrientationResultsPreview from '@/components/neurological/results/HeadOrientationResultsPreview';
import VisualSearchResultsPreview from '@/components/neurological/results/VisualSearchResultsPreview';
import MemoryCardsGazePathPreview from '@/components/neurological/results/MemoryCardsGazePathPreview';
import AntiSaccadeGazeDirectionPreview from '@/components/neurological/results/AntiSaccadeGazeDirectionPreview';
import SaccadicResultsPreview from '@/components/neurological/results/SaccadicResultsPreview';
import FixationBceaPreview from '@/components/neurological/results/FixationBceaPreview';
import PeripheralVisionResultsPreview from '@/components/neurological/results/PeripheralVisionResultsPreview';

export type SymptomPayload = {
  scores?: Record<string, number>;
  submittedAt?: string;
  variant?: string;
};

export type NeuroRunForReport = {
  id: string;
  status: string | null;
  testOrderSnapshot: unknown;
  preSymptomScores: SymptomPayload | null;
  postSymptomScores: SymptomPayload | null;
  testResults: Record<string, unknown> | null;
};

const SYMPTOM_QUESTIONS: { id: string; category: string; question: string }[] = [
  { id: 'Q1',  category: 'Headache',          question: 'Headache or head pressure' },
  { id: 'Q2',  category: 'Dizziness',         question: 'Dizziness or lightheadedness' },
  { id: 'Q3',  category: 'Nausea',            question: 'Nausea' },
  { id: 'Q4',  category: 'Vision Clarity',    question: 'Blurry or less clear vision' },
  { id: 'Q5',  category: 'Eye Strain',        question: 'Tired or strained eyes' },
  { id: 'Q6',  category: 'Visual Focus',      question: 'Difficulty focusing eyes' },
  { id: 'Q7',  category: 'Light Sensitivity', question: 'Light sensitivity' },
  { id: 'Q8',  category: 'Concentration',     question: 'Difficulty concentrating' },
  { id: 'Q9',  category: 'Mental Fatigue',    question: 'Mental fatigue' },
  { id: 'Q10', category: 'Neck',              question: 'Neck pain or stiffness' },
  { id: 'Q11', category: 'Double Vision',     question: 'Double vision' },
  { id: 'Q12', category: 'Balance',           question: 'Unsteady or balance difficulty' },
];

const SYMPTOM_LABELS = ['None', 'Mild', 'Moderate', 'Strong', 'Severe'];

export const TEST_LABELS: Record<string, string> = {
  head_orientation:   'Head Orientation',
  visual_search:      'Visual Search',
  memory_cards:       'Memory Cards',
  anti_saccade:       'Anti-Saccade',
  saccadic:           'Saccadic',
  fixation_stability: 'Fixation Stability',
  peripheral_vision:  'Peripheral Vision',
  smooth_pursuit:     'Smooth Pursuit',
};

function ExpandIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8V3h5M17 8V3h-5M3 12v5h5M17 12v5h-5" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 4l12 12M16 4L4 16" />
    </svg>
  );
}

function SymptomTable({ pre, post }: { pre: SymptomPayload | null; post: SymptomPayload | null }) {
  const preScores  = pre?.scores  ?? {};
  const postScores = post?.scores ?? {};
  const hasPre  = Object.keys(preScores).length  > 0;
  const hasPost = Object.keys(postScores).length > 0;

  if (!hasPre && !hasPost) {
    return <p className="text-slate-500 text-sm">No symptom data recorded.</p>;
  }

  const totalPre   = SYMPTOM_QUESTIONS.reduce((s, q) => s + (preScores[q.id]  ?? 0), 0);
  const totalPost  = SYMPTOM_QUESTIONS.reduce((s, q) => s + (postScores[q.id] ?? 0), 0);
  const totalDelta = hasPre && hasPost ? totalPost - totalPre : null;

  const scaleColour = (val: number) =>
    val === 0 ? 'bg-slate-700/60 text-slate-400 border-slate-600'
    : val === 1 ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
    : val === 2 ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
    : val === 3 ? 'bg-orange-500/15 text-orange-300 border-orange-500/30'
    : 'bg-red-500/15 text-red-300 border-red-500/30';

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 px-3 pb-2 border-b border-slate-700/50">
        <span className="flex-1 text-xs font-medium text-slate-500 uppercase">Question</span>
        {hasPre  && <span className="text-xs font-medium text-blue-400 uppercase w-24 text-center">Pre</span>}
        {hasPost && <span className="text-xs font-medium text-purple-400 uppercase w-24 text-center">Post</span>}
        {hasPre && hasPost && <span className="text-xs font-medium text-slate-500 uppercase w-10 text-center">Δ</span>}
      </div>

      {SYMPTOM_QUESTIONS.map((q, idx) => {
        const preVal  = preScores[q.id]  != null ? Number(preScores[q.id])  : null;
        const postVal = postScores[q.id] != null ? Number(postScores[q.id]) : null;
        const delta   = preVal != null && postVal != null ? postVal - preVal : null;
        return (
          <div key={q.id} className={`flex items-center gap-2 px-3 py-2.5 rounded-lg ${idx % 2 === 0 ? 'bg-slate-800/40' : ''}`}>
            <div className="flex-1 min-w-0">
              <span className="text-[10px] font-mono text-slate-500 mr-1.5">{q.id}</span>
              <span className="text-sm text-slate-200">{q.question}</span>
            </div>
            {hasPre && (
              <div className="w-24 flex justify-center shrink-0">
                {preVal != null ? (
                  <span className={`inline-flex flex-col items-center px-3 py-1 rounded-lg border text-xs font-semibold ${scaleColour(preVal)}`}>
                    <span className="text-base leading-tight">{preVal}</span>
                    <span className="text-[10px] opacity-80 leading-tight">{SYMPTOM_LABELS[preVal]}</span>
                  </span>
                ) : <span className="text-slate-600">—</span>}
              </div>
            )}
            {hasPost && (
              <div className="w-24 flex justify-center shrink-0">
                {postVal != null ? (
                  <span className={`inline-flex flex-col items-center px-3 py-1 rounded-lg border text-xs font-semibold ${scaleColour(postVal)}`}>
                    <span className="text-base leading-tight">{postVal}</span>
                    <span className="text-[10px] opacity-80 leading-tight">{SYMPTOM_LABELS[postVal]}</span>
                  </span>
                ) : <span className="text-slate-600">—</span>}
              </div>
            )}
            {hasPre && hasPost && (
              <div className="w-10 text-center text-sm font-bold tabular-nums shrink-0">
                {delta != null ? (
                  <span className={delta > 0 ? 'text-red-400' : delta < 0 ? 'text-emerald-400' : 'text-slate-500'}>
                    {delta > 0 ? `+${delta}` : delta === 0 ? '0' : `${delta}`}
                  </span>
                ) : '—'}
              </div>
            )}
          </div>
        );
      })}

      <div className="flex items-center gap-2 px-3 py-2.5 border-t border-slate-600 mt-1">
        <span className="flex-1 text-xs font-semibold text-slate-400 uppercase">Total</span>
        {hasPre  && <div className="w-24 text-center font-bold text-slate-200 tabular-nums">{totalPre}</div>}
        {hasPost && <div className="w-24 text-center font-bold text-slate-200 tabular-nums">{totalPost}</div>}
        {hasPre && hasPost && (
          <div className="w-10 text-center font-bold tabular-nums">
            <span className={totalDelta == null ? '' : totalDelta > 0 ? 'text-red-400' : totalDelta < 0 ? 'text-emerald-400' : 'text-slate-500'}>
              {totalDelta != null ? (totalDelta > 0 ? `+${totalDelta}` : `${totalDelta}`) : '—'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function SymptomToggleSection({ pre, post }: { pre: SymptomPayload | null; post: SymptomPayload | null }) {
  const [open, setOpen] = useState(false);
  const hasPre  = !!pre?.scores  && Object.keys(pre.scores).length  > 0;
  const hasPost = !!post?.scores && Object.keys(post.scores).length > 0;
  const preTotal  = hasPre  ? SYMPTOM_QUESTIONS.reduce((s, q) => s + ((pre!.scores![q.id])  ?? 0), 0) : null;
  const postTotal = hasPost ? SYMPTOM_QUESTIONS.reduce((s, q) => s + ((post!.scores![q.id]) ?? 0), 0) : null;
  const totalDelta = preTotal != null && postTotal != null ? postTotal - preTotal : null;

  return (
    <div className="rounded-xl bg-slate-800/60 border border-slate-700/80 shadow-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-700/30 transition text-left gap-4"
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-slate-400 uppercase tracking-wider">Pre / Post Symptoms</span>
          <div className="flex items-center gap-2">
            {hasPre  && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/30 text-blue-300">Pre: {preTotal}</span>}
            {hasPost && <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-300">Post: {postTotal}</span>}
            {totalDelta != null && (
              <span className={`text-xs px-2 py-0.5 rounded-full border ${
                totalDelta < 0 ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                : totalDelta > 0 ? 'bg-red-500/15 border-red-500/30 text-red-300'
                : 'bg-slate-700 border-slate-600 text-slate-400'
              }`}>
                Δ {totalDelta > 0 ? `+${totalDelta}` : totalDelta}
              </span>
            )}
            {!hasPre && !hasPost && <span className="text-xs text-slate-600">No data</span>}
          </div>
        </div>
        <svg
          className={`w-4 h-4 text-slate-500 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
        >
          <path d="M5 8l5 5 5-5" />
        </svg>
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-slate-700/50">
          <p className="text-xs text-slate-500 mt-4 mb-3">
            Scale: 0 = None · 1 = Mild · 2 = Moderate · 3 = Strong · 4 = Severe.{' '}
            Δ = Post − Pre.{' '}
            <span className="text-emerald-400">Green</span> = improved,{' '}
            <span className="text-red-400">red</span> = worsened.
          </p>
          <SymptomTable pre={pre} post={post} />
        </div>
      )}
    </div>
  );
}

function TestVisualization({ testId, raw }: { testId: string; raw: Record<string, unknown> }) {
  switch (testId) {
    case 'head_orientation': {
      const phases = (raw.phases as Parameters<typeof HeadOrientationResultsPreview>[0]['phases']) ?? [];
      return <HeadOrientationResultsPreview phases={phases} visualOnly />;
    }
    case 'visual_search': {
      const completionTimeMs = Number(raw.completionTimeMs ?? 0);
      const numberPositions = (raw.numberPositions as Parameters<typeof VisualSearchResultsPreview>[0]['numberPositions']) ?? [];
      const scanningPath = (raw.scanningPath ?? raw.gazePath ?? []) as Parameters<typeof VisualSearchResultsPreview>[0]['scanningPath'];
      const gazeFixationPerNumber = (raw.gazeFixationPerNumber ?? {}) as Record<number, number>;
      const sequence = (raw.sequence ?? raw.gazeSequence ?? []) as number[];
      const fixations = raw.fixations as Parameters<typeof VisualSearchResultsPreview>[0]['fixations'];
      const vw = raw.viewportWidth as number | undefined;
      const vh = raw.viewportHeight as number | undefined;
      const stimulusBounds = raw.stimulusBounds as Parameters<typeof VisualSearchResultsPreview>[0]['stimulusBounds'];
      return (
        <VisualSearchResultsPreview
          completionTimeMs={completionTimeMs}
          numberPositions={numberPositions}
          scanningPath={scanningPath}
          gazeFixationPerNumber={gazeFixationPerNumber}
          sequence={sequence}
          fixations={fixations}
          viewportWidth={vw}
          viewportHeight={vh}
          stimulusBounds={stimulusBounds}
          startTime={raw.startTime as number | undefined}
          endTime={raw.endTime as number | undefined}
          confirmMode={(raw.confirmMode as string | undefined) ?? (raw.allowClickTargets ? 'hold' : undefined)}
          clickHoldDurationMs={raw.clickHoldDurationMs as number | undefined}
          visualOnly
        />
      );
    }
    case 'memory_cards': {
      const gazePath = (raw.gazePath ?? []) as Parameters<typeof MemoryCardsGazePathPreview>[0]['gazePath'];
      return (
        <MemoryCardsGazePathPreview
          gazePath={gazePath}
          board={raw.board as number[] | undefined}
          cols={raw.cols as number | undefined}
          rows={raw.rows as number | undefined}
          viewportWidth={raw.viewportWidth as number | undefined}
          viewportHeight={raw.viewportHeight as number | undefined}
          gridRect={raw.gridRect as Parameters<typeof MemoryCardsGazePathPreview>[0]['gridRect']}
          moves={raw.moves as Parameters<typeof MemoryCardsGazePathPreview>[0]['moves']}
          startTime={raw.startTime as number | undefined}
          completionTimeMs={raw.completionTimeMs as number | undefined}
          visualOnly
        />
      );
    }
    case 'anti_saccade': {
      const trials = (raw.trials ?? []) as Parameters<typeof AntiSaccadeGazeDirectionPreview>[0]['trials'];
      const scanningPath = (raw.scanningPath ?? raw.gazePath) as Parameters<typeof AntiSaccadeGazeDirectionPreview>[0]['scanningPath'];
      return (
        <AntiSaccadeGazeDirectionPreview
          trials={trials}
          scanningPath={scanningPath}
          viewportWidth={raw.viewportWidth as number | undefined}
          viewportHeight={raw.viewportHeight as number | undefined}
          visualOnly
        />
      );
    }
    case 'saccadic': {
      const cycles = (raw.cycles ?? []) as Parameters<typeof SaccadicResultsPreview>[0]['cycles'];
      const scanningPath = (raw.scanningPath ?? raw.gazePath) as Parameters<typeof SaccadicResultsPreview>[0]['scanningPath'];
      return (
        <SaccadicResultsPreview
          cycles={cycles}
          startTime={raw.startTime as number | undefined}
          endTime={raw.endTime as number | undefined}
          scanningPath={scanningPath}
          saccadeLatencyMs={raw.saccadeLatencyMs as number[] | undefined}
          fixationAccuracy={raw.fixationAccuracy as number | undefined}
          correctiveSaccades={raw.correctiveSaccades as number | undefined}
          metrics={raw.metrics as Parameters<typeof SaccadicResultsPreview>[0]['metrics']}
          viewportWidth={raw.viewportWidth as number | undefined}
          viewportHeight={raw.viewportHeight as number | undefined}
          visualOnly
        />
      );
    }
    case 'fixation_stability': {
      const gazeSamples = (raw.gazeSamples ?? []) as Parameters<typeof FixationBceaPreview>[0]['gazeSamples'];
      return (
        <FixationBceaPreview
          gazeSamples={gazeSamples}
          viewportWidth={raw.viewportWidth as number | undefined}
          viewportHeight={raw.viewportHeight as number | undefined}
          bcea68Px2={raw.bcea68Px2 as number | undefined}
          bcea95Px2={raw.bcea95Px2 as number | undefined}
          startTime={raw.startTime as number | undefined}
          endTime={raw.endTime as number | undefined}
          durationMs={raw.durationMs as number | undefined}
          visualOnly
        />
      );
    }
    case 'peripheral_vision': {
      const trials = (raw.trials ?? []) as Parameters<typeof PeripheralVisionResultsPreview>[0]['trials'];
      const scanningPath = (raw.scanningPath ?? raw.gazePath) as Parameters<typeof PeripheralVisionResultsPreview>[0]['scanningPath'];
      return (
        <PeripheralVisionResultsPreview
          trials={trials}
          startTime={raw.startTime as number | undefined}
          endTime={raw.endTime as number | undefined}
          scanningPath={scanningPath}
          stimulusDurationMs={raw.stimulusDurationMs as number | undefined}
          metrics={raw.metrics as Parameters<typeof PeripheralVisionResultsPreview>[0]['metrics']}
          viewportWidth={raw.viewportWidth as number | undefined}
          viewportHeight={raw.viewportHeight as number | undefined}
          visualOnly
        />
      );
    }
    case 'smooth_pursuit':
      return (
        <SmoothPursuitResultsPreview
          gazeSamples={raw.gazeSamples as Array<{ t: number; x: number; y: number; targetX: number }> | undefined}
          metrics={raw.metrics as Record<string, number | null> | undefined}
          viewportWidth={raw.viewportWidth as number | undefined}
          visualOnly
        />
      );
    default:
      return <p className="text-slate-500 text-sm p-4">No visualization available for this test type.</p>;
  }
}

function TestResultFullscreen({
  testId,
  raw,
  vw,
  vh,
  onClose,
}: {
  testId: string;
  raw: Record<string, unknown>;
  vw: number | undefined;
  vh: number | undefined;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const closeBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeBtnRef.current?.focus(); }, []);

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${TEST_LABELS[testId] ?? testId} — fullscreen`}
      className="fixed inset-0 z-[200] bg-slate-900 flex flex-col"
    >
      <div className="h-14 shrink-0 border-b border-slate-700 bg-slate-900 flex items-center justify-between px-4 gap-4">
        <h2 className="font-semibold text-white text-base truncate">
          {TEST_LABELS[testId] ?? testId}
        </h2>
        <button
          ref={closeBtnRef}
          type="button"
          onClick={onClose}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/60 text-sm transition"
          title="Close fullscreen (Esc)"
        >
          <CloseIcon className="w-4 h-4" />
          <span className="hidden sm:inline">Close</span>
        </button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col overflow-y-auto bg-slate-900/50">
        <NeurologicalResultsViewProvider>
          <ResultVizSessionViewportProvider viewportWidth={vw} viewportHeight={vh}>
            <TestVisualization testId={testId} raw={raw} />
          </ResultVizSessionViewportProvider>
        </NeurologicalResultsViewProvider>
      </div>
    </div>
  );

  if (typeof window === 'undefined') return null;
  return createPortal(overlay, document.body);
}

function TestResultCard({ testId, data }: { testId: string; data: unknown }) {
  const raw = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const vw = typeof raw.viewportWidth === 'number' ? raw.viewportWidth : undefined;
  const vh = typeof raw.viewportHeight === 'number' ? raw.viewportHeight : undefined;

  const [expanded, setExpanded] = useState(false);
  const onClose = useCallback(() => setExpanded(false), []);

  return (
    <>
      <div className="rounded-xl bg-slate-800/60 border border-slate-700/80 shadow-xl overflow-hidden">
        <div className="px-5 pt-4 pb-3 border-b border-slate-700/60 flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-white">{TEST_LABELS[testId] ?? testId}</h3>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-slate-400 hover:text-blue-400 hover:bg-slate-700/50 text-xs font-medium transition"
            title="Expand to fullscreen"
          >
            <ExpandIcon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Expand</span>
          </button>
        </div>

        <NeurologicalResultsViewProvider>
          <ResultVizSessionViewportProvider viewportWidth={vw} viewportHeight={vh}>
            <div className="flex flex-col lg:flex-row lg:h-[400px]">
              <div className="flex-1 min-w-0 bg-slate-900/50 overflow-hidden">
                <TestVisualization testId={testId} raw={raw} />
              </div>
              <div className="lg:w-[300px] shrink-0 border-t lg:border-t-0 lg:border-l border-slate-700/60 overflow-y-auto">
                <NeurologicalResultParamsDrawer testId={testId} raw={raw} omitFixedMinHeightLg />
              </div>
            </div>
          </ResultVizSessionViewportProvider>
        </NeurologicalResultsViewProvider>
      </div>

      {expanded && (
        <TestResultFullscreen
          testId={testId}
          raw={raw}
          vw={vw}
          vh={vh}
          onClose={onClose}
        />
      )}
    </>
  );
}

export default function NeuroRunResultsReport({ run }: { run: NeuroRunForReport }) {
  const testOrder: string[] = Array.isArray(run.testOrderSnapshot)
    ? run.testOrderSnapshot as string[]
    : run.testResults ? Object.keys(run.testResults) : [];

  return (
    <div className="space-y-6">
      <SymptomToggleSection pre={run.preSymptomScores} post={run.postSymptomScores} />

      {testOrder.length > 0 && run.testResults && (
        <div className="space-y-6">
          {testOrder.map((tid) => {
            const data = (run.testResults as Record<string, unknown>)[tid];
            if (!data) {
              return (
                <div key={tid} className="rounded-xl bg-slate-800/60 border border-slate-700/80 p-5">
                  <h3 className="text-base font-semibold text-white mb-1">{TEST_LABELS[tid] ?? tid}</h3>
                  <p className="text-slate-500 text-sm">No data recorded for this test.</p>
                </div>
              );
            }
            return <TestResultCard key={tid} testId={tid} data={data} />;
          })}
        </div>
      )}

      {testOrder.length === 0 && (
        <p className="text-slate-500 text-sm">No neurological test data recorded for this run.</p>
      )}
    </div>
  );
}
