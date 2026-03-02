'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

type SessionRow = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: string | null;
  meanErrorPx: number | null;
  videoUrl: string | null;
  calibrationImageUrls: unknown;
  calibrationGazeSamples?: unknown;
  config?: unknown;
  testRun?: { id: string; segmentCount: number } | null;
};

type ListResponse = { sessions: SessionRow[]; nextCursor: string | null };

const PAGE_SIZE = 50;

export default function AdminTestsPage() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/sessions?limit=${PAGE_SIZE}&testOnly=1`, { credentials: 'include' });
        if (!res.ok) return;
        const data: ListResponse = await res.json();
        if (!cancelled) {
          setSessions(data.sessions || []);
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
      const res = await fetch(`/api/sessions?limit=${PAGE_SIZE}&testOnly=1&cursor=${encodeURIComponent(nextCursor)}`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const data: ListResponse = await res.json();
      setSessions((prev) => [...prev, ...(data.sessions || [])]);
      setNextCursor(data.nextCursor ?? null);
    } finally {
      setLoadingMore(false);
    }
  }

  function testSegmentCount(s: SessionRow): number {
    return s.testRun?.segmentCount ?? 0;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Tests</h1>
        <p className="text-slate-400 text-sm mt-1">
          Sessions recorded in Test mode (target vs gaze). Click View to see deviation charts.
        </p>
      </div>

      <div className="rounded-xl bg-slate-800/60 border border-slate-700/80 overflow-hidden shadow-xl">
        {loading ? (
          <div className="p-8 text-center text-slate-400">Loading…</div>
        ) : sessions.length === 0 ? (
          <div className="p-8 text-center text-slate-400">No test sessions yet. Use &quot;Start Test&quot; in the app to record one.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-700 bg-slate-800/80">
                    <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">ID</th>
                    <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Created</th>
                    <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Segments</th>
                    <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Mean error (px)</th>
                    <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider w-24">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id} className="border-b border-slate-700/60 hover:bg-slate-700/30 transition">
                      <td className="px-4 py-3 font-mono text-sm text-slate-300">{s.id.slice(0, 10)}…</td>
                      <td className="px-4 py-3 text-sm text-slate-300">
                        {new Date(s.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-300">{testSegmentCount(s)}</td>
                      <td className="px-4 py-3 text-sm tabular-nums text-slate-300">
                        {s.meanErrorPx != null ? s.meanErrorPx.toFixed(2) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/sessions/${s.id}`}
                          className="text-blue-400 hover:text-blue-300 text-sm font-medium"
                        >
                          View
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
