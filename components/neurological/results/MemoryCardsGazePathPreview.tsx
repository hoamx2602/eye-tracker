'use client';

import React, { useMemo } from 'react';
import { ResultVizAspectSvg, ResultVizMaxFrame } from './resultVizLayout';

type Props = {
  gazePath: Array<{ t: number; x: number; y: number }>;
  viewportWidth?: number;
  viewportHeight?: number;
  visualOnly?: boolean;
};

export function MemoryCardsParamsSection({ sampleCount }: { sampleCount: number }) {
  return (
    <p className="text-xs text-slate-400 leading-relaxed">
      <span className="text-slate-500">Samples:</span>{' '}
      <span className="font-mono text-slate-200">{sampleCount}</span>
      <br />
      <span className="text-slate-500">Path</span> = gaze trace; <span className="text-slate-500">dot</span> = last point.
    </p>
  );
}

/**
 * Renders gaze path in screen coordinates (same space as during the test).
 */
export default function MemoryCardsGazePathPreview({
  gazePath,
  viewportWidth: _viewportWidth,
  viewportHeight: _viewportHeight,
  visualOnly,
}: Props) {
  const layout = useMemo(() => {
    if (gazePath.length === 0) return null;
    const pad = 24;
    const endR = 8;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of gazePath) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const last = gazePath[gazePath.length - 1];
    minX = Math.min(minX, last.x - endR);
    maxX = Math.max(maxX, last.x + endR);
    minY = Math.min(minY, last.y - endR);
    maxY = Math.max(maxY, last.y + endR);

    const vx0 = minX - pad;
    const vy0 = minY - pad;
    const vw = Math.max(maxX - minX + pad * 2, 120);
    const vh = Math.max(maxY - minY + pad * 2, 120);
    const toLocal = (x: number, y: number) => ({ x: x - vx0, y: y - vy0 });
    const polyline = gazePath.map((p) => `${toLocal(p.x, p.y).x},${toLocal(p.x, p.y).y}`).join(' ');
    const endPt = gazePath[gazePath.length - 1];
    const end = toLocal(endPt.x, endPt.y);
    return { vw, vh, polyline, end, sampleCount: gazePath.length };
  }, [gazePath]);

  if (!layout) {
    return <p className="text-slate-500 text-sm">No gaze path samples.</p>;
  }

  const chart = (
    <ResultVizMaxFrame>
      <ResultVizAspectSvg
        contentWidth={layout.vw}
        contentHeight={layout.vh}
        panelFill="rgb(15 23 42 / 0.4)"
        role="img"
        aria-label="Gaze path during memory cards"
      >
        <polyline
          fill="none"
          stroke="rgb(96 165 250)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={0.95}
          points={layout.polyline}
        />
        <circle cx={layout.end.x} cy={layout.end.y} r={6} fill="rgb(251 191 36)" stroke="rgb(15 23 42)" strokeWidth={1} />
      </ResultVizAspectSvg>
    </ResultVizMaxFrame>
  );

  if (visualOnly) {
    return chart;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {chart}
      <p className="shrink-0 text-xs text-slate-500">
        {layout.sampleCount} samples · path = gaze trace · dot = last point
      </p>
    </div>
  );
}
