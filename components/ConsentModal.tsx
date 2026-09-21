'use client';

import React from 'react';
import Modal from './ui/Modal';
import { VoiceButton } from './ui/VoiceButton';
import { useVoice } from '@/lib/voice/VoiceProvider';
import { CONSENT_SECTIONS, CONSENT_CLOSING } from '@/lib/consentText';

type ConsentModalProps = {
  open: boolean;
  onAgree: () => void;
  onDecline: () => void;
  isPage?: boolean;
};

export default function ConsentModal({ open, onAgree, onDecline, isPage = false }: ConsentModalProps) {
  // Nothing plays on its own here: this is a screen to read at your own pace,
  // and consent is the one place a participant should never feel hurried.
  // The speaker button reads these same terms aloud, on request.
  const voice = useVoice();

  const content = (
    <div className={`bg-gray-900 border border-gray-700 rounded-3xl shadow-2xl max-w-xl w-full flex flex-col ${isPage ? 'h-[640px]' : 'max-h-[90vh]'}`}>
      <div className="p-6 border-b border-gray-700">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-white uppercase tracking-tight">Participant Consent & Information</h2>
            <p className="text-sm text-gray-400 mt-1">Please review the research terms carefully</p>
          </div>
          {/* Reads the terms below, spoken in the second person. */}
          <VoiceButton voiceKey="consent.terms" iconOnly />
        </div>
      </div>
      <div className="p-6 overflow-y-auto flex-1 text-sm text-gray-300 leading-relaxed scrollbar-invisible">
        {CONSENT_SECTIONS.map((section) => (
          <section key={section.heading} className="mb-4 last:mb-0">
            <h3 className="font-semibold text-white mb-2">{section.heading}</h3>
            <ul className="flex flex-col gap-2">
              {section.points.map((point) => (
                <li key={point.written} className="pl-2">
                  {'\u2022 '}
                  {point.written}
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p className="mt-4">{CONSENT_CLOSING.written}</p>
      </div>
      <div className="p-6 border-t border-gray-700 flex gap-3 justify-end">
        <button
          type="button"
          onClick={() => {
            voice?.stop();
            onDecline();
          }}
          className="px-5 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium rounded-xl transition"
        >
          Decline
        </button>
        <button
          type="button"
          onClick={() => {
            voice?.stop();
            onAgree();
          }}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-xl transition"
        >
          I agree
        </button>
      </div>
    </div>
  );

  if (isPage) {
    return content;
  }

  return (
    <Modal open={open} size="md" zIndexClassName="z-[100]">
      {content}
    </Modal>
  );
}
