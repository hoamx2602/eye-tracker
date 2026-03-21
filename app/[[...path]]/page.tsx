'use client';

import React, { Suspense } from 'react';
import App from '@/App';

/**
 * Single page for the main flow so that client state is preserved when
 * navigating between paths (/, /tracking, /neuro/pre, etc.).
 * Path is reflected in the URL; App syncs state from pathname and pushes
 * path when step changes.
 * Suspense: App uses useSearchParams (e.g. /neuro/done?preview=1).
 */
export default function FlowPage() {
  return (
    <Suspense fallback={<div className="min-h-screen w-full bg-gray-950" aria-busy />}>
      <App />
    </Suspense>
  );
}
