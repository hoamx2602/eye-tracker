'use client';

/**
 * The rest screen shown between two steps of the session.
 *
 * It exists for three reasons at once: the participant's eyes get a break
 * before the next task, they see what is coming and start it when they are
 * ready rather than being thrown into it, and the idle time is used to upload
 * the step that just finished — so a session that is abandoned halfway has
 * already banked everything up to that point.
 *
 * Check-in questions, when the study asks for them, render as `children`;
 * `canContinue` then gates the Next button until they are answered.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { VoiceButton } from './ui/VoiceButton';
import { useVoice, useVoiceOwnedClip } from '@/lib/voice/VoiceProvider';
import type { VoiceKey } from '@/lib/voice/scripts';
import EyeSpinner from './ui/EyeSpinner';

export type StepBreakSaveState = 'idle' | 'saving' | 'saved' | 'error';

export type StepBreakProps = {
  /** The step that just finished, e.g. "Horizontal". */
  stepLabel: string;
  /** 1-based position of the finished step, when the sequence has a known length. */
  stepIndex?: number;
  stepTotal?: number;
  /** The step that comes next. Omit when this was the last one. */
  nextLabel?: string | null;
  /** One line on what the next step asks of the participant. */
  nextDescription?: string | null;
  /**
   * Spoken instructions for the next step.
   *
   * Played here, on the break, rather than on the task screen itself: a full
   * instruction takes ten seconds or so, and on the task screen it would be
   * talking over the thing it is describing. The task screen repeats only the
   * short cue.
   */
  nextVoiceKey?: VoiceKey | null;
  saveState?: StepBreakSaveState;
  saveError?: string | null;
  onNext: () => void;
  /** Offered when the step can be repeated. */
  onRedo?: () => void;
  /** Gates Next — used when check-in questions must be answered first. */
  canContinue?: boolean;
  /** Reason Next is disabled, shown under the buttons. */
  blockedReason?: string | null;
  nextLabelOverride?: string;
  children?: React.ReactNode;
};

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

