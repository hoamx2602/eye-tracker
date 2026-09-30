'use client';

import React from 'react';

interface FacialShellProps {
  /** Left of the top bar: back link or exit control. */
  leading?: React.ReactNode;
  /** Right of the top bar, before the speaker control. */
  trailing?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Viewport-sized frame for every facial-droop screen: a slim top bar and a
 * stage that centres its content. The page never scrolls; anything tall must
 * size itself to the stage (see CameraView) or scroll inside its own card.
 */
export default function FacialShell({ leading, trailing, children }: FacialShellProps) {
  return (
    <main className="fixed inset-0 flex flex-col overflow-hidden bg-gray-950 text-white">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">{leading}</div>
        <div className="flex items-center gap-3 pr-12">{trailing}</div>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center px-4 pb-6 sm:px-6">{children}</div>
    </main>
  );
}
