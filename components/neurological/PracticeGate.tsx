'use client';

import React from 'react';

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
      <div className="flex-shrink-0 p-4 border-b border-gray-800">
        <h2 id="practice-gate-title" className="text-lg font-bold text-white">
          {title}
        </h2>
        <p className="text-gray-400 text-sm mt-1">
          Try it out. When you are ready, click &quot;Start real test&quot; below.
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {children}
      </div>
      <div className="flex-shrink-0 p-6 border-t border-gray-800 flex justify-center">
        <button
          type="button"
          onClick={onStartRealTest}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition"
        >
          Start real test
        </button>
      </div>
    </div>
  );
}
