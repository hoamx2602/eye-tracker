'use client';

import React from 'react';
import Modal from './ui/Modal';

type ConsentModalProps = {
  open: boolean;
  onAgree: () => void;
  onDecline: () => void;
  isPage?: boolean;
};

const CONSENT_TEXT = `
**Study Purpose & Scope**
• I understand that this system is part of a research project aimed at developing neurological assessment tools using eye-tracking technology. 
• I am aware that my participation is voluntary and intended to contribute to the advancement of clinical and scientific knowledge.
• I agree to provide access to my camera for the duration of this session to enable gaze tracking and performance monitoring.
**Data Collection & Processing**
• I acknowledge that my eye-movement data (coordinates) and video/image recordings of my face will be collected and processed. 
• I understand that these data are recorded for the purpose of refining calibration accuracy and verifying test performance.
• I understand that all data are stored securely in UK-based, ISO 27001 certified data centers with SSL encryption, managed under the UK Data Protection Act 2018 (UK GDPR).
**Privacy & Anonymity**
• I understand that while facial imagery is collected, it is strictly used for tracking optimization and will not be used for biometric identity verification or facial recognition purposes.
• I understand that my data will be pseudonymized (associated with a unique ID rather than my name) and that access is restricted to the research team.
**Withdrawal & Rights**
• I understand that I am free to withdraw from the study at any time, without giving any reason and without my legal rights being affected. To withdraw, I can simply close the browser window.
• I agree that anonymized data collected up to the point of withdrawal may still be used by the research team for analysis.
**Not a Medical Device**
• I acknowledge that this tool is not a medical device and is not intended for the diagnosis or treatment of any medical condition. It is for health and wellness awareness and research purposes only.

By clicking "I agree", I confirm that I have read and understood the information above and freely consent to participate in this research study under the terms described.
`;

export default function ConsentModal({ open, onAgree, onDecline, isPage = false }: ConsentModalProps) {
  const content = (
    <div className={`bg-gray-900 border border-gray-700 rounded-3xl shadow-2xl max-w-xl w-full flex flex-col ${isPage ? 'h-[640px]' : 'max-h-[90vh]'}`}>
      <div className="p-6 border-b border-gray-700">
        <h2 className="text-xl font-bold text-white uppercase tracking-tight">Participant Consent & Information</h2>
        <p className="text-sm text-gray-400 mt-1">Please review the research terms carefully</p>
      </div>
      <div className="p-6 overflow-y-auto flex-1 text-sm text-gray-300 whitespace-pre-line leading-relaxed [&>*]:mb-2 scrollbar-invisible">
        {CONSENT_TEXT.trim().split('\n').map((line, i) => {
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
