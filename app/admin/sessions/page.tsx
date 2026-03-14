'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { EyeIcon, TrashIcon } from '@/components/admin/AdminIcons';
import DeleteConfirmDialog from '@/components/admin/DeleteConfirmDialog';

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

      <DeleteConfirmDialog
        open={deleteConfirmId !== null}
        title="Delete session?"
        description="This cannot be undone. The session and its data will be removed."
        confirmLabel="Delete"
        confirming={deleting}
        onCancel={() => setDeleteConfirmId(null)}
        onConfirm={() => deleteConfirmId && handleDelete(deleteConfirmId)}
      />
    </div>
  );
}
