'use client';

import React from 'react';
import BottomActionBar from './BottomActionBar';

export type PracticeGateProps = {
  /** Practice UI rendered by the test (e.g. simplified version of the task) */
  children: React.ReactNode;
  onStartRealTest: () => void;
  /** Optional title above the practice area */
  title?: string;
};

export default function PracticeGate({
  children,
  onStartRealTest,
  title = 'Practice',
}: PracticeGateProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-gray-950 overflow-hidden"
      role="region"
      aria-labelledby="practice-gate-title"
    >
      <div className="flex-shrink-0 border-b border-gray-800/60 bg-gradient-to-b from-blue-600/10 to-transparent">
        <div className="p-6 max-w-3xl mx-auto">
          <h2 id="practice-gate-title" className="text-2xl font-bold text-white text-center tracking-tight">
            {title}
          </h2>
          <p className="mt-2 text-sm text-gray-300/90 text-center">
            Try it out. When you are ready, start the real test.
          </p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6 w-full">
        <div className="max-w-3xl mx-auto">
          {children}
        </div>
      </div>
      <BottomActionBar>
        <button
          type="button"
          onClick={onStartRealTest}
          className="group px-7 py-3.5 bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white font-semibold rounded-2xl transition shadow-[0_10px_30px_rgba(0,140,255,0.18)] active:translate-y-[1px]"
        >
          <span className="inline-flex items-center gap-2">
            <span>Start real test</span>
            <span className="opacity-90 group-hover:translate-x-0.5 transition">→</span>
          </span>
        </button>
      </BottomActionBar>
    </div>
  );
}
