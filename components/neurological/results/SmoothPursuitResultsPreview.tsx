'use client';

import React from 'react';
import type { PursuitAnalysis } from '@/lib/oculomotorMetrics';

type Sample = { t: number; x: number; y: number; targetX: number };

export interface SmoothPursuitResultsPreviewProps {
  gazeSamples?: Sample[];
  metrics?: Partial<PursuitAnalysis>;
  viewportWidth?: number;
  visualOnly?: boolean;
}

const W = 640;
const H = 220;
const PAD = 28;

/**
 * Target and gaze horizontal position over time. The line is the 10 Hz
 * smoothed preview stream; the metrics beside it come from every camera frame.
 */
export default function SmoothPursuitResultsPreview({
  gazeSamples = [],
  metrics,
  viewportWidth,
  visualOnly = false,
}: SmoothPursuitResultsPreviewProps) {
  const pts = gazeSamples.filter((s) => s.x !== 0 || s.y !== 0);
  const tMax = Math.max(1, ...gazeSamples.map((s) => s.t));
  const vw = viewportWidth ?? Math.max(1, ...gazeSamples.map((s) => Math.max(s.x, s.targetX)));
  const sx = (t: number) => PAD + (t / tMax) * (W - 2 * PAD);
  const sy = (x: number) => H - PAD - (Math.max(0, Math.min(vw, x)) / vw) * (H - 2 * PAD);
  const path = (xs: { t: number; v: number }[]) =>
    xs.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.t).toFixed(1)},${sy(p.v).toFixed(1)}`).join(' ');

  const fmt = (v: number | null | undefined, d = 2, unit = '') =>
    typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(d)}${unit}` : 'N/A';

  return (
    <div className="flex flex-col gap-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto rounded-lg bg-gray-900" role="img" aria-label="Target and gaze horizontal position over time">
        <line x1={PAD} x2={W - PAD} y1={sy(vw / 2)} y2={sy(vw / 2)} stroke="#334155" strokeDasharray="4 4" />
        <path d={path(gazeSamples.map((s) => ({ t: s.t, v: s.targetX })))} fill="none" stroke="#f59e0b" strokeWidth={2} />
        <path d={path(pts.map((s) => ({ t: s.t, v: s.x })))} fill="none" stroke="#38bdf8" strokeWidth={1.5} />
        <text x={PAD} y={16} fill="#f59e0b" fontSize={11}>target</text>
        <text x={PAD + 50} y={16} fill="#38bdf8" fontSize={11}>gaze (x)</text>
        <text x={W - PAD} y={H - 8} fill="#64748b" fontSize={10} textAnchor="end">{tMax.toFixed(1)} s</text>
      </svg>
      {!visualOnly && metrics && (
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
          <div><dt className="text-slate-400">Follow (r²)</dt><dd className="font-mono text-slate-200">{fmt(metrics.r2)}</dd></div>
          <div><dt className="text-slate-400">Gain</dt><dd className="font-mono text-slate-200">{fmt(metrics.gain)}</dd></div>
          <div><dt className="text-slate-400">Lag</dt><dd className="font-mono text-slate-200">{fmt(metrics.phaseLagMs, 0, ' ms')}</dd></div>
          <div><dt className="text-slate-400">Catch-up saccades</dt><dd className="font-mono text-slate-200">{fmt(metrics.saccadesPerSec, 2, ' /s')}</dd></div>
          <div><dt className="text-slate-400">Residual RMS</dt><dd className="font-mono text-slate-200">{fmt(metrics.residualRmsPx, 0, ' px')}</dd></div>
          <div><dt className="text-slate-400">Usable frames</dt><dd className="font-mono text-slate-200">{typeof metrics.validFraction === 'number' ? `${Math.round(metrics.validFraction * 100)}%` : 'N/A'}</dd></div>
        </dl>
      )}
    </div>
  );
}
