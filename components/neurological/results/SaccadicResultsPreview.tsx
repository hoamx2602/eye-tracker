'use client';

import React, { useMemo } from 'react';
import { getTargetPosition } from '../tests/saccadic/utils';
import { ResultVizAspectSvg, ResultVizMaxFrame } from './resultVizLayout';
import type { SaccadicCycleResult } from '../tests/saccadic/SaccadicTest';
import { GazeHeatmapLayer, GazePathDirectionArrows } from './gazeVizSvg';
import { useNeurologicalResultsViewOptions } from './neuroResultsViewOptions';

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
  visualOnly?: boolean;
};

type LatencyRow = { i: number; side: string; lat: number | undefined; w: number };

export function SaccadicParamsSection({
  cycles,
  saccadeLatencyMs,
  fixationAccuracy,
  correctiveSaccades,
  metrics,
}: Pick<Props, 'cycles' | 'saccadeLatencyMs' | 'fixationAccuracy' | 'correctiveSaccades' | 'metrics'>) {
  const latencies = saccadeLatencyMs ?? cycles.map((c) => c.latencyMs).filter((v): v is number => typeof v === 'number');
  const maxLat = Math.max(...latencies, 1);

  const rows: LatencyRow[] = cycles.map((c, i) => {
    const lat = c.latencyMs;
    const w = lat != null ? Math.min(100, (lat / maxLat) * 100) : 0;
    return { i: i + 1, side: c.targetSide, lat, w };
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 text-sm text-slate-300">
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
            {rows.map((r) => (
              <tr key={r.i} className="border-t border-gray-800">
                <td className="px-2 py-1.5 font-mono text-slate-500">{r.i}</td>
                <td className="px-2 py-1.5 font-medium uppercase">{r.side}</td>
                <td className="px-2 py-1.5 font-mono">{r.lat != null ? r.lat.toFixed(0) : '—'}</td>
                <td className="px-2 py-1.5">
                  <div className="h-2 w-full rounded bg-gray-800">
                    <div
                      className="h-2 rounded bg-sky-500/70"
                      style={{ width: `${r.lat != null ? r.w : 0}%` }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function SaccadicResultsPreview({
  cycles,
  saccadeLatencyMs,
  fixationAccuracy,
  correctiveSaccades,
  metrics,
  viewportWidth,
  viewportHeight,
  visualOnly,
}: Props) {
  const vwRef = viewportWidth ?? 1920;
  const vhRef = viewportHeight ?? 1080;

  const overview = useMemo(() => {
    const left = getTargetPosition('left', vwRef, vhRef);
    const right = getTargetPosition('right', vwRef, vhRef);
    const pad = 52;
    const targetR = 22;
    let minX = Math.min(left.x - targetR, right.x - targetR);
    let maxX = Math.max(left.x + targetR, right.x + targetR);
    let minY = Math.min(left.y - targetR, right.y - targetR);
    let maxY = Math.max(left.y + targetR + 42, right.y + targetR + 42);
    for (const cy of cycles) {
      for (const s of cy.gazeSamples ?? []) {
        minX = Math.min(minX, s.x);
        maxX = Math.max(maxX, s.x);
        minY = Math.min(minY, s.y);
        maxY = Math.max(maxY, s.y);
      }
    }
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;
    const viewW = Math.max(maxX - minX, 280);
    const viewH = Math.max(maxY - minY, 200);
    const loc = (x: number, y: number) => ({ x: x - minX, y: y - minY });
    const pathStr = (samples: SaccadicCycleResult['gazeSamples']) => {
      if (!samples?.length) return '';
      return samples
        .map((s) => {
          const q = loc(s.x, s.y);
          return `${q.x},${q.y}`;
        })
        .join(' ');
    };
    return {
      viewW,
      viewH,
      left: loc(left.x, left.y),
      right: loc(right.x, right.y),
      pathStr,
      loc,
    };
  }, [cycles, vwRef, vhRef]);

  const { showStimulusReplay, showGazeHeatmap } = useNeurologicalResultsViewOptions();

  const allHeatPoints = useMemo(() => {
    const out: { x: number; y: number }[] = [];
    for (const cy of cycles) {
      for (const s of cy.gazeSamples ?? []) {
        out.push(overview.loc(s.x, s.y));
      }
    }
    return out;
  }, [cycles, overview]);

  if (!cycles?.length) {
    return <p className="text-slate-500 text-sm">No saccadic data.</p>;
  }

  const svgBlock = (
    <ResultVizMaxFrame>
      <ResultVizAspectSvg
        contentWidth={overview.viewW}
        contentHeight={overview.viewH}
        panelFill="rgb(15 23 42 / 0.35)"
        role="img"
        aria-label="Saccadic targets and gaze paths per cycle"
      >
        {showStimulusReplay && (
          <>
            <circle cx={overview.left.x} cy={overview.left.y} r={18} fill="rgb(245 158 11 / 0.35)" stroke="rgb(245 158 11)" strokeWidth="2" />
            <circle cx={overview.right.x} cy={overview.right.y} r={18} fill="rgb(245 158 11 / 0.35)" stroke="rgb(245 158 11)" strokeWidth="2" />
            <text x={overview.left.x} y={overview.left.y + 36} textAnchor="middle" fill="rgb(148 163 184)" fontSize="11">
              L
            </text>
            <text x={overview.right.x} y={overview.right.y + 36} textAnchor="middle" fill="rgb(148 163 184)" fontSize="11">
              R
            </text>
          </>
        )}
        {showGazeHeatmap && <GazeHeatmapLayer points={allHeatPoints} />}
        {cycles.map((cy, i) => {
          const pts = overview.pathStr(cy.gazeSamples);
          if (!pts) return null;
          const hue = (i * 37) % 360;
          const ptArr =
            cy.gazeSamples?.map((s) => overview.loc(s.x, s.y)) ??
            [];
          return (
            <g key={`${cy.onsetTime}-${i}`}>
              <polyline
                fill="none"
                stroke={`hsl(${hue} 70% 60%)`}
                strokeWidth="1.25"
                opacity={0.85}
                points={pts}
              />
              <GazePathDirectionArrows points={ptArr} step={10} fill={`hsl(${hue} 70% 55%)`} size={5} />
            </g>
          );
        })}
      </ResultVizAspectSvg>
    </ResultVizMaxFrame>
  );

  if (visualOnly) {
    return (
      <div className="relative flex min-h-0 max-h-full w-full min-w-0 shrink flex-col overflow-hidden">
        {svgBlock}
        <p className="pointer-events-none absolute bottom-2 left-2 right-2 text-center text-[10px] leading-snug text-slate-500/95 sm:text-xs">
          Vòng cam = target; các đường màu = gaze theo từng chu kỳ.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <SaccadicParamsSection
        cycles={cycles}
        saccadeLatencyMs={saccadeLatencyMs}
        fixationAccuracy={fixationAccuracy}
        correctiveSaccades={correctiveSaccades}
        metrics={metrics}
      />
      {svgBlock}
      <p className="text-xs text-slate-500">Orange circles = target positions; colored traces = gaze per cycle.</p>
    </div>
  );
}
