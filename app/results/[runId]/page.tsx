/**
 * /results/[runId] — User-facing results page.
 *
 * Phase 1: Server-side guard only.
 *   - If runId is missing → redirect to /
 *   - Placeholder UI with runId displayed
 *
 * Full implementation arrives in Phase 5.
 */

import { redirect } from 'next/navigation';
import Link from 'next/link';

interface Props {
  params: Promise<{ runId: string }>;
}

export default async function ResultsPage({ params }: Props) {
  const { runId } = await params;

  // Guard: malformed or missing runId
  if (!runId || runId.length < 5) {
    redirect('/');
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center gap-6 p-8">

      {/* Brand */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center">
          <svg viewBox="0 0 20 20" fill="none" stroke="white" strokeWidth="1.5" className="w-5 h-5">
            <circle cx="10" cy="10" r="8" />
            <circle cx="10" cy="10" r="3.5" />
            <circle cx="10" cy="10" r="1" fill="white" stroke="none" />
          </svg>
        </div>
        <span className="text-lg font-semibold">Eye Assessment</span>
      </div>

      {/* Main card */}
      <div className="w-full max-w-lg bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-blue-500/10 flex items-center justify-center mx-auto mb-5">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
            className="w-8 h-8 text-blue-400">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M9 12h6m-3-3v6m-9 3h18a2 2 0 002-2V6a2 2 0 00-2-2H3a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>

        <h1 className="text-xl font-bold text-white mb-2">Assessment Results</h1>
        <p className="text-sm text-gray-400 mb-6 leading-relaxed">
          Your personalised results report will appear here once the full results
          page is available. <br />
          <span className="text-gray-600 text-xs mt-2 block">Run ID: {runId}</span>
        </p>

        {/* Phase 5 placeholder note */}
        <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 text-left mb-6">
          <p className="text-xs text-blue-300 font-semibold mb-1">Coming in Phase 5</p>
          <ul className="text-xs text-gray-400 space-y-1 leading-relaxed list-disc list-inside">
            <li>Eye tracking accuracy profile</li>
            <li>Neurological assessment scores (7 domains)</li>
            <li>Self-assessment vs actual performance comparison</li>
            <li>Symptom before / after comparison</li>
            <li>PDF download</li>
          </ul>
        </div>

        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
        >
          ← Back to homepage
        </Link>
      </div>
    </div>
  );
}
