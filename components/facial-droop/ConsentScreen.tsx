'use client';

import React, { useState } from 'react';
import { VoiceControls } from '@/components/ui/VoiceButton';
import { FACIAL_CONSENT_POINTS, FACIAL_SPEECH_TASKS, FACIAL_SPEECH_TOTAL_SECONDS } from '@/lib/facialSpeechProtocol';
import { useVoiceOnMount } from '@/lib/voice/VoiceProvider';

interface ConsentScreenProps {
  onAgree: () => void;
  busy: boolean;
}

/** First screen: what the test is and the consent notice, centred, read aloud. */
export default function ConsentScreen({ onAgree, busy }: ConsentScreenProps) {
  const [checked, setChecked] = useState(false);
  useVoiceOnMount('facial.consent');
  const minutes = Math.ceil((FACIAL_SPEECH_TOTAL_SECONDS + FACIAL_SPEECH_TASKS.length * 20) / 60);

  return (
    <section className="flex max-h-full w-full max-w-2xl flex-col rounded-2xl border border-gray-800 bg-gray-900 shadow-2xl shadow-black/30">
      <header className="border-b border-gray-800 px-6 py-5 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-400">Facial drooping &amp; speech</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Before you start</h1>
        <p className="mt-2 text-sm text-gray-400">
          {FACIAL_SPEECH_TASKS.length} short tasks · about {minutes} minutes · camera and microphone · full screen
        </p>
      </header>
      {/* The only part allowed to scroll, and only on very short screens. */}
      <ul className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-6 py-5 text-sm leading-6 text-gray-300">
        {FACIAL_CONSENT_POINTS.map((point) => (
          <li key={point} className="flex gap-3">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" aria-hidden />
            <span>{point}</span>
          </li>
        ))}
      </ul>
      <footer className="space-y-4 border-t border-gray-800 px-6 py-5">
        <label className="flex cursor-pointer items-start gap-3 text-sm text-gray-200">
          <input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 accent-blue-500" />
          <span>I understand the above and consent to this recording being made and analysed.</span>
        </label>
        <div className="flex items-center justify-between gap-3">
          <VoiceControls voiceKey="facial.consent" />
          <button type="button" onClick={onAgree} disabled={!checked || busy}
            className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition duration-150 ease-out enabled:hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400">
            {busy ? 'Starting camera…' : 'I agree · continue in full screen'}
          </button>
        </div>
      </footer>
    </section>
  );
}
