'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { EyeIcon } from '@/components/admin/AdminIcons';

type ParticipantRow = {
  email: string;
  sessionCount: number;
  runCount: number;
  firstSeen: string;
  lastSeen: string;
};

type ListResponse = { participants: ParticipantRow[]; total: number; nextOffset: number | null };

const PAGE_SIZE = 30;

export default function AdminParticipantsPage() {
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const url = new URL('/api/admin/participants', window.location.origin);
      url.searchParams.set('limit', String(PAGE_SIZE));
      if (q) url.searchParams.set('q', q);
      const res = await fetch(url.toString(), { credentials: 'include' });
      if (!res.ok) return;
      const data: ListResponse = await res.json();
      setParticipants(data.participants || []);
      setTotal(data.total ?? 0);
      setNextOffset(data.nextOffset ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => load(query.trim()), query ? 300 : 0);
    return () => clearTimeout(id);
  }, [query, load]);

  async function loadMore() {
    if (nextOffset == null || loadingMore) return;
    setLoadingMore(true);
    try {
      const url = new URL('/api/admin/participants', window.location.origin);
      url.searchParams.set('limit', String(PAGE_SIZE));
      url.searchParams.set('offset', String(nextOffset));
      if (query.trim()) url.searchParams.set('q', query.trim());
      const res = await fetch(url.toString(), { credentials: 'include' });
      if (!res.ok) return;
      const data: ListResponse = await res.json();
      setParticipants((prev) => [...prev, ...(data.participants || [])]);
      setNextOffset(data.nextOffset ?? null);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Participants</h1>
        <p className="text-slate-400 text-sm mt-1">
          One row per email — a participant can have more than one session (e.g. a repeat sitting).
          Click View for their full history.
        </p>
      </div>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by email…"
        className="w-full max-w-sm px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      <div className="rounded-xl bg-slate-800/60 border border-slate-700/80 overflow-hidden shadow-xl">
        {loading ? (
          <div className="p-8 text-center text-slate-400">Loading participants…</div>
        ) : participants.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            {query ? 'No participants match that search.' : 'No participants yet.'}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-700 bg-slate-800/80">
                    <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Email</th>
                    <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Sessions</th>
                    <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Neuro runs</th>
                    <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">First seen</th>
                    <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Last seen</th>
                    <th className="px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider w-24">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {participants.map((p) => (
                    <tr key={p.email} className="border-b border-slate-700/60 hover:bg-slate-700/30 transition">
                      <td className="px-4 py-3 text-sm text-slate-200 max-w-[20rem] truncate" title={p.email}>
                        {p.email}
                      </td>
                      <td className="px-4 py-3 text-sm tabular-nums text-slate-300">
                        {p.sessionCount}
                        {p.sessionCount > 1 && (
                          <span className="ml-2 inline-block px-2 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/30 text-blue-300 text-[10px] font-semibold uppercase tracking-wide">
                            Repeat
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm tabular-nums text-slate-300">{p.runCount}</td>
                      <td className="px-4 py-3 text-sm text-slate-300">{new Date(p.firstSeen).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-sm text-slate-300">{new Date(p.lastSeen).toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/participants/${encodeURIComponent(p.email)}`}
                          className="p-2 rounded-lg text-slate-400 hover:text-blue-400 hover:bg-slate-700/50 transition inline-flex"
                          title="View history"
                        >
                          <EyeIcon className="w-4 h-4" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-slate-700 px-4 py-3 flex items-center justify-between text-xs text-slate-500">
              <span>{participants.length} of {total}</span>
              {nextOffset != null && (
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 px-4 py-2 text-sm font-medium transition disabled:opacity-50"
                >
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
