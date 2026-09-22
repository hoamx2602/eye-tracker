'use client';

/**
 * HomePage — user-facing assessment entry point.
 *
 * Layout: centered two-column. Left = vertical timeline (all steps, natural page scroll).
 * Right = sticky description panel + Begin button.
 *
 * Fix: globals.css sets html { overflow: hidden } for the full-screen test flow.
 * We override it on mount and restore on unmount so this page can scroll normally.
 *
 * Phase 1: static shell — wizard navigation wired in Phase 2.
 */

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isOfflineMetaExportEnabled, withOfflineMetaExportFlag } from '@/lib/offlineExportMeta';
import { VoiceButton } from '@/components/ui/VoiceButton';
import { overviewVoiceKey, type VoiceKey } from '@/lib/voice/scripts';

// ─── Steps ───────────────────────────────────────────────────────────────────
//
// The wording and durations live in lib/assessmentSteps.ts, shared with the
// voice scripts so the spoken version cannot drift from what is on screen.
// Only the icons are local — they are JSX, and that file has to stay
// importable from plain Node scripts.

import {
  CALIBRATION_STEPS as STEP_CONTENT_SET_1,
  NEURO_STEPS as STEP_CONTENT_SET_2,
  type AssessmentStep,
} from '@/lib/assessmentSteps';

type Step = AssessmentStep & { icon: React.ReactNode };

const withIcons = (steps: AssessmentStep[]): Step[] =>
  steps.map((step) => ({ ...step, icon: STEP_ICONS[step.id] ?? <DotGridIcon /> }));

// ─── Icons ────────────────────────────────────────────────────────────────────

function DotGridIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
      <circle cx="10" cy="10" r="3" />
      <circle cx="3.5" cy="3.5" r="1.5" opacity="0.4" />
      <circle cx="16.5" cy="3.5" r="1.5" opacity="0.4" />
      <circle cx="3.5" cy="16.5" r="1.5" opacity="0.4" />
      <circle cx="16.5" cy="16.5" r="1.5" opacity="0.4" />
      <circle cx="10" cy="3.5" r="1.5" opacity="0.25" />
      <circle cx="10" cy="16.5" r="1.5" opacity="0.25" />
    </svg>
  );
}
function WiggleIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px]">
      <path d="M2 10 Q4 7 6 10 Q8 13 10 10 Q12 7 14 10 Q16 13 18 10" strokeLinecap="round" />
    </svg>
  );
}
function HArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
      <path d="M2 10l4-3.5v2h8v-2l4 3.5-4 3.5v-2H6v2z" />
    </svg>
  );
}
function VArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
      <path d="M10 2l3.5 4h-2v8h2L10 18l-3.5-4h2V6h-2z" />
    </svg>
  );
}
function ZoomIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-[18px] h-[18px]">
      <circle cx="10" cy="10" r="7" />
      <circle cx="10" cy="10" r="4" />
      <circle cx="10" cy="10" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
function DiagIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
      <path d="M3 3l14 14M17 3L3 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.5" />
      <circle cx="10" cy="10" r="2" />
    </svg>
  );
}
function HPatternIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px]">
      <path d="M4 3v14M16 3v14M4 10h12" strokeLinecap="round" />
    </svg>
  );
}
function CompassIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-[18px] h-[18px]">
      <circle cx="10" cy="10" r="8" />
      <path d="M10 4v2M10 14v2M4 10h2M14 10h2" strokeLinecap="round" />
      <circle cx="10" cy="10" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px]">
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="M13.5 13.5L18 18" strokeLinecap="round" />
    </svg>
  );
}
function CardIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
      <rect x="2" y="3" width="7" height="10" rx="1.5" opacity="0.4" />
      <rect x="11" y="7" width="7" height="10" rx="1.5" />
    </svg>
  );
}
function SwapIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
      <path d="M2 7l4-4v2h4v4H6v2L2 7zM18 13l-4 4v-2h-4V11h4V9l4 4z" />
    </svg>
  );
}
function BoltIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
      <path d="M11 2L4 11h6l-1 7 7-9h-6l1-7z" />
    </svg>
  );
}
function TargetIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-[18px] h-[18px]">
      <circle cx="10" cy="10" r="8" />
      <circle cx="10" cy="10" r="4" />
      <circle cx="10" cy="10" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
function EyeIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-[18px] h-[18px]">
      <path d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z" />
      <circle cx="10" cy="10" r="2.5" />
    </svg>
  );
}

// ─── Timeline item ────────────────────────────────────────────────────────────

