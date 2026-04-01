'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { createPortal } from 'react-dom';
import { angularErrorDeg } from '@/lib/resultScoring';

// Re-use the exact same visualization + metrics components from the user-facing results screen
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

// ── Types ──────────────────────────────────────────────────────────────────────

type Demographics = {
  age?: number;
  gender?: string;
  country?: string;
  eyeConditions?: string[];
};

type SessionContext = {
  id: string;
  meanErrorPx: number | null;
  demographics: Demographics | null;
};

type SymptomPayload = {
  scores?: Record<string, number>;
  submittedAt?: string;
  variant?: string;
};

type NeuroRunDetail = {
  id: string;
  sessionId: string;
  status: string | null;
  createdAt: string;
  updatedAt: string;
  configSnapshot: unknown;
  testOrderSnapshot: string[] | null;
  preSymptomScores: SymptomPayload | null;
  postSymptomScores: SymptomPayload | null;
  testResults: Record<string, unknown> | null;
  session: SessionContext | null;
};

// ── Constants ──────────────────────────────────────────────────────────────────

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

const TEST_LABELS: Record<string, string> = {
  head_orientation:   'Head Orientation',
  visual_search:      'Visual Search',
  memory_cards:       'Memory Cards',
  anti_saccade:       'Anti-Saccade',
  saccadic:           'Saccadic',
  fixation_stability: 'Fixation Stability',
  peripheral_vision:  'Peripheral Vision',
};

// ── Shared layout ──────────────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-slate-800/60 border border-slate-700/80 p-5 shadow-xl">
      <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-4">{title}</h2>
      {children}
    </div>
  );
}

// ── Inline SVG icons ───────────────────────────────────────────────────────────

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

