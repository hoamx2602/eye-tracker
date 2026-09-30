'use client';

import React, { Suspense } from 'react';
import App from '@/App';
import HomePage from '@/components/HomePage';

/**
 * Catch-all for the eye-tracking module.
 *
 * Route split:
 *   /eye-tracking            → user-facing HomePage (assessment flow entry)
 *   /eye-tracking/consent …  → App flow (consent, demographics, setup, calibration)
 *   /eye-tracking/choice     → App flow (post-calibration choice screen)
 *   /eye-tracking/tracking   → App flow (real-time tracking)
 *   /eye-tracking/neuro/*    → App flow (neurological test suite)
 *   /experiments/*           → handled by app/experiments/[[...path]]/page.tsx
 *
 * Next.js passes params.path = undefined when the URL is exactly /eye-tracking.
 * For any deeper segment it passes an array, e.g. ["neuro", "pre"].
 */
interface Props {
  params: Promise<{ path?: string[] }>;
}

export default function FlowPage({ params }: Props) {
  const { path } = React.use(params);
  const isRoot = !path || path.length === 0;

  if (isRoot) {
    return (
      <Suspense fallback={<div className="min-h-screen w-full bg-gray-950" aria-busy />}>
        <HomePage />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<div className="min-h-screen w-full bg-gray-950" aria-busy />}>
      <App />
    </Suspense>
  );
}