function SaveStatus({ state, error }: { state: StepBreakSaveState; error?: string | null }) {
  if (state === 'idle') return null;

  if (state === 'saving') {
    return (
      <div className="flex items-center gap-2 text-sm text-blue-300">
        <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" aria-hidden />
        <span>Saving your data…</span>
      </div>
    );
  }

  if (state === 'saved') {
    return (
      <div className="flex items-center gap-2 text-sm text-emerald-400">
        <span aria-hidden>✓</span>
        <span>Your data from this step is saved.</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm text-amber-400">
      <span aria-hidden>!</span>
      <span>
        {error ?? 'Could not save this step yet — it will be saved again at the end.'}
      </span>
    </div>
  );
}

export default function StepBreak({
  stepLabel,
  stepIndex,
  stepTotal,
  nextLabel,
  nextDescription,
  nextVoiceKey,
  saveState = 'idle',
  saveError,
  onNext,
  onRedo,
  canContinue = true,
  blockedReason,
  nextLabelOverride,
  children,
}: StepBreakProps) {
  const isLast = !nextLabel;
  const [elapsed, setElapsed] = useState(0);
  const voice = useVoice();
  const speakSequence = voice?.speakSequence;
  const breakKey: VoiceKey = isLast ? 'break.last' : 'break.rest';

  /** Rest prompt, then the instructions for whatever comes next. */
  const sequence = useMemo<VoiceKey[]>(
    () => (nextVoiceKey ? [breakKey, nextVoiceKey] : [breakKey]),
    [breakKey, nextVoiceKey]
  );

  // The break owns these clips: pressing Next must not leave the "coming up
  // next" instructions playing over the task that just started.
  useVoiceOwnedClip(sequence);
  useEffect(() => {
    speakSequence?.(sequence);
  }, [speakSequence, sequence]);

  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-gray-950 overflow-y-auto pointer-events-auto"
      role="region"
      aria-labelledby="step-break-title"
    >
      <div className="flex-shrink-0 border-b border-gray-800/60 bg-gradient-to-b from-emerald-600/10 to-transparent">
        <div className="p-6 max-w-2xl mx-auto flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-emerald-300/90 uppercase tracking-widest font-semibold">
              {stepIndex != null && stepTotal != null
                ? `Step ${stepIndex} of ${stepTotal} complete`
                : 'Step complete'}
            </p>
            <h2 id="step-break-title" className="mt-1 text-2xl font-bold text-white tracking-tight">
              {stepLabel}
            </h2>
          </div>
          <VoiceButton voiceKey={breakKey} sequence={sequence} iconOnly />
        </div>
      </div>

      <div className="flex-1 p-6">
        <div className="max-w-2xl mx-auto flex flex-col gap-5">
          {/* Rest prompt — the actual point of the break. */}
          <div className="rounded-2xl border border-gray-800/70 bg-gradient-to-b from-gray-900/60 to-gray-950/40 p-5">
            <div className="flex items-center gap-4">
              <EyeSpinner size="sm" />
              <div className="min-w-0">
                <p className="text-white font-semibold">Rest your eyes for a moment</p>
                <p className="text-sm text-gray-300/90 mt-0.5">
                  Look away from the screen, blink a few times, and relax your shoulders.
                  Take as long as you need — nothing is being timed.
                </p>
              </div>
            </div>
            <p className="mt-4 text-xs text-gray-500 tabular-nums">
              Resting for {formatElapsed(elapsed)}
            </p>
          </div>

          {/* Check-in questions, when the study asks for them. */}
          {children}

          {/* What is coming, so the next screen is never a surprise. */}
          {nextLabel ? (
            <div className="rounded-2xl border border-blue-500/25 bg-blue-500/5 p-5">
              <p className="text-xs text-blue-300/90 uppercase tracking-widest font-semibold">
                Coming up next
              </p>
              <p className="mt-1 text-white font-semibold">{nextLabel}</p>
              {nextDescription && (
                <p className="mt-1 text-sm text-gray-300/90 leading-relaxed">{nextDescription}</p>
              )}
              {/*
                No speaker here. The one at the top of the screen already plays
                the rest prompt and these instructions as one sequence, so a
                second button beside the text was two controls for one job.
              */}
            </div>
          ) : (
            <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-5">
              <p className="text-white font-semibold">That was the last step</p>
              <p className="mt-1 text-sm text-gray-300/90">
                Select Next when you are ready to finish.
              </p>
            </div>
          )}

          <SaveStatus state={saveState} error={saveError} />
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-gray-800/60 bg-gray-950/90 backdrop-blur">
        <div className="max-w-2xl mx-auto p-6 flex flex-col gap-2">
          <div className="flex gap-3">
            {onRedo && (
              <button
                type="button"
                onClick={onRedo}
                className="px-6 py-3.5 rounded-2xl border border-gray-600 bg-gray-800 hover:bg-gray-700 hover:border-gray-500 text-white font-semibold text-sm transition active:translate-y-[1px]"
              >
                Repeat this step
              </button>
            )}
            <button
              type="button"
              onClick={onNext}
              disabled={!canContinue}
              className={[
                'group flex-1 px-7 py-3.5 font-semibold rounded-2xl transition active:translate-y-[1px]',
                canContinue
                  ? 'bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white shadow-[0_10px_30px_rgba(0,140,255,0.18)]'
                  : 'bg-gray-800 text-gray-500 cursor-not-allowed',
              ].join(' ')}
            >
              <span className="inline-flex items-center justify-center gap-2">
                <span>{nextLabelOverride ?? (isLast ? 'Next' : "I'm ready — continue")}</span>
                {canContinue && (
                  <span className="opacity-90 group-hover:translate-x-0.5 transition">→</span>
                )}
              </span>
            </button>
          </div>
          {!canContinue && blockedReason && (
            <p className="text-xs text-gray-500 text-center">{blockedReason}</p>
          )}
        </div>
      </div>
    </div>
  );
}
