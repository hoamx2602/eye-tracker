'use client';

import React, { useMemo } from 'react';
import { getTargetPosition } from '../tests/saccadic/utils';
import type { SaccadicCycleResult } from '../tests/saccadic/SaccadicTest';

type Props = {
  cycles: SaccadicCycleResult[];
  saccadeLatencyMs?: number[];
  fixationAccuracy?: number;
  correctiveSaccades?: number;
  metrics?: {
    avgLatency?: number;
    fixationAccuracy?: number;
    correctiveSaccadeCount?: number;
  };
  viewportWidth?: number;
  viewportHeight?: number;
};

export default function SaccadicResultsPreview({
  cycles,
  saccadeLatencyMs,
  fixationAccuracy,
  correctiveSaccades,
  metrics,
  viewportWidth,
  viewportHeight,
}: Props) {
  const vw = viewportWidth ?? 1920;
  const vh = viewportHeight ?? 1080;

  const overview = useMemo(() => {
    const left = getTargetPosition('left', vw, vh);
    const right = getTargetPosition('right', vw, vh);
    const pathStr = (samples: SaccadicCycleResult['gazeSamples']) => {
      if (!samples?.length) return '';
      return samples
        .map((s) => {
          const x = s.x;
          const y = s.y;
          return `${x},${y}`;
        })
        .join(' ');
    };
    return { left, right, pathStr };
  }, [vw, vh]);

  if (!cycles?.length) {
    return <p className="text-slate-500 text-sm">No saccadic data.</p>;
  }

  const latencies = saccadeLatencyMs ?? cycles.map((c) => c.latencyMs).filter((v): v is number => typeof v === 'number');
  const maxLat = Math.max(...latencies, 1);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 text-sm text-slate-300">
        {metrics?.avgLatency != null && (
          <span>
            Avg latency:{' '}
            <span className="font-mono text-sky-400">{metrics.avgLatency.toFixed(0)} ms</span>
          </span>
        )}
        {metrics?.fixationAccuracy != null && (
          <span>
            Fixation hit rate:{' '}
            <span className="font-mono text-emerald-400">{metrics.fixationAccuracy.toFixed(1)}%</span>
          </span>
        )}
        {correctiveSaccades != null && (
          <span>
            Corrective saccades (heuristic):{' '}
            <span className="font-mono text-amber-300">{correctiveSaccades}</span>
          </span>
        )}
      </div>

      <div className="w-full overflow-hidden rounded-xl border border-gray-800 bg-gray-900/50">
        <svg
          className="h-56 w-full"
          viewBox={`0 0 ${vw} ${vh}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Saccadic targets and gaze paths per cycle"
        >
          <rect width={vw} height={vh} fill="rgb(15 23 42 / 0.35)" />
          <circle cx={overview.left.x} cy={overview.left.y} r={18} fill="rgb(245 158 11 / 0.35)" stroke="rgb(245 158 11)" strokeWidth="2" />
          <circle cx={overview.right.x} cy={overview.right.y} r={18} fill="rgb(245 158 11 / 0.35)" stroke="rgb(245 158 11)" strokeWidth="2" />
          <text x={overview.left.x} y={overview.left.y + 36} textAnchor="middle" fill="rgb(148 163 184)" fontSize="11">
            L
          </text>
          <text x={overview.right.x} y={overview.right.y + 36} textAnchor="middle" fill="rgb(148 163 184)" fontSize="11">
            R
          </text>
          {cycles.map((cy, i) => {
            const pts = overview.pathStr(cy.gazeSamples);
            if (!pts) return null;
            const hue = (i * 37) % 360;
            return (
              <polyline
                key={`${cy.onsetTime}-${i}`}
                fill="none"
                stroke={`hsl(${hue} 70% 60%)`}
                strokeWidth="1.25"
                opacity={0.85}
                points={pts}
              />
            );
          })}
        </svg>
      </div>
      <p className="text-xs text-slate-500">Orange circles = target positions; colored traces = gaze per cycle.</p>

      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="w-full min-w-[400px] text-left text-xs text-slate-300">
          <thead className="bg-gray-900/80 text-slate-400">
            <tr>
              <th className="px-2 py-2 font-medium">#</th>
              <th className="px-2 py-2 font-medium">Side</th>
              <th className="px-2 py-2 font-medium">Latency (ms)</th>
              <th className="px-2 py-2 font-medium w-40">Bar</th>
            </tr>
          </thead>
          <tbody>
            {cycles.map((c, i) => {
              const lat = c.latencyMs;
              const w = lat != null ? Math.min(100, (lat / maxLat) * 100) : 0;
              return (
                <tr key={`${c.onsetTime}-${i}`} className="border-t border-gray-800">
                  <td className="px-2 py-1.5 font-mono text-slate-500">{i + 1}</td>
                  <td className="px-2 py-1.5 font-medium uppercase">{c.targetSide}</td>
                  <td className="px-2 py-1.5 font-mono">{lat != null ? lat.toFixed(0) : '—'}</td>
                  <td className="px-2 py-1.5">
                    <div className="h-2 w-full rounded bg-gray-800">
                      <div
                        className="h-2 rounded bg-sky-500/70"
                        style={{ width: `${lat != null ? w : 0}%` }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
