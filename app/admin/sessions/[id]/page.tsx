'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

type SessionDetail = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: string | null;
  meanErrorPx: number | null;
  videoUrl: string | null;
  calibrationImageUrls: unknown;
  validationErrors?: number[];
  config?: unknown;
};

async function getSignedUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(
      `/api/admin/signed-url?url=${encodeURIComponent(url)}`,
      { credentials: 'include' }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.url ?? null;
  } catch {
    return null;
  }
}

export default function AdminSessionDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [signedVideoUrl, setSignedVideoUrl] = useState<string | null>(null);
  const [signedImageUrls, setSignedImageUrls] = useState<string[]>([]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/sessions/${id}`, { credentials: 'include' });
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        if (!res.ok) return;
        const data: SessionDetail = await res.json();
        if (!cancelled) setSession(data);

        const imageUrls = Array.isArray(data.calibrationImageUrls)
          ? (data.calibrationImageUrls as string[])
          : [];
        const urlsToSign = [
          ...(data.videoUrl ? [data.videoUrl] : []),
          ...imageUrls,
        ];
        if (urlsToSign.length > 0) {
          const signed = await Promise.all(urlsToSign.map((u) => getSignedUrl(u)));
          if (cancelled) return;
          const videoCount = data.videoUrl ? 1 : 0;
          if (data.videoUrl) setSignedVideoUrl(signed[0] ?? null);
          setSignedImageUrls(signed.slice(videoCount).map((u) => u ?? ''));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id]);

  const imageUrls = Array.isArray(session?.calibrationImageUrls)
    ? (session!.calibrationImageUrls as string[])
    : [];

  if (loading) {
    return (
      <div className="space-y-6">
        <p className="text-slate-400">Loading session…</p>
      </div>
    );
  }

  if (notFound || !session) {
    return (
      <div className="space-y-6">
        <div className="rounded-xl bg-slate-800/60 border border-slate-700/80 p-6 text-center">
          <h2 className="text-lg font-semibold text-white">Session not found</h2>
          <p className="text-slate-400 text-sm mt-1">The session may have been deleted or the ID is invalid.</p>
          <Link
            href="/admin/sessions"
            className="inline-block mt-4 text-blue-400 hover:text-blue-300 font-medium"
          >
            Back to sessions
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4 flex-wrap">
        <Link
          href="/admin/sessions"
          className="text-slate-400 hover:text-white text-sm font-medium transition"
        >
          ← Back to sessions
        </Link>
      </div>

      {/* Overview */}
      <div className="rounded-xl bg-slate-800/60 border border-slate-700/80 p-5 shadow-xl">
        <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-4">
          Overview
        </h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <dt className="text-xs text-slate-500 uppercase">ID</dt>
            <dd className="font-mono text-sm text-slate-200 mt-0.5 break-all">{session.id}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 uppercase">Created</dt>
            <dd className="text-sm text-slate-200 mt-0.5">
              {new Date(session.createdAt).toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 uppercase">Status</dt>
            <dd className="text-sm text-slate-200 mt-0.5">{session.status ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 uppercase">Mean error (px)</dt>
            <dd className="text-sm text-slate-200 mt-0.5 tabular-nums">
              {session.meanErrorPx != null ? session.meanErrorPx.toFixed(2) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 uppercase">Video</dt>
            <dd className="text-sm text-slate-200 mt-0.5">
              {session.videoUrl ? 'Yes' : 'No'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 uppercase">Calibration images</dt>
            <dd className="text-sm text-slate-200 mt-0.5">{imageUrls.length}</dd>
          </div>
        </dl>
      </div>

      {/* Video */}
      <div className="rounded-xl bg-slate-800/60 border border-slate-700/80 p-5 shadow-xl">
        <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-4">
          Video
        </h2>
        {session.videoUrl ? (
          <div className="space-y-2">
            <video
              controls
              className="w-full max-w-2xl rounded-lg bg-black aspect-video"
              src={signedVideoUrl ?? session.videoUrl}
              preload="metadata"
            >
              Your browser does not support the video tag.
            </video>
            <p className="text-slate-500 text-xs">
              <a
                href={signedVideoUrl ?? session.videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300"
              >
                Open in new tab
              </a>
            </p>
          </div>
        ) : (
          <p className="text-slate-500 text-sm">No video recorded for this session.</p>
        )}
      </div>

      {/* Calibration images */}
      <div className="rounded-xl bg-slate-800/60 border border-slate-700/80 p-5 shadow-xl">
        <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-4">
          Calibration images
        </h2>
        {imageUrls.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {imageUrls.map((url, i) => (
              <a
                key={i}
                href={signedImageUrls[i] || url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-lg overflow-hidden border border-slate-600 bg-slate-900 hover:border-slate-500 transition focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                <img
                  src={signedImageUrls[i] || url}
                  alt={`Calibration frame ${i + 1}`}
                  className="w-full aspect-video object-cover"
                  loading="lazy"
                />
                <p className="text-xs text-slate-500 px-2 py-1 text-center">Frame {i + 1}</p>
              </a>
            ))}
          </div>
        ) : (
          <p className="text-slate-500 text-sm">No calibration images for this session.</p>
        )}
      </div>
    </div>
  );
}