// ── Symptom comparison ─────────────────────────────────────────────────────────

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
      {/* Column headers */}
      <div className="flex items-center gap-2 px-3 pb-2 border-b border-slate-700/50">
        <span className="flex-1 text-xs font-medium text-slate-500 uppercase">Question</span>
        {hasPre  && <span className="text-xs font-medium text-blue-400 uppercase w-24 text-center">Pre</span>}
        {hasPost && <span className="text-xs font-medium text-purple-400 uppercase w-24 text-center">Post</span>}
        {hasPre && hasPost && <span className="text-xs font-medium text-slate-500 uppercase w-10 text-center">Δ</span>}
      </div>

      {/* One row per question */}
      {SYMPTOM_QUESTIONS.map((q, idx) => {
        const preVal  = preScores[q.id]  != null ? Number(preScores[q.id])  : null;
        const postVal = postScores[q.id] != null ? Number(postScores[q.id]) : null;
        const delta   = preVal != null && postVal != null ? postVal - preVal : null;
        return (
          <div key={q.id} className={`flex items-center gap-2 px-3 py-2.5 rounded-lg ${idx % 2 === 0 ? 'bg-slate-800/40' : ''}`}>
            {/* Full question text */}
            <div className="flex-1 min-w-0">
              <span className="text-[10px] font-mono text-slate-500 mr-1.5">{q.id}</span>
              <span className="text-sm text-slate-200">{q.question}</span>
            </div>

            {/* Pre */}
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

            {/* Post */}
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

            {/* Δ */}
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

      {/* Totals */}
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

// ── Per-test visualization (mirrors the user-facing results screen) ─────────────

/**
 * Dispatches to the correct preview visualization component based on testId.
 * Uses `visualOnly={true}` to show only the chart area — metrics are rendered
 * separately via NeurologicalResultParamsDrawer below.
 */
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
          allowClickTargets={raw.allowClickTargets as boolean | undefined}
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
    default:
      return <p className="text-slate-500 text-sm p-4">No visualization available for this test type.</p>;
  }
}

/**
 * Fullscreen overlay for a single test card.
 * Layout: fixed header (title + close) / left=visualization / right=metrics panel (lg).
 * Pressing ESC also closes.
 */
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
  // Close on ESC
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    // Prevent body scroll while open
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  // Focus trap: auto-focus the close button when overlay opens
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeBtnRef.current?.focus(); }, []);

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${TEST_LABELS[testId] ?? testId} — fullscreen`}
      className="fixed inset-0 z-[200] bg-slate-900 flex flex-col"
    >
      {/* ── Header ── */}
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

      {/* ── Body — visualization + replay slider, fills remaining space ── */}
      {/*
        flex flex-col so RESULT_VIZ_OUTER (h-full) resolves correctly.
        overflow-y-auto instead of overflow-hidden so the replay slider
        at the bottom is never clipped when the inner frame is near max-height.
      */}
      <div className="flex-1 min-h-0 flex flex-col overflow-y-auto bg-slate-900/50">
        <NeurologicalResultsViewProvider>
          <ResultVizSessionViewportProvider viewportWidth={vw} viewportHeight={vh}>
            <TestVisualization testId={testId} raw={raw} />
          </ResultVizSessionViewportProvider>
        </NeurologicalResultsViewProvider>
      </div>
    </div>
  );

  // Render into document.body so it escapes any overflow:hidden ancestors
  if (typeof window === 'undefined') return null;
  return createPortal(overlay, document.body);
}

/**
 * Full test card: visualization on the LEFT, params drawer as a sidebar on the RIGHT.
 * This mirrors the fullscreen layout — gives the chart the horizontal room it needs
 * so the aspect-ratio inner frame uses the available height efficiently.
 * Expand button opens a true fullscreen overlay for maximum detail.
 */
function TestResultCard({ testId, data }: { testId: string; data: unknown }) {
  const raw = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const vw = typeof raw.viewportWidth === 'number' ? raw.viewportWidth : undefined;
  const vh = typeof raw.viewportHeight === 'number' ? raw.viewportHeight : undefined;

  const [expanded, setExpanded] = useState(false);
  const onClose = useCallback(() => setExpanded(false), []);

  return (
    <>
      <div className="rounded-xl bg-slate-800/60 border border-slate-700/80 shadow-xl overflow-hidden">
        {/* ── Header ── */}
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

        {/* ── Side-by-side body: viz LEFT · params RIGHT ── */}
        {/*
          lg:h-[400px] locks the row to a fixed height so every card is the same size.
          Viz components use h-full (visualOnly mode) → fill exactly 400px.
          Params sidebar overflows into scroll if content is taller.
        */}
        <NeurologicalResultsViewProvider>
          <ResultVizSessionViewportProvider viewportWidth={vw} viewportHeight={vh}>
            <div className="flex flex-col lg:flex-row lg:h-[400px]">

              {/* LEFT — viz fills fixed row height; aspect-ratio inner frame uses the space */}
              <div className="flex-1 min-w-0 bg-slate-900/50 overflow-hidden">
                <TestVisualization testId={testId} raw={raw} />
              </div>

              {/* RIGHT — params sidebar, same 400px height, scrolls if content overflows */}
              <div className="lg:w-[300px] shrink-0 border-t lg:border-t-0 lg:border-l border-slate-700/60 overflow-y-auto">
                <NeurologicalResultParamsDrawer testId={testId} raw={raw} omitFixedMinHeightLg />
              </div>
            </div>
          </ResultVizSessionViewportProvider>
        </NeurologicalResultsViewProvider>
      </div>

      {/* Fullscreen overlay — portaled to <body> */}
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

// ── Main page ──────────────────────────────────────────────────────────────────

export default function AdminNeuroRunDetailPage() {
  const params = useParams();
  const id = params?.id as string;

  const [run, setRun] = useState<NeuroRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/admin/neurological-runs/${id}`, { credentials: 'include' });
        if (res.status === 404) { if (!cancelled) setNotFound(true); return; }
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setRun(data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id]);

  if (loading) return <div className="space-y-6"><p className="text-slate-400">Loading run…</p></div>;

  if (notFound || !run) {
    return (
      <div className="space-y-6">
        <div className="rounded-xl bg-slate-800/60 border border-slate-700/80 p-6 text-center">
          <h2 className="text-lg font-semibold text-white">Run not found</h2>
          <p className="text-slate-400 text-sm mt-1">The run may have been deleted or the ID is invalid.</p>
          <Link href="/admin/neurological-runs" className="inline-block mt-4 text-blue-400 hover:text-blue-300 font-medium">
            Back to neurological runs
          </Link>
        </div>
      </div>
    );
  }

  const testOrder: string[] = Array.isArray(run.testOrderSnapshot)
    ? run.testOrderSnapshot
    : run.testResults ? Object.keys(run.testResults) : [];

  const demographics = run.session?.demographics;

  return (
    <div className="space-y-8">
      {/* Back nav */}
      <div className="flex items-center gap-4">
        <Link href="/admin/neurological-runs" className="text-slate-400 hover:text-white text-sm font-medium transition">
          ← Back to neurological runs
        </Link>
      </div>

      {/* Section A — Metadata */}
      <SectionCard title="Run overview">
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
          <div>
            <dt className="text-xs text-slate-500 uppercase">Run ID</dt>
            <dd className="font-mono text-sm text-slate-200 mt-0.5 break-all">{run.id}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 uppercase">Session</dt>
            <dd className="text-sm mt-0.5">
              <Link href={`/admin/sessions/${run.sessionId}`} className="font-mono text-blue-400 hover:text-blue-300">
                {run.sessionId.slice(0, 16)}…
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 uppercase">Created</dt>
            <dd className="text-sm text-slate-200 mt-0.5">{new Date(run.createdAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 uppercase">Status</dt>
            <dd className="text-sm mt-0.5">
              <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                run.status === 'completed'   ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
                run.status === 'in_progress' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' :
                'bg-slate-700 text-slate-400'
              }`}>{run.status ?? 'unknown'}</span>
            </dd>
          </div>
          {run.session?.meanErrorPx != null && (
            <div>
              <dt className="text-xs text-slate-500 uppercase">Calibration mean error</dt>
              <dd className="text-sm text-slate-200 mt-0.5 tabular-nums">
                {run.session.meanErrorPx.toFixed(1)} px
                <span className="text-slate-400 text-xs ml-1">
                  / {angularErrorDeg(run.session.meanErrorPx).toFixed(2)}°
                </span>
                <span className="text-slate-500 text-xs ml-1">(affects gaze accuracy)</span>
              </dd>
            </div>
          )}
          {demographics?.age != null && (
            <div>
              <dt className="text-xs text-slate-500 uppercase">Participant</dt>
              <dd className="text-sm text-slate-200 mt-0.5">
                Age {demographics.age}
                {demographics.gender ? ` · ${demographics.gender}` : ''}
                {demographics.country ? ` · ${demographics.country}` : ''}
              </dd>
            </div>
          )}
        </dl>

        {testOrder.length > 0 && (
          <div>
            <p className="text-xs text-slate-500 uppercase mb-2">Test order</p>
            <div className="flex flex-wrap gap-2">
              {testOrder.map((tid, i) => (
                <span key={tid} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-700/60 border border-slate-600 text-xs text-slate-300">
                  <span className="text-slate-500">{i + 1}.</span>
                  {TEST_LABELS[tid] ?? tid}
                </span>
              ))}
            </div>
          </div>
        )}
      </SectionCard>

      {/* Section B — Pre / Post symptoms (collapsible) */}
      <SymptomToggleSection pre={run.preSymptomScores} post={run.postSymptomScores} />


      {/* Section C — Per-test results (visualization + metrics) */}
      {testOrder.length > 0 && run.testResults && (
        <div className="space-y-6">
          <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider px-1">
            Test results
          </h2>
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

      {/* Section D — Actions */}
      <div className="flex gap-3 flex-wrap items-center pt-2">
        <Link href="/admin/neurological-runs" className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium transition">
          ← All neurological runs
        </Link>
        <Link href={`/admin/sessions/${run.sessionId}`} className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium transition">
          View calibration session
        </Link>
        <div className="flex-1" />
        {/* Export Report — opens a print-ready report in a new tab */}
        <Link
          href={`/admin/neurological-runs/${run.id}/report`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white text-sm font-semibold shadow-lg hover:shadow-xl transition-all active:translate-y-[1px]"
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M5 4v3H4a2 2 0 00-2 2v5a2 2 0 002 2h1v2a1 1 0 001 1h8a1 1 0 001-1v-2h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a1 1 0 00-1-1H6a1 1 0 00-1 1zm2 0h6v3H7V4zm-1 9H5a1 1 0 110-2h1v2zm8 0h-1v-2h1a1 1 0 110 2zm-7 2v-2h6v2H8z" clipRule="evenodd" />
          </svg>
          Export Report
        </Link>
      </div>
    </div>
  );
}
