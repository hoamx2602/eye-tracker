'use client';

import React from 'react';
import Modal from './ui/Modal';

type ConsentModalProps = {
  open: boolean;
  onAgree: () => void;
  onDecline: () => void;
};

const CONSENT_TEXT = `
• Will require access to my camera to perform the eye tracking test.
• Will protect user anonymity by destroying all facial data except retinal tracking data. Users are welcomed to wear a mask when performing the test to support privacy.
• Will store and protect eye tracking data using the latest security software (level 3, ISO 27001 Security certified data centres in the UK, SSL encryption).
• May use eye tracking data at a later date to maintain, protect and enhance the service and develop new products.
• Is not a medical device and does not make claims to diagnose or treat any disease. It is intended to improve individual awareness of health and wellness.
• Will not capture or store any personal data about individuals who access the website except where they voluntarily choose to give us personal details by using an electronic form to use our services.
`;

export default function ConsentModal({ open, onAgree, onDecline }: ConsentModalProps) {
  return (
    <Modal open={open} size="md" zIndexClassName="z-[100]">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-gray-700">
          <h2 className="text-xl font-bold text-white">I understand that Eye Tracker:</h2>
          <p className="text-sm text-gray-400 mt-1">Please read before starting calibration</p>
        </div>
        <div className="p-6 overflow-y-auto flex-1 text-sm text-gray-300 whitespace-pre-line leading-relaxed [&>*]:mb-2 scrollbar-invisible">
          {CONSENT_TEXT.split('\n').map((line, i) => {
            if (line.startsWith('**') && line.endsWith('**'))
              return <p key={i} className="font-semibold text-white mt-3 first:mt-0">{line.replace(/\*\*/g, '')}</p>;
            if (line.startsWith('• '))
              return <p key={i} className="pl-2">{line}</p>;
            return <p key={i}>{line || <br />}</p>;
          })}
        </div>
        <div className="p-6 border-t border-gray-700 flex gap-3 justify-end">
          <button
            type="button"
            onClick={onDecline}
            className="px-5 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium rounded-xl transition"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={onAgree}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-xl transition"
          >
            I agree
          </button>
        </div>
      </div>
    </Modal>
  );
}
