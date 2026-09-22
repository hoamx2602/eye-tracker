'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

type Demographics = { age?: number; gender?: string; country?: string; eyeConditions?: string[] } | null;

type SessionHistoryRow = {
  id: string;
  createdAt: string;
  status: string | null;
  meanErrorPx: number | null;
  demographics: Demographics;
  videoUrl: string | null;
  neurologicalRun: { id: string; status: string; createdAt: string } | null;
};

type DetailResponse = { email: string; sessions: SessionHistoryRow[] };

function statusBadge(status: string | null) {
  const cls =
    status === 'completed'
      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
      : status === 'in_progress'
        ? 'bg-blue-500/20 text-blue-300 border-blue-500/30'
        : 'bg-slate-700 text-slate-400 border-slate-600';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${cls}`}>
      {status ?? 'unknown'}
    </span>
  );
}

export default function AdminParticipantHistoryPage() {
  const params = useParams();
  const emailParam = params?.email as string;

  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!emailParam) return;
    let cancelled = false;
    async function load() {
      try {
        // Next's useParams() for a route segment containing '@' isn't
        // reliably pre-decoded across versions — decode defensively (a
        // no-op on an already-plain email) before encoding exactly once
        // for the outgoing request, so this never double-encodes into
        // %2540 and 404s against a route the list page really did create.
        const res = await fetch(`/api/admin/participants/${encodeURIComponent(decodeURIComponent(emailParam))}`, {
          credentials: 'include',
        });
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        if (!res.ok) return;
        const json: DetailResponse = await res.json();
        if (!cancelled) setData(json);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [emailParam]);

  if (loading) {
    return <div className="space-y-6"><p className="text-slate-400">Loading history…</p></div>;
  }

  if (notFound || !data) {
    return (
      <div className="space-y-6">
        <div className="rounded-xl bg-slate-800/60 border border-slate-700/80 p-6 text-center">
          <h2 className="text-lg font-semibold text-white">No history found</h2>
          <p className="text-slate-400 text-sm mt-1">No sessions are recorded for this email.</p>
          <Link href="/admin/participants" className="inline-block mt-4 text-blue-400 hover:text-blue-300 font-medium">
            ← Back to participants
          </Link>
        </div>
      </div>
    );
  }

  const latestDemographics = data.sessions.find((s) => s.demographics)?.demographics ?? null;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Link href="/admin/participants" className="text-slate-400 hover:text-white text-sm font-medium transition">
          ← All participants
        </Link>
      </div>

      <div className="rounded-xl bg-slate-800/60 border border-slate-700/80 p-5 shadow-xl">
        <h1 className="text-xl font-bold text-white break-all">{data.email}</h1>
        <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-400">
          <span>{data.sessions.length} session{data.sessions.length === 1 ? '' : 's'}</span>
          {latestDemographics?.age != null && (
            <span>
              Age {latestDemographics.age}
              {latestDemographics.gender ? ` · ${latestDemographics.gender}` : ''}
              {latestDemographics.country ? ` · ${latestDemographics.country}` : ''}
            </span>
          )}
        </div>
        {data.sessions.length > 1 && (
          <p className="mt-3 text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 inline-block">
            This participant has more than one sitting — each is a separate, independent
            assessment (there is no cross-session "resume"), so compare them rather than
            treating any one as continuing another.
          </p>
        )}
      </div>

      <div className="space-y-4">
        <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider px-1">
          Session history — newest first
        </h2>
        <div className="rounded-xl bg-slate-800/60 border border-slate-700/80 overflow-hidden shadow-xl divide-y divide-slate-700/60">
          {data.sessions.map((s, i) => (
            <div key={s.id} className="p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
              <div className="shrink-0 w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-300">
                {data.sessions.length - i}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm text-slate-300">{s.id.slice(0, 12)}…</span>
                  {statusBadge(s.status)}
                  {s.videoUrl && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-400 uppercase tracking-wide">
                      Has video
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-400 mt-1">
                  {new Date(s.createdAt).toLocaleString()}
                  {s.meanErrorPx != null && ` · ${s.meanErrorPx.toFixed(1)} px mean error`}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Link
                  href={`/admin/sessions/${s.id}`}
                  className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-medium transition"
                >
                  Calibration
                </Link>
                {s.neurologicalRun ? (
                  <Link
                    href={`/admin/neurological-runs/${s.neurologicalRun.id}`}
                    className="px-3 py-1.5 rounded-lg bg-blue-600/20 border border-blue-500/30 hover:bg-blue-600/30 text-blue-300 text-xs font-medium transition"
                  >
                    Neuro run ({s.neurologicalRun.status})
                  </Link>
                ) : (
                  <span className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-500 text-xs">No neuro run</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
