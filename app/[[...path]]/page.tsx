'use client';

import App from '@/App';

/**
 * Single page for the main flow so that client state is preserved when
 * navigating between paths (/, /tracking, /neuro/pre, etc.).
 * Path is reflected in the URL; App syncs state from pathname and pushes
 * path when step changes.
 */
export default function FlowPage() {
  return <App />;
}
