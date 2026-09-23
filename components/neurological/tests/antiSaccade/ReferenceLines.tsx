'use client';

import React from 'react';

/**
 * The faint dashed cross-hair marking centre — shared by the real test and
 * practice so the two can't visually drift apart the way the dim rect once
 * did (see AntiSaccadePractice's showDimRect fix). `className` positions it
 * within whatever container it's dropped into: `fixed inset-0` for the
 * real test's full-screen layout, `absolute inset-0` for practice's smaller
 * bounded box.
 */
export default function ReferenceLines({ className }: { className: string }) {
  return (
    <div className={`${className} pointer-events-none`} aria-hidden>
      <div className="absolute inset-y-0 left-1/2 -translate-x-px w-px border-l-2 border-dashed border-white/15" />
      <div className="absolute inset-x-0 top-1/2 -translate-y-px h-px border-t-2 border-dashed border-white/15" />
    </div>
  );
}
