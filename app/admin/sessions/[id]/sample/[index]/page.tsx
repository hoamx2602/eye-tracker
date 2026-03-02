'use client';

import { useState, useRef, useEffect } from 'react';
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
  calibrationGazeSamples?: CalibrationSample[] | null;
  calibrationImageUrls?: unknown;
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

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function EyeSchematicSingle({
  label,
  eyeX,
  eyeY,
  R,
  θ,
}: {
  label: string;
  eyeX: number;
  eyeY: number;
  R: number;
  θ: number;
}) {
  const [arcHover, setArcHover] = useState(false);
  const [rHover, setRHover] = useState(false);
  const [irisHover, setIrisHover] = useState(false);
  const [pupilHover, setPupilHover] = useState(false);
  const scale = 18;
  const cx = 50;
  const cy = 50;
  const px = cx + eyeX * scale;
  const py = cy - eyeY * scale;
  const arcR = 14;
  const angleDeg = (θ * 180) / Math.PI;
  const arcEndX = cx + arcR * Math.cos(θ);
  const arcEndY = cy - arcR * Math.sin(θ);
  const midAngle = θ / 2;
  const wedgePath = `M ${cx} ${cy} L ${cx + arcR} ${cy} A ${arcR} ${arcR} 0 0 ${θ > 0 ? 0 : 1} ${arcEndX} ${arcEndY} Z`;

  const calloutColor = '#22c55e';

  // --- R callout: leader-line-with-shelf (technical drawing style) ---
  // Dot anchors ON the radius midpoint, leader goes perpendicular outward
  const rTargetX = (cx + px) / 2;
  const rTargetY = (cy + py) / 2;
  const rLen = Math.hypot(px - cx, py - cy);
  const rUx = rLen > 0 ? (px - cx) / rLen : 0;
  const rUy = rLen > 0 ? (py - cy) / rLen : -1;
  const perpAx = -rUy;
  const perpAy = rUx;
  const dA = Math.hypot(rTargetX + perpAx * 10 - px, rTargetY + perpAy * 10 - py);
  const dB = Math.hypot(rTargetX - perpAx * 10 - px, rTargetY - perpAy * 10 - py);
  const rPerpX = dA >= dB ? perpAx : -perpAx;
  const rPerpY = dA >= dB ? perpAy : -perpAy;
  const rLeaderEndX = rTargetX + rPerpX * 20;
  const rLeaderEndY = rTargetY + rPerpY * 20;
  const rShelfDir = rLeaderEndX >= cx ? 1 : -1;
  const rShelfEndX = rLeaderEndX + rShelfDir * 14;
  const rShelfEndY = rLeaderEndY;
  const rTextAnchor = rShelfDir > 0 ? 'start' : 'end';
  const rTextX = rShelfEndX + rShelfDir * 2;

  // --- θ callout: dot anchors ON the arc, leader goes radially outward ---
  const thetaTargetX = cx + arcR * Math.cos(midAngle);
  const thetaTargetY = cy - arcR * Math.sin(midAngle);
  const thetaDirX = Math.cos(midAngle);
  const thetaDirY = -Math.sin(midAngle);
  const thetaLeaderEndX = thetaTargetX + thetaDirX * 24;
  const thetaLeaderEndY = thetaTargetY + thetaDirY * 24;
  const thetaShelfDir = thetaLeaderEndX >= cx ? 1 : -1;
  const thetaShelfEndX = thetaLeaderEndX + thetaShelfDir * 14;
  const thetaShelfEndY = thetaLeaderEndY;
  const thetaTextAnchor = thetaShelfDir > 0 ? 'start' : 'end';
  const thetaTextX = thetaShelfEndX + thetaShelfDir * 2;

  // --- Iris (ellipse) callout: dot on right edge of ellipse, leader goes right ---
  const irisTargetX = cx + 40;
  const irisTargetY = cy;
  const irisLeaderEndX = irisTargetX + 16;
  const irisLeaderEndY = irisTargetY - 12;
  const irisShelfEndX = irisLeaderEndX + 14;
  const irisShelfEndY = irisLeaderEndY;

  // --- Pupil hover: reference lines to axes ---
  // X value on axis: place text on opposite side from pupil
  const xProjY = py > cy ? cy - 5 : cy + 6;
  const xProjBaseline = py > cy ? 'auto' : 'hanging';
  // Y value on axis: place text on opposite side from pupil
  const yProjX = px > cx ? cx - 5 : cx + 5;
  const yProjAnchor = px > cx ? 'end' : 'start';
  // "Pupil" label: leader line going diagonally away from center, avoiding reference lines
  const pupilDirX = px >= cx ? 1 : -1;
  const pupilDirY = py >= cy ? 1 : -1;
  const pupilEdgeX = px + pupilDirX * 10;
  const pupilEdgeY = py + pupilDirY * 10;
  const pupilLeaderEndX = pupilEdgeX + pupilDirX * 14;
  const pupilLeaderEndY = pupilEdgeY + pupilDirY * 14;
  const pupilShelfDir = pupilDirX;
  const pupilShelfEndX = pupilLeaderEndX + pupilShelfDir * 14;
  const pupilShelfEndY = pupilLeaderEndY;
  const pupilTextAnchor: string = pupilShelfDir > 0 ? 'start' : 'end';
  const pupilTextX = pupilShelfEndX + pupilShelfDir * 2;

  return (
    <div className="flex flex-col items-center">
      <span className="text-sm text-slate-400 mb-3 font-medium">{label}</span>
      <svg
        viewBox="-10 -10 120 120"
        className="w-56 h-56 sm:w-64 sm:h-64 text-slate-600"
        style={{ overflow: 'visible' }}
        aria-hidden
      >
        {/* Full axis lines (faint) */}
        <line x1="5" y1={cy} x2="95" y2={cy} stroke="currentColor" strokeWidth="0.8" opacity="0.3" strokeDasharray="3 2" />
        <line x1={cx} y1="5" x2={cx} y2="95" stroke="currentColor" strokeWidth="0.8" opacity="0.3" strokeDasharray="3 2" />
        {/* Eye boundary (iris) — hoverable */}
        <g
          onMouseEnter={() => setIrisHover(true)}
          onMouseLeave={() => setIrisHover(false)}
          style={{ cursor: 'pointer' }}
        >
          <ellipse cx={cx} cy={cy} rx="40" ry="26" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-slate-500" />
          <ellipse cx={cx} cy={cy} rx="40" ry="26" fill="none" stroke="transparent" strokeWidth="6" />
        </g>
        {/* R vector — hoverable */}
        <g
          onMouseEnter={() => setRHover(true)}
          onMouseLeave={() => setRHover(false)}
          style={{ cursor: 'pointer' }}
        >
          <line x1={cx} y1={cy} x2={px} y2={py} stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" />
          <line x1={cx} y1={cy} x2={px} y2={py} stroke="transparent" strokeWidth="12" strokeLinecap="round" />
        </g>
        {/* Wedge (angle region) — hover fill */}
        <path
          d={wedgePath}
          fill={arcHover ? 'rgba(34, 211, 238, 0.38)' : 'transparent'}
          stroke={arcHover ? 'rgba(34, 211, 238, 0.5)' : 'none'}
          strokeWidth="0.8"
          style={{ cursor: 'pointer', transition: 'fill 0.2s, stroke 0.2s' }}
          onMouseEnter={() => setArcHover(true)}
          onMouseLeave={() => setArcHover(false)}
        />
        {/* Arc for θ */}
        <path
          d={`M ${cx + arcR} ${cy} A ${arcR} ${arcR} 0 0 ${θ > 0 ? 0 : 1} ${arcEndX} ${arcEndY}`}
          fill="none"
          stroke={arcHover ? '#22d3ee' : '#64748b'}
          strokeWidth={arcHover ? 2.5 : 1}
          strokeDasharray="2 2"
          style={{ cursor: 'pointer', transition: 'stroke 0.15s, stroke-width 0.15s' }}
          onMouseEnter={() => setArcHover(true)}
          onMouseLeave={() => setArcHover(false)}
        />
        {/* Wider invisible hit area for wedge/arc */}
        <path
          d={wedgePath}
          fill="transparent"
          stroke="transparent"
          strokeWidth="8"
          style={{ cursor: 'pointer' }}
          onMouseEnter={() => setArcHover(true)}
          onMouseLeave={() => setArcHover(false)}
        />
        {/* Pupil — hoverable for reference lines */}
        <g
          onMouseEnter={() => setPupilHover(true)}
          onMouseLeave={() => setPupilHover(false)}
          style={{ cursor: 'pointer' }}
        >
          <circle cx={px} cy={py} r="10" fill="#38bdf8" stroke="#0ea5e9" strokeWidth="1.5" />
        </g>
        {/* Axis labels */}
        <text x={cx + 44} y={cy + 5} fontSize="6" fill="#64748b" fontWeight="500">X</text>
        <text x={cx - 4} y={cy - 30} fontSize="6" fill="#64748b" fontWeight="500">Y</text>

        {/* θ callout: dot on arc → leader → horizontal shelf → text */}
        {arcHover && (
          <g>
            <circle cx={thetaTargetX} cy={thetaTargetY} r="2.5" fill={calloutColor} />
            <line x1={thetaTargetX} y1={thetaTargetY} x2={thetaLeaderEndX} y2={thetaLeaderEndY} stroke={calloutColor} strokeWidth="1" />
            <line x1={thetaLeaderEndX} y1={thetaLeaderEndY} x2={thetaShelfEndX} y2={thetaShelfEndY} stroke={calloutColor} strokeWidth="1" />
            <text x={thetaTextX} y={thetaShelfEndY} fontSize="7" fill={calloutColor} fontFamily="monospace" textAnchor={thetaTextAnchor} dominantBaseline="middle">
              θ = {angleDeg.toFixed(1)}°
            </text>
          </g>
        )}
        {/* R callout: dot on radius → leader (perpendicular) → horizontal shelf → text */}
        {rHover && (
          <g>
            <circle cx={rTargetX} cy={rTargetY} r="2.5" fill={calloutColor} />
            <line x1={rTargetX} y1={rTargetY} x2={rLeaderEndX} y2={rLeaderEndY} stroke={calloutColor} strokeWidth="1" />
            <line x1={rLeaderEndX} y1={rLeaderEndY} x2={rShelfEndX} y2={rShelfEndY} stroke={calloutColor} strokeWidth="1" />
            <text x={rTextX} y={rShelfEndY} fontSize="7" fill={calloutColor} fontFamily="monospace" textAnchor={rTextAnchor} dominantBaseline="middle">
              R = {R.toFixed(2)}
            </text>
          </g>
        )}
        {/* Iris callout: dot on ellipse → leader → shelf → text */}
        {irisHover && (
          <g>
            <ellipse cx={cx} cy={cy} rx="40" ry="26" fill="none" stroke={calloutColor} strokeWidth="2" opacity="0.6" />
            <circle cx={irisTargetX} cy={irisTargetY} r="2.5" fill={calloutColor} />
            <line x1={irisTargetX} y1={irisTargetY} x2={irisLeaderEndX} y2={irisLeaderEndY} stroke={calloutColor} strokeWidth="1" />
            <line x1={irisLeaderEndX} y1={irisLeaderEndY} x2={irisShelfEndX} y2={irisShelfEndY} stroke={calloutColor} strokeWidth="1" />
            <text x={irisShelfEndX + 2} y={irisShelfEndY} fontSize="7" fill={calloutColor} fontFamily="monospace" textAnchor="start" dominantBaseline="middle">
              Iris
            </text>
          </g>
        )}
        {/* Pupil hover: reference lines to axes + coordinates + label */}
        {pupilHover && (
          <g>
            {/* Vertical dashed line: pupil → X axis */}
            <line x1={px} y1={py} x2={px} y2={cy} stroke="#f59e0b" strokeWidth="0.8" strokeDasharray="3 2" opacity="0.6" />
            <circle cx={px} cy={cy} r="1.5" fill="#f59e0b" />
            <text x={px} y={xProjY} fontSize="5" fill="#f59e0b" fontFamily="monospace" textAnchor="middle" dominantBaseline={xProjBaseline}>
              {eyeX.toFixed(2)}
            </text>
            {/* Horizontal dashed line: pupil → Y axis */}
            <line x1={px} y1={py} x2={cx} y2={py} stroke="#f59e0b" strokeWidth="0.8" strokeDasharray="3 2" opacity="0.6" />
            <circle cx={cx} cy={py} r="1.5" fill="#f59e0b" />
            <text x={yProjX} y={py} fontSize="5" fill="#f59e0b" fontFamily="monospace" textAnchor={yProjAnchor} dominantBaseline="middle">
              {eyeY.toFixed(2)}
            </text>
            {/* "Pupil" leader line callout (diagonal, away from reference lines) */}
            <circle cx={pupilEdgeX} cy={pupilEdgeY} r="2.5" fill={calloutColor} />
            <line x1={pupilEdgeX} y1={pupilEdgeY} x2={pupilLeaderEndX} y2={pupilLeaderEndY} stroke={calloutColor} strokeWidth="1" />
            <line x1={pupilLeaderEndX} y1={pupilLeaderEndY} x2={pupilShelfEndX} y2={pupilShelfEndY} stroke={calloutColor} strokeWidth="1" />
            <text x={pupilTextX} y={pupilShelfEndY} fontSize="7" fill={calloutColor} fontFamily="monospace" textAnchor={pupilTextAnchor} dominantBaseline="middle">
              Pupil
            </text>
          </g>
        )}
      </svg>
      {/* X, Y values — compact readout */}
      <div className="mt-4 grid grid-cols-2 gap-3 w-full max-w-xs">
        <div className="rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-center">
          <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-0.5">X</div>
          <div className="text-sm font-mono font-bold text-sky-400 tabular-nums">{eyeX.toFixed(4)}</div>
        </div>
        <div className="rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-center">
          <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-0.5">Y</div>
          <div className="text-sm font-mono font-bold text-sky-400 tabular-nums">{eyeY.toFixed(4)}</div>
        </div>
        <div className="rounded-lg bg-slate-800/80 border border-slate-600 px-3 py-1.5 text-center col-span-2">
          <span className="text-[10px] text-slate-500">R = {R.toFixed(4)}</span>
          <span className="text-slate-400 mx-2">·</span>
          <span className="text-[10px] text-slate-500">θ = {θ.toFixed(4)} rad ({angleDeg.toFixed(1)}°)</span>
        </div>
      </div>
    </div>
  );
}

