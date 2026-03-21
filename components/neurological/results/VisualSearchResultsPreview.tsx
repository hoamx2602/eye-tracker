'use client';

import React, { useMemo } from 'react';
import { ResultVizAspectSvg, ResultVizMaxFrame } from './resultVizLayout';

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
  visualOnly?: boolean;
};

export function VisualSearchParamsSection({
  completionTimeMs,
  sequence,
  gazeFixationPerNumber,
}: Pick<Props, 'completionTimeMs' | 'sequence' | 'gazeFixationPerNumber'>) {
  const fixationRows = useMemo(() => {
    const entries = Object.entries(gazeFixationPerNumber ?? {})
      .map(([k, v]) => ({ num: Number(k), count: v as number }))
      .sort((a, b) => a.num - b.num);
    return entries;
  }, [gazeFixationPerNumber]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 text-sm text-slate-300">
        <span>
          Completion:{' '}
          <span className="font-mono text-sky-400">{(completionTimeMs / 1000).toFixed(2)} s</span>
        </span>
        <span>
          Order found:{' '}
          <span className="font-mono text-slate-200">{sequence?.length ? sequence.join(' → ') : '—'}</span>
        </span>
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

export default function VisualSearchResultsPreview({
  completionTimeMs,
  numberPositions,
  scanningPath,
  gazeFixationPerNumber,
  sequence,
  viewportWidth: _viewportWidth,
  viewportHeight: _viewportHeight,
  visualOnly,
}: Props) {
  const layout = useMemo(() => {
    const path = scanningPath ?? [];
    if (path.length === 0 && numberPositions.length === 0) return null;
    const pad = 28;
    /** Bán kính vòng số trên canvas — phải tính vào bbox để không cắt label */
    const numberR = 24;
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
      minX = Math.min(minX, n.x - numberR);
      minY = Math.min(minY, n.y - numberR);
      maxX = Math.max(maxX, n.x + numberR);
      maxY = Math.max(maxY, n.y + numberR);
    }
    if (!Number.isFinite(minX)) return null;

    const vx0 = minX - pad;
    const vy0 = minY - pad;
    const vw = Math.max(maxX - minX + pad * 2, 120);
    const vh = Math.max(maxY - minY + pad * 2, 120);

    const loc = (x: number, y: number) => ({ x: x - vx0, y: y - vy0 });
    const poly = path.map((p) => {
      const q = loc(p.x, p.y);
      return `${q.x},${q.y}`;
    }).join(' ');
    return {
      vw,
      vh,
      poly,
      numbers: numberPositions.map((n) => ({ ...n, ...loc(n.x, n.y) })),
    };
  }, [scanningPath, numberPositions]);

  if (!layout) {
    return <p className="text-slate-500 text-sm">No visual search data.</p>;
  }

  const svgBlock = (
    <ResultVizMaxFrame>
      <ResultVizAspectSvg
        contentWidth={layout.vw}
        contentHeight={layout.vh}
        panelFill="rgb(15 23 42 / 0.4)"
        role="img"
        aria-label="Visual search gaze path and number positions"
      >
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
      </ResultVizAspectSvg>
    </ResultVizMaxFrame>
  );

  if (visualOnly) {
    return svgBlock;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <VisualSearchParamsSection
        completionTimeMs={completionTimeMs}
        sequence={sequence}
        gazeFixationPerNumber={gazeFixationPerNumber}
      />
      {svgBlock}
    </div>
  );
}
