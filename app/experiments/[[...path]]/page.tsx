'use client';

import React, { Suspense } from 'react';
import App from '@/App';

/**
 * /experiments — researcher / technician entry point.
 * Renders the full legacy App flow (calibration → choice → tracking → neuro).
 * Mirrors the old [[...path]] catch-all so internal router.push() calls that
 * produce paths like /experiments/choice, /experiments/neuro/pre, etc. all work.
 *
 * The user-facing flow now lives at /.
 */
export default function ExperimentsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen w-full bg-gray-950" aria-busy />}>
      <App />
    </Suspense>
  );
}
