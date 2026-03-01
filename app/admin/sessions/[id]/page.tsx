'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FEATURE_DIMENSION_NAMES } from '@/lib/featureAnalytics';

type CalibrationSample = {
  screenX?: number;
  screenY?: number;
  features?: number[];
  timestamp?: number;
  head?: { valid: boolean; message: string; faceWidth?: number; minFaceWidth?: number; maxFaceWidth?: number; targetDistanceCm?: number };
  imageUrl?: string | null;
  patternName?: string;
};

type SessionDetail = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: string | null;
  meanErrorPx: number | null;
  videoUrl: string | null;
  calibrationImageUrls: unknown;
  calibrationGazeSamples?: CalibrationSample[] | null;
  validationErrors?: number[];
  config?: unknown;
  demographics?: { age?: number; gender?: string; country?: string; eyeConditions?: string[] } | null;
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

function CalibrationSampleCard({
  sample,
  index,
  signedUrl,
  showTooltip,
  onMouseEnterCard,
  onMouseLeaveCard,
  onMouseEnterTooltip,
  onMouseLeaveTooltip,
  onViewDetail,
}: {
  sample: CalibrationSample;
  index: number;
  signedUrl: string;
  showTooltip: boolean;
  onMouseEnterCard: () => void;
  onMouseLeaveCard: () => void;
  onMouseEnterTooltip: () => void;
  onMouseLeaveTooltip: () => void;
  onViewDetail?: () => void;
}) {
  const head = sample.head;
  const tooltipEl = showTooltip && (
    <div
      className="absolute z-20 left-1/2 -translate-x-1/2 top-full mt-2 w-64 max-w-[calc(100vw-2rem)] bg-slate-800 border border-slate-600 rounded-lg p-3 text-xs shadow-xl"
      role="tooltip"
      onMouseEnter={onMouseEnterTooltip}
      onMouseLeave={onMouseLeaveTooltip}
    >
      <div className="absolute left-1/2 -translate-x-1/2 bottom-full border-4 border-transparent border-b-slate-600" />
      <p className="font-semibold text-slate-200 mb-2">Sample #{index + 1}</p>
      {sample.patternName && (
        <p className="text-slate-400 mb-2">Pattern: {sample.patternName}</p>
      )}
      <dl className="space-y-1 text-slate-300">
        <div><dt className="text-slate-500">screenX</dt><dd className="font-mono">{sample.screenX != null ? sample.screenX : '—'}</dd></div>
        <div><dt className="text-slate-500">screenY</dt><dd className="font-mono">{sample.screenY != null ? sample.screenY : '—'}</dd></div>
        {sample.timestamp != null && (
          <div><dt className="text-slate-500">timestamp</dt><dd className="font-mono">{sample.timestamp}</dd></div>
        )}
        {sample.features && (
          <div><dt className="text-slate-500">features</dt><dd className="font-mono">{sample.features.length} dims</dd></div>
        )}
        {head && (
          <>
            <div><dt className="text-slate-500">head.valid</dt><dd>{String(head.valid)}</dd></div>
            <div><dt className="text-slate-500">head.message</dt><dd>{head.message}</dd></div>
            {head.faceWidth != null && <div><dt className="text-slate-500">head.faceWidth</dt><dd className="font-mono">{head.faceWidth.toFixed(4)}</dd></div>}
            {head.minFaceWidth != null && <div><dt className="text-slate-500">head.minFaceWidth</dt><dd className="font-mono">{head.minFaceWidth.toFixed(4)}</dd></div>}
            {head.maxFaceWidth != null && <div><dt className="text-slate-500">head.maxFaceWidth</dt><dd className="font-mono">{head.maxFaceWidth.toFixed(4)}</dd></div>}
            {head.targetDistanceCm != null && <div><dt className="text-slate-500">head.targetDistanceCm</dt><dd className="font-mono">{head.targetDistanceCm} cm</dd></div>}
          </>
        )}
      </dl>
    </div>
  );
  return (
    <div
      className="rounded-lg overflow-visible border border-slate-600 bg-slate-900 flex flex-col relative cursor-pointer"
      onMouseEnter={onMouseEnterCard}
      onMouseLeave={onMouseLeaveCard}
      onClick={(e) => {
        if (onViewDetail && !(e.target as HTMLElement).closest('a')) onViewDetail();
      }}
      role={onViewDetail ? 'button' : undefined}
    >
      <div className="relative rounded-t-lg">
        {sample.imageUrl ? (
          <div className="block aspect-video bg-slate-800 overflow-hidden rounded-t-lg">
            <img
              src={signedUrl}
              alt={`Sample ${index + 1}`}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </div>
        ) : (
          <div className="aspect-video bg-slate-800 flex items-center justify-center text-slate-500 text-xs rounded-t-lg">
            No image
          </div>
        )}
        {tooltipEl}
      </div>
      <div className="p-2 text-xs space-y-0.5">
        {sample.patternName && (
          <p className="text-slate-300 font-medium truncate" title={sample.patternName}>
            {sample.patternName}
          </p>
        )}
        <p className="text-slate-400 font-mono">
          ({sample.screenX != null ? Math.round(sample.screenX) : '—'}, {sample.screenY != null ? Math.round(sample.screenY) : '—'}) px
        </p>
        {head && (
          <p className={head.valid ? 'text-green-500' : 'text-amber-500'}>
            {head.valid ? 'Head OK' : head.message}
            {head.faceWidth != null && ` · fw ${head.faceWidth.toFixed(3)}`}
          </p>
        )}
      </div>
    </div>
  );
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function SampleDetailModal({
  sample,
  index,
  signedUrl,
  onClose,
}: {
  sample: CalibrationSample;
  index: number;
  signedUrl: string;
  onClose: () => void;
}) {
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, translateX: 0, translateY: 0 });
  const zoomContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = zoomContainerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.15 : 0.15;
      setScale((s) => Math.min(10, Math.max(0.5, s + delta)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const handleWheel = (e: React.WheelEvent) => e.preventDefault();

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY, translateX: translate.x, translateY: translate.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setTranslate({
      x: dragStartRef.current.translateX + (e.clientX - dragStartRef.current.x),
      y: dragStartRef.current.translateY + (e.clientY - dragStartRef.current.y),
    });
  };

  const resetZoom = () => { setScale(1); setTranslate({ x: 0, y: 0 }); };

  const features = sample.features ?? [];
  const head = sample.head;
  const hasFeatures = features.length >= FEATURE_DIMENSION_NAMES.length;
  const leftEyeX = hasFeatures ? 50 + Math.max(-40, Math.min(40, features[1] ?? 0)) : 50;
  const leftEyeY = hasFeatures ? 50 + Math.max(-40, Math.min(40, features[2] ?? 0)) : 50;
  const rightEyeX = hasFeatures ? 50 + Math.max(-40, Math.min(40, features[3] ?? 0)) : 50;
  const rightEyeY = hasFeatures ? 50 + Math.max(-40, Math.min(40, features[4] ?? 0)) : 50;
  const pitchDeg = hasFeatures && features[9] != null ? radToDeg(features[9]) : 0;
  const yawDeg = hasFeatures && features[10] != null ? radToDeg(features[10]) : 0;
  const rollDeg = hasFeatures && features[11] != null ? radToDeg(features[11]) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="sample-detail-title">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative z-10 w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-xl bg-slate-800 border border-slate-600 shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-slate-600 bg-slate-800">
          <h2 id="sample-detail-title" className="text-lg font-semibold text-white">Sample #{index + 1}</h2>
          <button type="button" onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition" aria-label="Close">
            <span className="text-xl leading-none">×</span>
          </button>
        </div>
        <div className="p-4 space-y-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-shrink-0">
              {sample.imageUrl ? (
                <div className="rounded-lg overflow-hidden border border-slate-600 bg-slate-900 max-w-sm">
                  <div
                    ref={zoomContainerRef}
                    className="relative w-full aspect-video overflow-hidden cursor-grab active:cursor-grabbing select-none bg-slate-900"
                    onWheel={handleWheel}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={() => setIsDragging(false)}
                    onMouseLeave={() => setIsDragging(false)}
                    style={{ touchAction: 'none' }}
                  >
                    <img
                      src={signedUrl}
                      alt={`Sample ${index + 1}`}
                      className="absolute inset-0 w-full h-full object-cover origin-center pointer-events-none"
                      style={{
                        transform: `scale(${scale}) translate(${translate.x / scale}px, ${translate.y / scale}px)`,
                      }}
                      draggable={false}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 p-2 border-t border-slate-600 flex-wrap">
                    <span className="text-xs text-slate-500">Scroll to zoom · Drag to pan</span>
                    <button type="button" onClick={resetZoom} className="text-xs text-blue-400 hover:text-blue-300">Reset</button>
                    <a href={signedUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300">Open in new tab</a>
                  </div>
                </div>
              ) : (
                <div className="w-64 h-36 rounded-lg bg-slate-700 flex items-center justify-center text-slate-500 text-sm">No image</div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <dl className="grid grid-cols-2 gap-2 text-sm">
                {sample.patternName && <><dt className="text-slate-500">Pattern</dt><dd className="text-slate-200">{sample.patternName}</dd></>}
                <dt className="text-slate-500">screenX</dt><dd className="font-mono text-slate-200">{sample.screenX != null ? sample.screenX : '—'}</dd>
                <dt className="text-slate-500">screenY</dt><dd className="font-mono text-slate-200">{sample.screenY != null ? sample.screenY : '—'}</dd>
                {sample.timestamp != null && <><dt className="text-slate-500">timestamp</dt><dd className="font-mono text-slate-200">{sample.timestamp}</dd></>}
                {head && (
                  <>
                    <dt className="text-slate-500">Head</dt><dd className={head.valid ? 'text-green-400' : 'text-amber-400'}>{head.valid ? 'OK' : head.message}</dd>
                    {head.faceWidth != null && <><dt className="text-slate-500">faceWidth</dt><dd className="font-mono text-slate-200">{head.faceWidth.toFixed(4)}</dd></>}
                    {head.targetDistanceCm != null && <><dt className="text-slate-500">targetDistanceCm</dt><dd className="font-mono text-slate-200">{head.targetDistanceCm}</dd></>}
                  </>
                )}
              </dl>
            </div>
          </div>
          {hasFeatures && (
            <div className="rounded-lg border border-slate-600 bg-slate-900/50 p-4">
              <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">Feature vector (18 dims)</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {FEATURE_DIMENSION_NAMES.map((name, i) => (
                  <div key={i} className="flex flex-col rounded bg-slate-800/80 px-2 py-1.5">
                    <span className="text-xs text-slate-500 truncate" title={name}>{name}</span>
                    <span className="font-mono text-sm text-slate-200 tabular-nums">{typeof features[i] === 'number' ? (features[i] as number).toFixed(4) : '—'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {hasFeatures && (
            <div className="rounded-lg border border-slate-600 bg-slate-900/50 p-4">
              <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">Eye gaze (relative position)</h3>
              <p className="text-xs text-slate-500 mb-3">Pupil position relative to eye center (leftEyeX/Y, rightEyeX/Y).</p>
              <div className="flex justify-center gap-8">
                <div className="text-center">
                  <span className="text-xs text-slate-500 block mb-1">Left eye</span>
                  <svg viewBox="0 0 100 100" className="w-24 h-24 text-slate-600">
                    <ellipse cx="50" cy="50" rx="42" ry="28" fill="none" stroke="currentColor" strokeWidth="2" />
                    <circle cx={leftEyeX} cy={leftEyeY} r="8" fill="#38bdf8" />
                  </svg>
                  <p className="text-xs font-mono text-slate-400 mt-1">X: {(features[1] ?? 0).toFixed(2)} · Y: {(features[2] ?? 0).toFixed(2)}</p>
                </div>
                <div className="text-center">
                  <span className="text-xs text-slate-500 block mb-1">Right eye</span>
                  <svg viewBox="0 0 100 100" className="w-24 h-24 text-slate-600">
                    <ellipse cx="50" cy="50" rx="42" ry="28" fill="none" stroke="currentColor" strokeWidth="2" />
                    <circle cx={rightEyeX} cy={rightEyeY} r="8" fill="#38bdf8" />
                  </svg>
                  <p className="text-xs font-mono text-slate-400 mt-1">X: {(features[3] ?? 0).toFixed(2)} · Y: {(features[4] ?? 0).toFixed(2)}</p>
                </div>
              </div>
            </div>
          )}
          {hasFeatures && (
            <div className="rounded-lg border border-slate-600 bg-slate-900/50 p-4">
              <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">Head pose</h3>
              <p className="text-xs text-slate-500 mb-3">Pitch: up/down · Yaw: left/right · Roll: tilt (degrees).</p>
              <div className="flex flex-wrap gap-6">
                <div><span className="text-xs text-slate-500 block">Pitch</span><span className="font-mono text-slate-200">{pitchDeg.toFixed(1)}°</span></div>
                <div><span className="text-xs text-slate-500 block">Yaw</span><span className="font-mono text-slate-200">{yawDeg.toFixed(1)}°</span></div>
                <div><span className="text-xs text-slate-500 block">Roll</span><span className="font-mono text-slate-200">{rollDeg.toFixed(1)}°</span></div>
              </div>
            </div>
          )}
          {head && (head.faceWidth != null || head.minFaceWidth != null || head.maxFaceWidth != null) && (
            <div className="rounded-lg border border-slate-600 bg-slate-900/50 p-4">
              <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">Face distance</h3>
              <p className="text-xs text-slate-500 mb-2">Face width (normalized). Green = acceptable range.</p>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-8 rounded-full bg-slate-700 relative overflow-hidden">
                  {head.minFaceWidth != null && head.maxFaceWidth != null && (
                    <div
                      className="absolute inset-y-0 bg-green-900/40"
                      style={{ left: `${Math.min(100, (head.minFaceWidth / 0.2) * 100)}%`, width: `${Math.max(0, ((head.maxFaceWidth - head.minFaceWidth) / 0.2) * 100)}%` }}
                    />
                  )}
                  {head.faceWidth != null && (
                    <div className="absolute top-1/2 -translate-y-1/2 w-3 h-6 -ml-1.5 rounded bg-sky-400 border border-white shadow" style={{ left: `${Math.min(90, (head.faceWidth / 0.2) * 100)}%` }} />
                  )}
                </div>
                <div className="text-xs text-slate-400 min-w-[120px]">
                  {head.faceWidth != null && <span className="font-mono">{head.faceWidth.toFixed(3)}</span>}
                  {head.minFaceWidth != null && head.maxFaceWidth != null && <span className="text-slate-500"> (min {head.minFaceWidth.toFixed(3)} – max {head.maxFaceWidth.toFixed(3)})</span>}
                </div>
              </div>
              {head.targetDistanceCm != null && <p className="text-xs text-slate-500 mt-1">Target distance: {head.targetDistanceCm} cm</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminSessionDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [signedVideoUrl, setSignedVideoUrl] = useState<string | null>(null);
  const [signedImageUrls, setSignedImageUrls] = useState<string[]>([]);
  const [signedSampleUrls, setSignedSampleUrls] = useState<string[]>([]);

  const samples = Array.isArray(session?.calibrationGazeSamples) ? session!.calibrationGazeSamples : [];
  const isNewFormat = samples.some((s) => s && ('imageUrl' in s || 'head' in s));
  const imageUrlsForCompat = Array.isArray(session?.calibrationImageUrls) ? (session!.calibrationImageUrls as string[]) : [];

  const [visibleSampleCount, setVisibleSampleCount] = useState(10);
  const visibleSamples = samples.slice(0, visibleSampleCount);
  const hasMoreSamples = visibleSampleCount < samples.length;

  const [activeTooltipIndex, setActiveTooltipIndex] = useState<number | null>(null);
  const [selectedSampleIndex, setSelectedSampleIndex] = useState<number | null>(null);
  const tooltipHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTooltipHideTimeout = () => {
    if (tooltipHideTimeoutRef.current) {
      clearTimeout(tooltipHideTimeoutRef.current);
      tooltipHideTimeoutRef.current = null;
    }
  };
  useEffect(() => () => clearTooltipHideTimeout(), []);

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
        const sampleImageUrls = Array.isArray(data.calibrationGazeSamples)
          ? (data.calibrationGazeSamples as CalibrationSample[])
              .map((s) => s.imageUrl)
              .filter((u): u is string => Boolean(u))
          : [];
        const urlsToSign = [
          ...(data.videoUrl ? [data.videoUrl] : []),
          ...(sampleImageUrls.length > 0 ? sampleImageUrls : imageUrls),
        ];
        if (urlsToSign.length > 0) {
          const signed = await Promise.all(urlsToSign.map((u) => getSignedUrl(u)));
          if (cancelled) return;
          const videoCount = data.videoUrl ? 1 : 0;
          if (data.videoUrl) setSignedVideoUrl(signed[0] ?? null);
          if (sampleImageUrls.length > 0) {
            setSignedSampleUrls(signed.slice(videoCount).map((u) => u ?? ''));
            setSignedImageUrls([]);
          } else {
            setSignedImageUrls(signed.slice(videoCount).map((u) => u ?? ''));
            setSignedSampleUrls([]);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id]);

  const imageUrls = isNewFormat
    ? samples.map((s) => s.imageUrl ?? '').filter(Boolean)
    : imageUrlsForCompat;

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

  const demographics = session.demographics ?? (session.config && typeof session.config === 'object' ? (session.config as Record<string, unknown>).demographics as { age?: number; gender?: string; country?: string; eyeConditions?: string[] } | undefined : undefined);

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
            <dd className="text-sm text-slate-200 mt-0.5">
              {isNewFormat ? samples.filter((s) => s.imageUrl).length : imageUrls.length}
            </dd>
          </div>
        </dl>
      </div>

      {/* Demographics */}
      {demographics && (
        <div className="rounded-xl bg-slate-800/60 border border-slate-700/80 p-5 shadow-xl">
          <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-4">
            Demographics
          </h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {demographics.age != null && (
              <div>
                <dt className="text-xs text-slate-500 uppercase">Age</dt>
                <dd className="text-sm text-slate-200 mt-0.5">{demographics.age}</dd>
              </div>
            )}
            {demographics.gender != null && demographics.gender !== '' && (
              <div>
                <dt className="text-xs text-slate-500 uppercase">Gender</dt>
                <dd className="text-sm text-slate-200 mt-0.5">{demographics.gender}</dd>
              </div>
            )}
            {demographics.country != null && demographics.country !== '' && (
              <div>
                <dt className="text-xs text-slate-500 uppercase">Country</dt>
                <dd className="text-sm text-slate-200 mt-0.5">{demographics.country}</dd>
              </div>
            )}
            {Array.isArray(demographics.eyeConditions) && demographics.eyeConditions.length > 0 && (
              <div className="sm:col-span-2">
                <dt className="text-xs text-slate-500 uppercase">Eye conditions</dt>
                <dd className="text-sm text-slate-200 mt-0.5">
                  {demographics.eyeConditions.filter((c) => c !== 'none').join(', ') || 'None'}
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}

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

      {/* Calibration images / per-sample */}
      <div className="rounded-xl bg-slate-800/60 border border-slate-700/80 p-5 shadow-xl">
        <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-4">
          {isNewFormat ? 'Calibration samples' : 'Calibration images'}
        </h2>
        {isNewFormat && samples.length > 0 ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {visibleSamples.map((s, i) => (
                <CalibrationSampleCard
                  key={i}
                  sample={s}
                  index={i}
                  signedUrl={signedSampleUrls[i] || s.imageUrl || ''}
                  showTooltip={activeTooltipIndex === i}
                  onMouseEnterCard={() => {
                    clearTooltipHideTimeout();
                    setActiveTooltipIndex(i);
                  }}
                  onMouseLeaveCard={() => {
                    clearTooltipHideTimeout();
                    tooltipHideTimeoutRef.current = setTimeout(() => setActiveTooltipIndex(null), 200);
                  }}
                  onMouseEnterTooltip={() => {
                    clearTooltipHideTimeout();
                    setActiveTooltipIndex(i);
                  }}
                  onMouseLeaveTooltip={() => setActiveTooltipIndex(null)}
                  onViewDetail={() => setSelectedSampleIndex(i)}
                />
              ))}
            </div>
            {hasMoreSamples && (
              <div className="mt-4 flex justify-center">
                <button
                  type="button"
                  onClick={() => setVisibleSampleCount((c) => Math.min(c + 10, samples.length))}
                  className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium transition"
                >
                  Load more ({samples.length - visibleSampleCount} remaining)
                </button>
              </div>
            )}
          </>
        ) : imageUrls.length > 0 ? (
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

      {selectedSampleIndex != null && visibleSamples[selectedSampleIndex] && (
        <SampleDetailModal
          sample={visibleSamples[selectedSampleIndex]}
          index={selectedSampleIndex}
          signedUrl={signedSampleUrls[selectedSampleIndex] || visibleSamples[selectedSampleIndex].imageUrl || ''}
          onClose={() => setSelectedSampleIndex(null)}
        />
      )}
    </div>
  );
}
