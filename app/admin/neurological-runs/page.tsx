'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { EyeIcon } from '@/components/admin/AdminIcons';

type NeuroRunRow = {
  id: string;
  sessionId: string;
  status: string | null;
  createdAt: string;
  updatedAt: string;
  testOrderSnapshot: unknown;
  preSymptomScores: unknown;
  postSymptomScores: unknown;
  testResults: unknown;
};

type ListResponse = { runs: NeuroRunRow[]; nextCursor: string | null };

const PAGE_SIZE = 30;

function statusBadge(status: string | null) {
  const s = status ?? 'unknown';
  const map: Record<string, string> = {
    completed: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
    in_progress: 'bg-blue-500/20 text-blue-300 border border-blue-500/30',
    unknown: 'bg-slate-700 text-slate-400',
  };
  const cls = map[s] ?? 'bg-slate-700 text-slate-400';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {s}
    </span>
  );
}

function testCount(row: NeuroRunRow): number {
  if (Array.isArray(row.testOrderSnapshot)) return (row.testOrderSnapshot as string[]).length;
  const tr = row.testResults;
  if (tr && typeof tr === 'object') return Object.keys(tr as object).length;
  return 0;
}

function hasSymptoms(row: NeuroRunRow): boolean {
  return !!(row.preSymptomScores || row.postSymptomScores);
}

export default function AdminNeuroRunsPage() {
  const [runs, setRuns] = useState<NeuroRunRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/admin/neurological-runs?limit=${PAGE_SIZE}`, {
          credentials: 'include',
        });
        if (!res.ok) return;
        const data: ListResponse = await res.json();
        if (!cancelled) {
          setRuns(data.runs || []);
          setNextCursor(data.nextCursor ?? null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/admin/neurological-runs?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(nextCursor)}`,
        { credentials: 'include' }
      );
      if (!res.ok) return;
      const data: ListResponse = await res.json();
      setRuns((prev) => [...prev, ...(data.runs || [])]);
      setNextCursor(data.nextCursor ?? null);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Neurological Runs</h1>
        <p className="text-slate-400 text-sm mt-1">
          Completed neurological test sessions. Click View to see per-test metrics and symptom scores.
        </p>
      </div>

      <div className="rounded-xl bg-slate-800/60 border border-slate-700/80 overflow-hidden shadow-xl">
        {loading ? (
          <div className="p-8 text-center text-slate-400">Loading…</div>
        ) : runs.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            No neurological runs yet. Complete the neurological test flow in the app to see results here.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-700 bg-slate-800/80">
                    <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Run ID</th>
                    <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Session</th>
                    <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Created</th>
                    <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Tests</th>
                    <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Symptoms</th>
                    <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider w-20">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-b border-slate-700/60 hover:bg-slate-700/30 transition">
                      <td className="px-4 py-3 font-mono text-sm text-slate-300">{r.id.slice(0, 10)}…</td>
                      <td className="px-4 py-3 text-sm">
                        <Link
                          href={`/admin/sessions/${r.sessionId}`}
                          className="font-mono text-blue-400 hover:text-blue-300 transition"
                        >
                          {r.sessionId.slice(0, 10)}…
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-300">
                        {new Date(r.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">{statusBadge(r.status)}</td>
                      <td className="px-4 py-3 text-sm text-slate-300 tabular-nums">{testCount(r)}</td>
                      <td className="px-4 py-3 text-sm text-slate-300">
                        {hasSymptoms(r) ? (
                          <span className="text-emerald-400">Pre + Post</span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/neurological-runs/${r.id}`}
                          className="p-2 rounded-lg text-slate-400 hover:text-blue-400 hover:bg-slate-700/50 transition inline-flex"
                          title="View results"
                        >
                          <EyeIcon className="w-4 h-4" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {nextCursor && (
              <div className="border-t border-slate-700 px-4 py-3 flex justify-center">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 px-4 py-2 text-sm font-medium transition disabled:opacity-50"
                >
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
