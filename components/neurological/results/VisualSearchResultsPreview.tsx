'use client';

import React, { useMemo } from 'react';

type NumberPos = { number: number; x: number; y: number };
type PathPt = { t: number; x: number; y: number };

type Props = {
  completionTimeMs: number;
  numberPositions: NumberPos[];
  scanningPath: PathPt[];
  gazeFixationPerNumber: Record<number, number>;
  sequence: number[];
  viewportWidth?: number;
  viewportHeight?: number;
};

export default function VisualSearchResultsPreview({
  completionTimeMs,
  numberPositions,
  scanningPath,
  gazeFixationPerNumber,
  sequence,
  viewportWidth,
  viewportHeight,
}: Props) {
  const layout = useMemo(() => {
    const path = scanningPath ?? [];
    if (path.length === 0 && numberPositions.length === 0) return null;
    const pad = 24;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of path) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    for (const n of numberPositions) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x);
      maxY = Math.max(maxY, n.y);
    }
    let vx0 = 0;
    let vy0 = 0;
    let vw = viewportWidth ?? Math.max(maxX - minX + pad * 2, 320);
    let vh = viewportHeight ?? Math.max(maxY - minY + pad * 2, 240);
    if (viewportWidth && viewportHeight) {
      vx0 = 0;
      vy0 = 0;
      vw = viewportWidth;
      vh = viewportHeight;
    } else if (Number.isFinite(minX)) {
      vx0 = minX - pad;
      vy0 = minY - pad;
    }
    const loc = (x: number, y: number) => ({ x: x - vx0, y: y - vy0 });
    const poly = path.map((p) => {
      const q = loc(p.x, p.y);
      return `${q.x},${q.y}`;
    }).join(' ');
    return {
      viewBox: `0 0 ${vw} ${vh}`,
      vw,
      vh,
      poly,
      numbers: numberPositions.map((n) => ({ ...n, ...loc(n.x, n.y) })),
    };
  }, [scanningPath, numberPositions, viewportWidth, viewportHeight]);

  const fixationRows = useMemo(() => {
    const entries = Object.entries(gazeFixationPerNumber ?? {})
      .map(([k, v]) => ({ num: Number(k), count: v as number }))
      .sort((a, b) => a.num - b.num);
    return entries;
  }, [gazeFixationPerNumber]);

  if (!layout) {
    return <p className="text-slate-500 text-sm">No visual search data.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-4 text-sm text-slate-300">
        <span>
          Completion:{' '}
          <span className="font-mono text-sky-400">{(completionTimeMs / 1000).toFixed(2)} s</span>
        </span>
        <span>
          Order found:{' '}
          <span className="font-mono text-slate-200">{sequence?.length ? sequence.join(' → ') : '—'}</span>
        </span>
      </div>

      <div className="w-full overflow-hidden rounded-xl border border-gray-800 bg-gray-900/50">
        <svg
          className="h-64 w-full"
          viewBox={layout.viewBox}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Visual search gaze path and number positions"
        >
          <rect x={0} y={0} width={layout.vw} height={layout.vh} fill="rgb(15 23 42 / 0.4)" />
          <polyline
            fill="none"
            stroke="rgb(96 165 250)"
            strokeWidth="2"
            strokeLinejoin="round"
            points={layout.poly}
          />
          {layout.numbers.map((n) => (
            <g key={n.number}>
              <circle
                cx={n.x}
                cy={n.y}
                r={22}
                fill="rgb(30 41 59 / 0.85)"
                stroke="rgb(148 163 184)"
                strokeWidth="1"
              />
              <text
                x={n.x}
                y={n.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill="white"
                fontSize="14"
                fontWeight="bold"
              >
                {n.number}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {fixationRows.length > 0 && (
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2 text-xs">
          <span className="text-slate-500">Fixations per number: </span>
          <span className="font-mono text-slate-300">
            {fixationRows.map((r) => `${r.num}: ${r.count}`).join(' · ')}
          </span>
        </div>
      )}
    </div>
  );
}
