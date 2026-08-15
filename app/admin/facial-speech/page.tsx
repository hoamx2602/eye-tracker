'use client';

/**
 * Admin: facial drooping & speech captures.
 *
 * These are Sessions with no calibration or gaze data, so the calibration
 * columns (mean error, dot images) say nothing about them. What matters here is
 * whether a capture is complete enough to analyse later: which task windows it
 * actually contains, whether the video and its metadata both reached storage,
 * and who the subject was. A row expands to those details in place — the
 * capture is one video and one manifest, which does not warrant its own page.
 */

import { useCallback, useEffect, useState } from 'react';
import { EyeIcon, TrashIcon } from '@/components/admin/AdminIcons';
import DeleteConfirmDialog from '@/components/admin/DeleteConfirmDialog';
import { FACIAL_SPEECH_PENDING_STATUS } from '@/lib/facialSpeechArchive';
import { FACIAL_SPEECH_TASKS } from '@/lib/facialSpeechProtocol';

type CapturedTask = { id: string; recordedDurationMs?: number; endedEarly?: boolean };

type CaptureConfig = {
  protocol?: string;
  captureId?: string;
  analysis?: string;
  metadataUrl?: string | null;
  manifest?: {
    captureStartedAt?: string | null;
    consent?: { acknowledgedAt?: string | null; source?: string | null };
    tasks?: CapturedTask[];
    media?: { container?: string };
    segmentation?: { recorderStartLatencyMs?: number | null };
  };
};

type CaptureRow = {
  id: string;
  createdAt: string;
  status: string | null;
  videoUrl: string | null;
  config?: CaptureConfig | null;
  demographics?: { age?: number; gender?: string; country?: string; eyeConditions?: string[] } | null;
};

type ListResponse = { sessions: CaptureRow[]; nextCursor: string | null };

const PAGE_SIZE = 30;
const EXPECTED_TASK_COUNT = FACIAL_SPEECH_TASKS.length;

