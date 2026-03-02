'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

type SessionRow = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: string | null;
  meanErrorPx: number | null;
  videoUrl: string | null;
  calibrationImageUrls: unknown;
  calibrationGazeSamples?: Array<{ imageUrl?: string | null }> | null;
};

type ListResponse = { sessions: SessionRow[]; nextCursor: string | null };

const PAGE_SIZE = 30;

export default function AdminSessionsPage() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/sessions?limit=${PAGE_SIZE}`, { credentials: 'include' });
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
      const res = await fetch(`/api/sessions?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(nextCursor)}`, {
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

  function hasImages(s: SessionRow): boolean {
    if (Array.isArray(s.calibrationImageUrls) && s.calibrationImageUrls.length > 0) return true;
    const samples = Array.isArray(s.calibrationGazeSamples) ? s.calibrationGazeSamples : [];
    return samples.some((sample) => sample && (sample as { imageUrl?: string | null }).imageUrl);
  }

  async function handleDelete(id: string) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) return;
      setSessions((prev) => prev.filter((s) => s.id !== id));
      setDeleteConfirmId(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Sessions</h1>
        <p className="text-slate-400 text-sm mt-1">
          List of calibration sessions. Click View to see details, video, and images.
        </p>
      </div>

      <div className="rounded-xl bg-slate-800/60 border border-slate-700/80 overflow-hidden shadow-xl">
        {loading ? (
          <div className="p-8 text-center text-slate-400">Loading sessions…</div>
        ) : sessions.length === 0 ? (
          <div className="p-8 text-center text-slate-400">No sessions yet.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-700 bg-slate-800/80">
                    <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">ID</th>
                    <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Created</th>
                    <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Mean error (px)</th>
                    <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Video</th>
                    <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Images</th>
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
                      <td className="px-4 py-3 text-sm text-slate-300">{s.status ?? '—'}</td>
                      <td className="px-4 py-3 text-sm tabular-nums text-slate-300">
                        {s.meanErrorPx != null ? s.meanErrorPx.toFixed(2) : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {s.videoUrl ? (
                          <span className="text-emerald-400">Yes</span>
                        ) : (
                          <span className="text-slate-500">No</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {hasImages(s) ? (
                          <span className="text-emerald-400">Yes</span>
                        ) : (
                          <span className="text-slate-500">No</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <Link
                            href={`/admin/sessions/${s.id}`}
                            className="p-2 rounded-lg text-slate-400 hover:text-blue-400 hover:bg-slate-700/50 transition"
                            title="View"
                          >
                            <EyeIcon className="w-4 h-4" />
                          </Link>
                          <button
                            type="button"
                            onClick={() => setDeleteConfirmId(s.id)}
                            className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-700/50 transition"
                            title="Delete"
                          >
                            <TrashIcon className="w-4 h-4" />
                          </button>
                        </div>
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

      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" role="dialog" aria-modal="true" aria-labelledby="delete-confirm-title">
          <div className="rounded-xl bg-slate-800 border border-slate-600 shadow-xl max-w-sm w-full p-5">
            <h2 id="delete-confirm-title" className="text-lg font-semibold text-white mb-2">Delete session?</h2>
            <p className="text-slate-400 text-sm mb-4">This cannot be undone. The session and its data will be removed.</p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteConfirmId(null)}
                disabled={deleting}
                className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
                disabled={deleting}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