function TimelineItem({
  step,
  isLast,
  isSelected,
  onClick,
}: {
  step: Step;
  isLast: boolean;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <div className="relative flex gap-3 cursor-pointer group" onClick={onClick}>
      {!isLast && (
        <div className="absolute left-[10px] top-[26px] bottom-0 w-px bg-gray-700" />
      )}
      {/* Node */}
      <div className={`
        relative z-10 mt-[3px] flex-shrink-0 w-[22px] h-[22px] rounded-full border-2
        flex items-center justify-center transition-all duration-150
        ${isSelected
          ? 'border-blue-500 bg-blue-500 shadow-sm shadow-blue-500/50'
          : 'border-gray-600 bg-gray-800 group-hover:border-gray-500'}
      `}>
        {isSelected
          ? <div className="w-[7px] h-[7px] rounded-full bg-white" />
          : <div className="w-[5px] h-[5px] rounded-full bg-gray-600 group-hover:bg-gray-400 transition-colors" />
        }
      </div>
      {/* Label */}
      <div className={`flex-1 flex items-center gap-2 pb-5 transition-colors duration-150
        ${isSelected ? 'text-white' : 'text-gray-500 group-hover:text-gray-300'}`}>
        <span className={`flex-shrink-0 transition-colors
          ${isSelected ? 'text-blue-400' : 'text-gray-700 group-hover:text-gray-500'}`}>
          {step.icon}
        </span>
        <div>
          <div className="text-sm font-medium leading-tight">{step.label}</div>
          <div className="text-xs text-gray-700 mt-0.5">{step.duration}</div>
        </div>
      </div>
    </div>
  );
}

// ─── Section label ────────────────────────────────────────────────────────────

/** Icon per step id, keyed to lib/assessmentSteps.ts. */
const STEP_ICONS: Record<string, React.ReactNode> = {
  calibration: <DotGridIcon />,
  wiggling: <WiggleIcon />,
  horizontal: <HArrowIcon />,
  vertical: <VArrowIcon />,
  forward_backward: <ZoomIcon />,
  diagonal: <DiagIcon />,
  h_pattern: <HPatternIcon />,
  head_orientation: <CompassIcon />,
  visual_search: <SearchIcon />,
  memory_cards: <CardIcon />,
  anti_saccade: <SwapIcon />,
  saccadic: <BoltIcon />,
  fixation_stability: <TargetIcon />,
  peripheral_vision: <EyeIcon />,
};

const CALIBRATION_STEPS: Step[] = withIcons(STEP_CONTENT_SET_1);
const NEURO_STEPS: Step[] = withIcons(STEP_CONTENT_SET_2);
const ALL_STEPS: Step[] = [...CALIBRATION_STEPS, ...NEURO_STEPS];

function SectionLabel({ part, title }: { part: string; title: string }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[11px] font-extrabold tracking-[0.12em] text-blue-400 uppercase">{part}</span>
        <div className="flex-1 h-px bg-gray-700" />
      </div>
      <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-3">{title}</p>
    </div>
  );
}

// ─── Step description panel ───────────────────────────────────────────────────

/**
 * Spoken guidance for a preview step.
 *
 * Reads the words on the panel, not the instructions given later at the step
 * itself — the participant is looking at this paragraph while it plays.
 */
function stepVoiceKey(step: Step): VoiceKey | null {
  return overviewVoiceKey(step.id);
}

