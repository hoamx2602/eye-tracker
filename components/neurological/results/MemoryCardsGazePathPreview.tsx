'use client';

import React, { useMemo } from 'react';

type Props = {
  gazePath: Array<{ t: number; x: number; y: number }>;
  viewportWidth?: number;
  viewportHeight?: number;
};

/**
 * Renders gaze path in screen coordinates (same space as during the test).
 */
export default function MemoryCardsGazePathPreview({ gazePath, viewportWidth, viewportHeight }: Props) {
  const layout = useMemo(() => {
    if (gazePath.length === 0) return null;
    const pad = 20;
    let vx0: number;
    let vy0: number;
    let vw: number;
    let vh: number;
    if (viewportWidth && viewportHeight) {
      vx0 = 0;
      vy0 = 0;
      vw = viewportWidth;
      vh = viewportHeight;
    } else {
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
      vx0 = minX - pad;
      vy0 = minY - pad;
      vw = Math.max(maxX - minX + pad * 2, 320);
      vh = Math.max(maxY - minY + pad * 2, 240);
    }
    const toLocal = (x: number, y: number) => ({ x: x - vx0, y: y - vy0 });
    const polyline = gazePath.map((p) => `${toLocal(p.x, p.y).x},${toLocal(p.x, p.y).y}`).join(' ');
    const last = gazePath[gazePath.length - 1];
    const end = toLocal(last.x, last.y);
    return { viewBox: `0 0 ${vw} ${vh}`, vw, vh, polyline, end, sampleCount: gazePath.length };
  }, [gazePath, viewportWidth, viewportHeight]);

  if (!layout) {
    return <p className="text-slate-500 text-sm">No gaze path samples.</p>;
  }

  return (
    <div className="w-full overflow-hidden rounded-xl border border-gray-800 bg-gray-900/50">
      <svg
        className="h-64 w-full"
        viewBox={layout.viewBox}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Gaze path during memory cards"
      >
        <rect x={0} y={0} width={layout.vw} height={layout.vh} fill="rgb(15 23 42 / 0.4)" />
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
      </svg>
      <p className="px-3 py-2 text-xs text-slate-500">
        {layout.sampleCount} samples · path = gaze trace · dot = last point
      </p>
    </div>
  );
}