async function getSignedUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/admin/signed-url?url=${encodeURIComponent(url)}`, { credentials: 'include' });
    if (!res.ok) return null;
    const data = await res.json();
    return data.url ?? null;
  } catch {
    return null;
  }
}

function taskCount(row: CaptureRow): number {
  const tasks = row.config?.manifest?.tasks;
  return Array.isArray(tasks) ? tasks.length : 0;
}

function subjectLabel(row: CaptureRow): string {
  const d = row.demographics;
  if (!d) return '—';
  const parts = [
    d.age != null ? `${d.age}y` : null,
    d.gender || null,
    d.country || null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

export default function AdminFacialSpeechPage() {
  const [rows, setRows] = useState<CaptureRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [signedVideoUrls, setSignedVideoUrls] = useState<Record<string, string>>({});
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/sessions?protocol=facial-speech&limit=${PAGE_SIZE}`, { credentials: 'include' });
        if (!res.ok) return;
        const data: ListResponse = await res.json();
        if (!cancelled) {
          setRows(data.sessions || []);
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
        `/api/sessions?protocol=facial-speech&limit=${PAGE_SIZE}&cursor=${encodeURIComponent(nextCursor)}`,
        { credentials: 'include' },
      );
      if (!res.ok) return;
      const data: ListResponse = await res.json();
      setRows((prev) => [...prev, ...(data.sessions || [])]);
      setNextCursor(data.nextCursor ?? null);
    } finally {
      setLoadingMore(false);
    }
  }

  // The bucket is private, so the stored video only plays through a signed URL.
  const toggleExpanded = useCallback(async (row: CaptureRow) => {
    const opening = expandedId !== row.id;
    setExpandedId(opening ? row.id : null);
    if (!opening || !row.videoUrl || signedVideoUrls[row.id]) return;
    const signed = await getSignedUrl(row.videoUrl);
    if (signed) setSignedVideoUrls((prev) => ({ ...prev, [row.id]: signed }));
  }, [expandedId, signedVideoUrls]);

  async function handleDelete(id: string) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) return;
      setRows((prev) => prev.filter((r) => r.id !== id));
      setDeleteConfirmId(null);
    } finally {
      setDeleting(false);
    }
  }

  const pendingCount = rows.filter((r) => r.status === FACIAL_SPEECH_PENDING_STATUS).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Facial Droop</h1>
        <p className="mt-1 text-sm text-slate-400">
          Facial drooping &amp; motor-speech captures. Each row is one video plus the task windows that make it
          analysable. Captures stored with analysis deferred are measured in a later batch run.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-700/80 bg-slate-800/60 shadow-xl">
        {loading ? (
          <div className="p-8 text-center text-slate-400">Loading captures…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            No facial captures yet. They appear here once a capture is saved from the facial drooping assessment.
          </div>
        ) : (
          <>
            <div className="border-b border-slate-700 px-4 py-2 text-xs text-slate-400">
              {rows.length} loaded · {pendingCount} awaiting analysis
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-700 bg-slate-800/80">
                    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-slate-400">ID</th>
                    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-slate-400">Captured</th>
                    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-slate-400">Subject</th>
                    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-slate-400">Tasks</th>
                    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-slate-400">Video</th>
                    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-slate-400">Metadata</th>
                    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-slate-400">Analysis</th>
                    <th className="w-24 px-4 py-3 text-xs font-medium uppercase tracking-wider text-slate-400">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const captured = taskCount(row);
                    const partial = captured < EXPECTED_TASK_COUNT;
                    const isExpanded = expandedId === row.id;
                    return (
                      <FragmentRow
                        key={row.id}
                        row={row}
                        captured={captured}
                        partial={partial}
                        isExpanded={isExpanded}
                        signedVideoUrl={signedVideoUrls[row.id]}
                        onToggle={() => void toggleExpanded(row)}
                        onDelete={() => setDeleteConfirmId(row.id)}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
            {nextCursor && (
              <div className="flex justify-center border-t border-slate-700 px-4 py-3">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-600 disabled:opacity-50"
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
        title="Delete capture?"
        description="This cannot be undone. The capture record is removed; the video and metadata objects stay in storage."
        confirmLabel="Delete"
        confirming={deleting}
        onCancel={() => setDeleteConfirmId(null)}
        onConfirm={() => deleteConfirmId && handleDelete(deleteConfirmId)}
      />
    </div>
  );
}

function FragmentRow({
  row,
  captured,
  partial,
  isExpanded,
  signedVideoUrl,
  onToggle,
  onDelete,
}: {
  row: CaptureRow;
  captured: number;
  partial: boolean;
  isExpanded: boolean;
  signedVideoUrl?: string;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const manifest = row.config?.manifest;
  const analysisDeferred = row.config?.analysis === 'deferred';
  return (
    <>
      <tr className="border-b border-slate-700/60 transition hover:bg-slate-700/30">
        <td className="px-4 py-3 font-mono text-sm text-slate-300">{row.id.slice(0, 10)}…</td>
        <td className="px-4 py-3 text-sm text-slate-300">{new Date(row.createdAt).toLocaleString()}</td>
        <td className="px-4 py-3 text-sm text-slate-300">{subjectLabel(row)}</td>
        <td className={`px-4 py-3 text-sm tabular-nums ${partial ? 'text-amber-400' : 'text-slate-300'}`}>
          {captured} / {EXPECTED_TASK_COUNT}
        </td>
        <td className="px-4 py-3 text-sm">
          {row.videoUrl ? <span className="text-emerald-400">Yes</span> : <span className="text-red-400">Missing</span>}
        </td>
        <td className="px-4 py-3 text-sm">
          {row.config?.metadataUrl ? (
            <span className="text-emerald-400">Yes</span>
          ) : (
            <span className="text-red-400">Missing</span>
          )}
        </td>
        <td className="px-4 py-3 text-sm">
          {row.status === FACIAL_SPEECH_PENDING_STATUS ? (
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-300">
              {analysisDeferred ? 'Deferred' : 'Pending'}
            </span>
          ) : (
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-300">
              {row.status ?? '—'}
            </span>
          )}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onToggle}
              className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-700/50 hover:text-blue-400"
              title={isExpanded ? 'Hide details' : 'View details'}
            >
              <EyeIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-700/50 hover:text-red-400"
              title="Delete"
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          </div>
        </td>
      </tr>
      {isExpanded && (
        <tr className="border-b border-slate-700/60 bg-slate-900/40">
          <td colSpan={8} className="px-4 py-5">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div>
                <h3 className="text-sm font-semibold text-slate-200">Recorded task windows</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Only these windows are analysed; guidance and countdown frames are excluded.
                </p>
                <div className="mt-3 overflow-hidden rounded-lg border border-slate-700">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-slate-800/80 text-slate-400">
                        <th className="px-3 py-2 font-medium">Task</th>
                        <th className="px-3 py-2 font-medium">Recorded</th>
                        <th className="px-3 py-2 font-medium">Ended early</th>
                      </tr>
                    </thead>
                    <tbody>
                      {FACIAL_SPEECH_TASKS.map((task) => {
                        const done = manifest?.tasks?.find((t) => t.id === task.id);
                        return (
                          <tr key={task.id} className="border-t border-slate-700/60">
                            <td className="px-3 py-2 text-slate-300">{task.title}</td>
                            <td className="px-3 py-2 tabular-nums text-slate-300">
                              {done?.recordedDurationMs != null
                                ? `${(done.recordedDurationMs / 1000).toFixed(1)}s`
                                : done
                                  ? '—'
                                  : <span className="text-red-400">not captured</span>}
                            </td>
                            <td className="px-3 py-2 text-slate-400">
                              {done ? (done.endedEarly ? 'Yes' : 'No') : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-200">Capture video</h3>
                  {row.videoUrl ? (
                    signedVideoUrl ? (
                      <video src={signedVideoUrl} controls className="mt-2 w-full rounded-lg border border-slate-700" />
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">Preparing a signed link…</p>
                    )
                  ) : (
                    <p className="mt-2 text-xs text-red-400">No video was stored for this capture.</p>
                  )}
                </div>

                <dl className="space-y-1.5 text-xs">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Capture id</dt>
                    <dd className="truncate font-mono text-slate-300">{row.config?.captureId ?? '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Consent</dt>
                    <dd className="text-slate-300">
                      {manifest?.consent?.acknowledgedAt
                        ? new Date(manifest.consent.acknowledgedAt).toLocaleString()
                        : '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Consent source</dt>
                    <dd className="text-slate-300">{manifest?.consent?.source ?? '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Container</dt>
                    <dd className="text-slate-300">{manifest?.media?.container ?? '—'}</dd>
                  </div>
                  {row.config?.metadataUrl ? (
                    <div className="pt-1">
                      <a
                        href={row.config.metadataUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
                      >
                        Metadata object URL
                      </a>
                    </div>
                  ) : null}
                </dl>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