function StepPanel({ step }: { step: Step }) {
  const isCalibration = step.section === 'calibration';
  const globalIndex = ALL_STEPS.findIndex(s => s.id === step.id);
  const voiceKey = stepVoiceKey(step);

  return (
    <>
      {/* Part badge */}
      <div className="mb-5 flex items-start justify-between gap-4">
        <span className={`
          inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
          text-[11px] font-semibold uppercase tracking-wide border
          ${isCalibration
            ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
            : 'bg-gray-700 text-gray-400 border-gray-600'}
        `}>
          <span className={`w-1.5 h-1.5 rounded-full ${isCalibration ? 'bg-blue-500' : 'bg-gray-500'}`} />
          {isCalibration ? 'Neurological Assessment — Set 1' : 'Neurological Assessment — Set 2'}
        </span>
        {/*
          Preview only, so nothing plays on its own — a participant clicking
          down the fourteen steps would set off fourteen clips.
        */}
        {voiceKey && <VoiceButton voiceKey={voiceKey} iconOnly />}
      </div>

      {/* Icon + title */}
      <div className="flex items-start gap-4 mb-6">
        <div className={`
          w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0
          ${isCalibration ? 'bg-blue-500/10 text-blue-400' : 'bg-gray-700 text-gray-300'}
        `}>
          <div className="scale-[2]">{step.icon}</div>
        </div>
        <div>
          <h2 className="text-xl font-bold text-white leading-tight">{step.label}</h2>
          <div className="flex items-center gap-2 mt-1.5 text-gray-500 text-xs">
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 flex-shrink-0">
              <path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8zm8-3a.75.75 0 01.75.75v2.5h1.75a.75.75 0 010 1.5H8A.75.75 0 017.25 9V5.75A.75.75 0 018 5z" />
            </svg>
            {step.duration}
            <span className="text-gray-600">·</span>
            Step {globalIndex + 1} of {ALL_STEPS.length}
          </div>
        </div>
      </div>

      {/* Tagline */}
      <div className="border-l-2 border-blue-500 pl-4 mb-5">
        <p className="text-base text-gray-200 font-medium leading-snug">{step.tagline}</p>
      </div>

      {/* Description */}
      <p className="text-sm text-gray-400 leading-relaxed">{step.description}</p>

      {/* Progress dots */}
      <div className="flex items-center gap-[3px] mt-8 flex-wrap">
        {ALL_STEPS.map((s, i) => (
          <div key={s.id} className={`h-1 rounded-full transition-all duration-300
            ${s.id === step.id
              ? 'w-5 bg-blue-500'
              : i < globalIndex ? 'w-2 bg-gray-600' : 'w-2 bg-gray-700'}`}
          />
        ))}
      </div>
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [selected, setSelected] = useState<Step>(CALIBRATION_STEPS[0]);
  const router = useRouter();

  // globals.css sets html { overflow: hidden } for the full-screen test flow.
  // Override here so this page can scroll normally, restore on unmount.
  useEffect(() => {
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = 'auto';
    if (isOfflineMetaExportEnabled()) {
      console.log('[offline] exportMeta enabled for this browser tab');
    }
    return () => { html.style.overflow = prev; };
  }, []);

  const totalMin = Math.ceil(ALL_STEPS.reduce((sum, s) => sum + s.durationSec, 0) / 60);

  return (
    <div className="min-h-screen bg-gray-900 text-white">

      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-gray-700 bg-gray-900/95 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-8 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400">
            <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
              <svg viewBox="0 0 20 20" fill="none" stroke="white" strokeWidth="1.5" className="w-3.5 h-3.5">
                <circle cx="10" cy="10" r="7" />
                <circle cx="10" cy="10" r="3" />
                <circle cx="10" cy="10" r="0.8" fill="white" stroke="none" />
              </svg>
            </div>
            <span className="text-sm font-semibold tracking-tight">Eye Assessment</span>
          </Link>
        </div>
      </header>

      {/* Body — centered container */}
      <div className="max-w-5xl mx-auto px-8 py-12">
        <div className="flex gap-12 items-start">

          {/* ── Left: Timeline (natural height, page scrolls) ────── */}
          <aside className="w-64 flex-shrink-0">
            <div className="mb-8">
              <h1 className="text-base font-bold text-white">Assessment Overview</h1>
              <p className="text-xs text-gray-600 mt-1">
                {ALL_STEPS.length} steps · ~{totalMin} min total
              </p>
            </div>

            <SectionLabel part="Neurological Assessment" title="Set 1" />
            {CALIBRATION_STEPS.map((step, i) => (
              <TimelineItem
                key={step.id}
                step={step}
                isLast={i === CALIBRATION_STEPS.length - 1}
                isSelected={selected.id === step.id}
                onClick={() => setSelected(step)}
              />
            ))}


            <SectionLabel part="Neurological Assessment" title="Set 2" />
            {NEURO_STEPS.map((step, i) => (
              <TimelineItem
                key={step.id}
                step={step}
                isLast={i === NEURO_STEPS.length - 1}
                isSelected={selected.id === step.id}
                onClick={() => setSelected(step)}
              />
            ))}
          </aside>

          {/* ── Right: Description card (sticky) ──────────────────── */}
          <div className="flex-1 sticky top-[72px] self-start">
            <div className="bg-gray-800 rounded-2xl border border-gray-600 p-8">
              <StepPanel step={selected} />

              {/* CTA */}
              <div className="mt-8 pt-6 border-t border-gray-700 flex items-center justify-between gap-6">
                <div>
                  <p className="text-sm font-semibold text-white">Ready to begin?</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Click any step to preview it, then start when ready.
                  </p>
                </div>
                {/* Phase 2: router.push('/setup') */}
                <button
                  onClick={() => router.push(withOfflineMetaExportFlag('/consent'))}
                  className="
                    flex items-center gap-2 px-5 py-2.5 rounded-xl flex-shrink-0
                    bg-blue-600 hover:bg-blue-500 active:scale-[0.97]
                    text-white text-sm font-semibold
                    transition-all duration-150
                    shadow-lg shadow-blue-900/40
                  "
                >
                  Begin Assessment
                  <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
                    <path d="M3.75 7.25a.75.75 0 000 1.5h6.69l-3.22 3.22a.75.75 0 101.06 1.06l4.5-4.5a.75.75 0 000-1.06l-4.5-4.5a.75.75 0 10-1.06 1.06l3.22 3.22H3.75z" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
