'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import BottomActionBar from './BottomActionBar';
import { VoiceButton } from '@/components/ui/VoiceButton';
import { useVoice, useVoiceOwnedClip } from '@/lib/voice/VoiceProvider';
import type { VoiceKey } from '@/lib/voice/scripts';

const PRACTICE_MIN_DELAY_MS = 5000;

export type PracticeGateProps = {
  /** Practice UI rendered by the test (e.g. simplified version of the task) */
  children: React.ReactNode;
  onStartRealTest: () => void;
  /** Optional title above the practice area */
  title?: string;
  /** Min ms before "Start real test" button appears (default 5000). Practice can call markPracticeDone() to show earlier. */
  minDelayMs?: number;
  /**
   * The task's own instructions, spoken after a short practice framing.
   *
   * Without this the practice only announced that it was a practice, which
   * tells a participant nothing about what they are supposed to do — and this
   * is the screen where they are meant to learn exactly that.
   */
  instructionsVoiceKey?: VoiceKey | null;
};

type PracticeGateContextValue = {
  markPracticeDone: () => void;
};

const PracticeGateContext = createContext<PracticeGateContextValue | null>(null);

export function usePracticeGate(): PracticeGateContextValue | null {
  return useContext(PracticeGateContext);
}

export default function PracticeGate({
  children,
  onStartRealTest,
  title = 'Practice',
  minDelayMs = PRACTICE_MIN_DELAY_MS,
  instructionsVoiceKey = null,
}: PracticeGateProps) {
  const [showStartButton, setShowStartButton] = useState(false);

  // Straight into the task. The banner and the header already say this is a
  // practice; repeating it aloud before all six of them spends the seconds
  // where the participant is actually listening on something they can see.
  const voice = useVoice();
  const speak = voice?.speak;
  useVoiceOwnedClip(instructionsVoiceKey);
  useEffect(() => {
    if (!instructionsVoiceKey || !speak) return;
    speak(instructionsVoiceKey);
  }, [instructionsVoiceKey, speak]);

  useEffect(() => {
    const t = setTimeout(() => setShowStartButton(true), minDelayMs);
    return () => clearTimeout(t);
  }, [minDelayMs]);

  const markPracticeDone = useCallback(() => setShowStartButton(true), []);

  return (
    <PracticeGateContext.Provider value={{ markPracticeDone }}>
      {/*
        Practice is amber at the edges — banner and frame — so it can never be
        mistaken for the recorded test, which is blue with a red REC badge.
      */}
      <div
        className="fixed inset-0 z-50 flex flex-col bg-gray-950 overflow-hidden ring-4 ring-inset ring-amber-500/50"
        role="region"
        aria-labelledby="practice-gate-title"
      >
        <div className="flex-shrink-0 bg-amber-500/15 border-b border-amber-500/40">
          <div className="px-6 py-2 max-w-3xl mx-auto flex items-center justify-center gap-2 text-amber-200">
            <span className="w-2 h-2 rounded-full bg-amber-400" aria-hidden />
            <span className="text-xs font-bold uppercase tracking-[0.2em]">
              Practice — nothing is recorded
            </span>
          </div>
        </div>

        <div className="flex-shrink-0 border-b border-gray-800/60 bg-gradient-to-b from-amber-500/10 to-transparent">
          <div className="p-6 max-w-3xl mx-auto relative">
            <div className="absolute right-0 top-4">
              {instructionsVoiceKey && <VoiceButton voiceKey={instructionsVoiceKey} iconOnly />}
            </div>
            <h2 id="practice-gate-title" className="text-2xl font-bold text-white text-center tracking-tight">
              {title}
            </h2>
            <p className="mt-2 text-sm text-gray-300/90 text-center">
              Have a go — this is only to get you used to the task. Your answers here are not saved.
            </p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6 w-full">
          <div className="max-w-3xl mx-auto">
            {children}
          </div>
        </div>
        {showStartButton && (
          <BottomActionBar>
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={onStartRealTest}
                className="group px-7 py-3.5 bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white font-semibold rounded-2xl transition shadow-[0_10px_30px_rgba(0,140,255,0.18)] active:translate-y-[1px]"
              >
                <span className="inline-flex items-center gap-2">
                  <span>I&apos;m ready — start the real test</span>
                  <span className="opacity-90 group-hover:translate-x-0.5 transition">→</span>
                </span>
              </button>
              <p className="text-xs text-gray-500">
                Practice as long as you like. The real test begins only when you press this.
              </p>
            </div>
          </BottomActionBar>
        )}
      </div>
    </PracticeGateContext.Provider>
  );
}