export default function AdminSessionSampleDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const indexParam = params?.index as string;
  const index = Math.max(0, parseInt(indexParam || '0', 10));

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

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

        const samples = Array.isArray(data.calibrationGazeSamples) ? data.calibrationGazeSamples : [];
        const sample = samples[index];
        const imgUrl = sample?.imageUrl;
        if (imgUrl && typeof imgUrl === 'string') {
          const url = await getSignedUrl(imgUrl);
          if (!cancelled) setSignedUrl(url ?? null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id, index]);

  if (loading || !session) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 p-6">
        <p className="text-slate-400">Loading…</p>
      </div>
    );
  }

  const samples = Array.isArray(session.calibrationGazeSamples) ? session.calibrationGazeSamples : [];
  const sample = samples[index];
  if (notFound || !sample) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 p-6">
        <div className="rounded-xl bg-slate-800/60 border border-slate-700 p-6 text-center">
          <h2 className="text-lg font-semibold text-white">Sample not found</h2>
          <Link href={`/admin/sessions/${id}`} className="inline-block mt-4 text-blue-400 hover:text-blue-300">← Back to session</Link>
        </div>
      </div>
    );
  }

  const features = sample.features ?? [];
  const head = sample.head;
  const hasFeatures = features.length >= FEATURE_DIMENSION_NAMES.length;
  const pitchDeg = hasFeatures && features[9] != null ? radToDeg(features[9]) : 0;
  const yawDeg = hasFeatures && features[10] != null ? radToDeg(features[10]) : 0;
  const rollDeg = hasFeatures && features[11] != null ? radToDeg(features[11]) : 0;

  const totalSamples = samples.length;
  const prevIndex = index > 0 ? index - 1 : null;
  const nextIndex = index < totalSamples - 1 ? index + 1 : null;

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

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 overflow-y-auto">
      <main className="max-w-5xl mx-auto px-4 py-6 space-y-8">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-slate-400 flex-wrap">
          <Link href="/admin" className="hover:text-white transition">Admin</Link>
          <span>/</span>
          <Link href="/admin/sessions" className="hover:text-white transition">Sessions</Link>
          <span>/</span>
          <Link href={`/admin/sessions/${id}`} className="hover:text-white transition">Session</Link>
          <span>/</span>
          <span className="text-slate-200 font-medium">Sample #{index + 1}</span>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-white">Sample #{index + 1}</h1>
          <div className="flex items-center gap-2">
            {prevIndex !== null && (
              <Link
                href={`/admin/sessions/${id}/sample/${prevIndex}`}
                className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium transition"
              >
                ← Previous
              </Link>
            )}
            <span className="text-slate-500 text-sm">{(index + 1).toLocaleString()} of {totalSamples.toLocaleString()}</span>
            {nextIndex !== null && (
              <Link
                href={`/admin/sessions/${id}/sample/${nextIndex}`}
                className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium transition"
              >
                Next →
              </Link>
            )}
            <Link
              href={`/admin/sessions/${id}`}
              className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium transition"
            >
              Back to session
            </Link>
          </div>
        </div>

        {/* Image + meta */}
        <div className="rounded-xl bg-slate-800/60 border border-slate-700 p-5 shadow-xl">
          <div className="flex flex-col lg:flex-row gap-6">
            <div className="flex-shrink-0">
              {sample.imageUrl ? (
                <div className="rounded-lg overflow-hidden border border-slate-600 bg-slate-900 max-w-md">
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
                      src={signedUrl || sample.imageUrl}
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
                    <a href={signedUrl || sample.imageUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300">Open in new tab</a>
                  </div>
                </div>
              ) : (
                <div className="w-72 aspect-video rounded-lg bg-slate-700 flex items-center justify-center text-slate-500">No image</div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                {sample.patternName && <><dt className="text-slate-500">Pattern</dt><dd className="text-slate-200 font-medium">{sample.patternName}</dd></>}
                <dt className="text-slate-500">screenX</dt><dd className="font-mono text-slate-200">{sample.screenX != null ? sample.screenX : '—'}</dd>
                <dt className="text-slate-500">screenY</dt><dd className="font-mono text-slate-200">{sample.screenY != null ? sample.screenY : '—'}</dd>
                {sample.timestamp != null && <><dt className="text-slate-500">timestamp</dt><dd className="font-mono text-slate-200">{sample.timestamp}</dd></>}
                {head && (
                  <>
                    <dt className="text-slate-500">Head</dt><dd className={head.valid ? 'text-green-400' : 'text-amber-400'}>{head.valid ? 'OK' : head.message}</dd>
                    {head.faceWidth != null && <><dt className="text-slate-500">faceWidth</dt><dd className="font-mono text-slate-200">{head.faceWidth.toFixed(4)}</dd></>}
                  </>
                )}
              </dl>
            </div>
          </div>
        </div>

        {/* Eye schematic — large, with axis lines and arc hover */}
        {hasFeatures && (
          <div className="rounded-xl bg-slate-800/60 border border-slate-700 p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-white mb-2">Eye schematic</h2>
            <p className="text-sm text-slate-500 mb-6">Pupil position (X, Y), distance R and angle θ. Hover over the arc or angle region to highlight.</p>
            <div className="flex flex-wrap justify-center gap-12 sm:gap-16">
              <EyeSchematicSingle
                label="Left eye"
                eyeX={(features[1] ?? 0) as number}
                eyeY={(features[2] ?? 0) as number}
                R={(features[5] ?? 0) as number}
                θ={(features[6] ?? 0) as number}
              />
              <EyeSchematicSingle
                label="Right eye"
                eyeX={(features[3] ?? 0) as number}
                eyeY={(features[4] ?? 0) as number}
                R={(features[7] ?? 0) as number}
                θ={(features[8] ?? 0) as number}
              />
            </div>
          </div>
        )}

        {/* Head pose */}
        {hasFeatures && (
          <div className="rounded-xl bg-slate-800/60 border border-slate-700 p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-white mb-2">Head pose</h2>
            <div className="flex flex-wrap items-center justify-center gap-8">
              <svg viewBox="0 0 100 100" className="w-32 h-32" aria-hidden style={{ transform: `rotate(${rollDeg}deg)` }}>
                <circle cx="50" cy="50" r="42" fill="none" stroke="#475569" strokeWidth="2" />
                <line
                  x1="50" y1="50"
                  x2={50 + 35 * Math.cos((yawDeg * Math.PI) / 180) * Math.cos((pitchDeg * Math.PI) / 180)}
                  y2={50 - 35 * Math.sin((pitchDeg * Math.PI) / 180)}
                  stroke="#22d3ee" strokeWidth="3" strokeLinecap="round"
                />
                <ellipse cx="38" cy="42" rx="6" ry="4" fill="none" stroke="#64748b" strokeWidth="1" />
                <ellipse cx="62" cy="42" rx="6" ry="4" fill="none" stroke="#64748b" strokeWidth="1" />
                <text x="50" y="92" fontSize="9" fill="#64748b" textAnchor="middle">roll {rollDeg.toFixed(0)}°</text>
              </svg>
              <div className="flex flex-col gap-3 text-sm">
                <div className="flex items-center gap-3">
                  <span className="text-slate-500 w-20">Pitch</span>
                  <div className="w-28 h-2.5 rounded-full bg-slate-700 relative">
                    <div className="absolute inset-y-0 left-1/2 w-0.5 bg-slate-500" style={{ transform: 'translateX(-50%)' }} />
                    <div className="absolute top-0 bottom-0 w-2 bg-cyan-400 rounded-full -ml-1" style={{ left: `${50 + Math.max(-45, Math.min(45, pitchDeg))}%`, transform: 'translateX(-50%)' }} />
                  </div>
                  <span className="font-mono text-slate-200 w-14">{pitchDeg.toFixed(1)}°</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-slate-500 w-20">Yaw</span>
                  <div className="w-28 h-2.5 rounded-full bg-slate-700 relative">
                    <div className="absolute inset-y-0 left-1/2 w-0.5 bg-slate-500" style={{ transform: 'translateX(-50%)' }} />
                    <div className="absolute top-0 bottom-0 w-2 bg-cyan-400 rounded-full -ml-1" style={{ left: `${50 + Math.max(-45, Math.min(45, yawDeg))}%`, transform: 'translateX(-50%)' }} />
                  </div>
                  <span className="font-mono text-slate-200 w-14">{yawDeg.toFixed(1)}°</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-slate-500 w-20">Roll</span>
                  <span className="font-mono text-slate-200">Face tilted {rollDeg.toFixed(1)}°</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Face distance */}
        {head && (head.faceWidth != null || head.minFaceWidth != null || head.maxFaceWidth != null) && (
          <div className="rounded-xl bg-slate-800/60 border border-slate-700 p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-white mb-2">Face distance</h2>
            <div className="flex items-center gap-4">
              <div className="flex-1 h-10 rounded-full bg-slate-700 relative overflow-hidden">
                {head.minFaceWidth != null && head.maxFaceWidth != null && (
                  <div className="absolute inset-y-0 bg-green-900/40" style={{ left: `${Math.min(100, (head.minFaceWidth / 0.2) * 100)}%`, width: `${Math.max(0, ((head.maxFaceWidth - head.minFaceWidth) / 0.2) * 100)}%` }} />
                )}
                {head.faceWidth != null && (
                  <div className="absolute top-1/2 -translate-y-1/2 w-4 h-8 -ml-2 rounded bg-sky-400 border border-white shadow" style={{ left: `${Math.min(90, (head.faceWidth / 0.2) * 100)}%` }} />
                )}
              </div>
              <div className="text-sm text-slate-400 min-w-[140px]">
                {head.faceWidth != null && <span className="font-mono text-slate-200">{head.faceWidth.toFixed(3)}</span>}
                {head.minFaceWidth != null && head.maxFaceWidth != null && <span className="text-slate-500"> (min–max)</span>}
              </div>
            </div>
          </div>
        )}

        {/* All 18 values */}
        {hasFeatures && (
          <details className="rounded-xl bg-slate-800/60 border border-slate-700 overflow-hidden group">
            <summary className="p-4 cursor-pointer text-sm font-medium text-slate-400 uppercase tracking-wider list-none flex items-center justify-between hover:bg-slate-800/80">
              <span>All 18 raw feature values</span>
              <span className="text-slate-500 group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <div className="px-4 pb-4 pt-0">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {FEATURE_DIMENSION_NAMES.map((name, i) => (
                  <div key={i} className="flex flex-col rounded bg-slate-800/80 px-3 py-2 border border-slate-600/50">
                    <span className="text-xs text-slate-500 truncate" title={name}>{name}</span>
                    <span className="font-mono text-sm text-slate-200 tabular-nums">{typeof features[i] === 'number' ? (features[i] as number).toFixed(4) : '—'}</span>
                  </div>
                ))}
              </div>
            </div>
          </details>
        )}
      </main>
    </div>
  );
}
