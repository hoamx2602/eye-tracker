'use client';

import React, { useMemo, useState } from 'react';
import { getTargetPosition } from '../tests/saccadic/utils';
import {
  RESULT_VIZ_OUTER,
  ResultVizAspectSvg,
  ResultVizMaxFrame,
  useResultVizInnerFrameStyle,
} from './resultVizLayout';
import type { SaccadicCycleResult } from '../tests/saccadic/SaccadicTest';
import { GazeHeatmapLayer, GazePathDirectionArrows } from './gazeVizSvg';
import { useNeurologicalResultsViewOptions } from './neuroResultsViewOptions';
import { detectAndMapGazeToViewport } from '@/lib/visualSearchGazeCoords';

type Props = {
  cycles: SaccadicCycleResult[];
  /** performance.now() lúc mount bài — cần để tính thời gian tuyệt đối cho replay. */
  startTime?: number;
  endTime?: number;
  scanningPath?: Array<{ t: number; x: number; y: number }>;
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

type MappedCycle = SaccadicCycleResult & {
  mappedSamples: Array<{ t: number; x: number; y: number }>;
};

function globalSampleTimeSec(cy: SaccadicCycleResult, s: { t: number }, testStartMs: number): number {
  return (cy.onsetTime - testStartMs) / 1000 + s.t;
}

export function SaccadicParamsSection({
  cycles,
  saccadeLatencyMs,
  fixationAccuracy,
  correctiveSaccades,
  metrics,
  scanningPath,
}: Pick<
  Props,
  | 'cycles'
  | 'saccadeLatencyMs'
  | 'fixationAccuracy'
  | 'correctiveSaccades'
  | 'metrics'
  | 'scanningPath'
>) {
  const latencies = saccadeLatencyMs ?? cycles.map((c) => c.latencyMs).filter((v): v is number => typeof v === 'number');
  const maxLat = Math.max(...latencies, 1);
  const trialSamples = cycles.reduce((n, c) => n + (c.gazeSamples?.length ?? 0), 0);

  const rows: LatencyRow[] = cycles.map((c, i) => {
    const lat = c.latencyMs;
    const w = lat != null ? Math.min(100, (lat / maxLat) * 100) : 0;
    return { i: i + 1, side: c.targetSide, lat, w };
  });

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500 leading-relaxed">
        Gaze samples: <span className="font-mono text-slate-300">{trialSamples}</span> (total across cycles)
        {scanningPath != null ? (
          <>
            {' '}
            · <span className="font-mono text-slate-300">{scanningPath.length}</span> points in{' '}
            <code className="text-slate-400">scanningPath</code>
          </>
        ) : null}
      </p>
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
              <th className="w-40 px-2 py-2 font-medium">Bar</th>
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
  startTime: startTimeProp,
  endTime: endTimeProp,
  scanningPath,
  saccadeLatencyMs,
  fixationAccuracy,
  correctiveSaccades,
  metrics,
  viewportWidth,
  viewportHeight,
  visualOnly,
}: Props) {
  const innerFrame = useResultVizInnerFrameStyle();
  const vw = viewportWidth ?? 1920;
  const vh = viewportHeight ?? 1080;

  const testStartMs = useMemo(() => {
    if (typeof startTimeProp === 'number' && Number.isFinite(startTimeProp)) return startTimeProp;
    return cycles[0]?.onsetTime ?? 0;
  }, [startTimeProp, cycles]);

  const durationSec = useMemo(() => {
    if (
      typeof startTimeProp === 'number' &&
      typeof endTimeProp === 'number' &&
      Number.isFinite(startTimeProp) &&
      Number.isFinite(endTimeProp) &&
      endTimeProp >= startTimeProp
    ) {
      return (endTimeProp - startTimeProp) / 1000;
    }
    let maxT = 0;
    for (const cy of cycles) {
      for (const s of cy.gazeSamples ?? []) {
        const g = globalSampleTimeSec(cy, s, testStartMs);
        if (g > maxT) maxT = g;
      }
    }
    return maxT;
  }, [cycles, startTimeProp, endTimeProp, testStartMs]);

  const [replayTimeSec, setReplayTimeSec] = useState<number | null>(null);
  const effectiveReplay = replayTimeSec ?? durationSec;

  const layout = useMemo(() => {
    if (!cycles?.length) return null;

    const left = getTargetPosition('left', vw, vh);
    const right = getTargetPosition('right', vw, vh);
    const pad = 52;
    const targetR = 22;

    const allGazePts = cycles.flatMap((c) => c.gazeSamples ?? []);
    const { mode } = detectAndMapGazeToViewport(allGazePts, vw, vh);

    const mapPt = (p: { x: number; y: number; t: number }) => {
      if (mode === 'normalized01') return { ...p, x: p.x * vw, y: p.y * vh };
      if (mode === 'percent100') return { ...p, x: (p.x / 100) * vw, y: (p.y / 100) * vh };
      return p;
    };

    const mappedCycles: MappedCycle[] = cycles.map((cy) => ({
      ...cy,
      mappedSamples: (cy.gazeSamples ?? []).map((s) => mapPt(s)),
    }));

    let minX = Math.min(left.x - targetR, right.x - targetR);
    let maxX = Math.max(left.x + targetR, right.x + targetR);
    let minY = Math.min(left.y - targetR, right.y - targetR);
    let maxY = Math.max(left.y + targetR + 42, right.y + targetR + 42);

    for (const mc of mappedCycles) {
      for (const s of mc.mappedSamples) {
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

    return {
      viewW,
      viewH,
      left: loc(left.x, left.y),
      right: loc(right.x, right.y),
      loc,
      mappedCycles,
    };
  }, [cycles, vw, vh]);

  const { showStimulusReplay, showGazeHeatmap } = useNeurologicalResultsViewOptions();

  const totalGazeSamples =
    cycles.reduce((n, c) => n + (c.gazeSamples?.length ?? 0), 0) || (scanningPath?.length ?? 0);

  const cycleWindowSec = (i: number): { start: number; end: number } => {
    const cy = cycles[i];
    if (!cy) return { start: 0, end: 0 };
    const start = (cy.onsetTime - testStartMs) / 1000;
    const samples = cy.gazeSamples ?? [];
    const maxT = samples.length ? Math.max(...samples.map((s) => s.t)) : 0;
    let end = start + maxT + 0.05;
    if (i + 1 < cycles.length) {
      end = Math.min(end, (cycles[i + 1].onsetTime - testStartMs) / 1000);
    } else if (typeof endTimeProp === 'number' && Number.isFinite(endTimeProp)) {
      end = Math.min(end, (endTimeProp - testStartMs) / 1000);
    }
    return { start, end };
  };

  if (!cycles?.length) {
    return <p className="text-slate-500 text-sm">No saccadic data.</p>;
  }

  if (!layout) {
    return <p className="text-slate-500 text-sm">No saccadic data.</p>;
  }

  const svgBlock = (
    <ResultVizMaxFrame>
      <ResultVizAspectSvg
        contentWidth={layout.viewW}
        contentHeight={layout.viewH}
        panelFill="rgb(15 23 42 / 0.35)"
        role="img"
        aria-label="Saccadic targets, gaze paths per cycle, replay"
      >
        {showStimulusReplay &&
          (() => {
            let activeSide: 'left' | 'right' | null = null;
            for (let i = 0; i < cycles.length; i++) {
              const { start, end } = cycleWindowSec(i);
              if (effectiveReplay >= start - 1e-6 && effectiveReplay < end) {
                activeSide = cycles[i].targetSide;
                break;
              }
            }
            const ring = (pos: { x: number; y: number }, side: 'left' | 'right') => {
              const on = activeSide === side;
              return (
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={on ? 20 : 18}
                  fill={on ? 'rgb(245 158 11 / 0.55)' : 'rgb(245 158 11 / 0.2)'}
                  stroke={on ? 'rgb(251 191 36)' : 'rgb(245 158 11 / 0.45)'}
                  strokeWidth={on ? 3 : 2}
                />
              );
            };
            return (
              <g aria-hidden>
                {ring(layout.left, 'left')}
                {ring(layout.right, 'right')}
                <text x={layout.left.x} y={layout.left.y + 36} textAnchor="middle" fill="rgb(148 163 184)" fontSize="11">
                  L
                </text>
                <text x={layout.right.x} y={layout.right.y + 36} textAnchor="middle" fill="rgb(148 163 184)" fontSize="11">
                  R
                </text>
              </g>
            );
          })()}
        {showGazeHeatmap && (
          <GazeHeatmapLayer
            points={layout.mappedCycles.flatMap((mc, i) => {
              const cy = cycles[i];
              return mc.mappedSamples
                .filter((s) => globalSampleTimeSec(cy, s, testStartMs) <= effectiveReplay)
                .map((s) => layout.loc(s.x, s.y));
            })}
          />
        )}
        {layout.mappedCycles.map((mc, i) => {
          const cy = cycles[i];
          const filtered = mc.mappedSamples.filter(
            (s) => globalSampleTimeSec(cy, s, testStartMs) <= effectiveReplay
          );
          if (filtered.length === 0) return null;
          const pts = filtered.map((s) => layout.loc(s.x, s.y));
          const ptsStr = pts.map((p) => `${p.x},${p.y}`).join(' ');
          const hue = (i * 37) % 360;
          const stroke = `hsl(${hue} 72% 62%)`;
          return (
            <g key={`path-${cy.onsetTime}-${i}`}>
              {pts.length >= 2 ? (
                <>
                  <polyline
                    fill="none"
                    stroke="rgb(15 23 42)"
                    strokeWidth={5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.85}
                    vectorEffect="nonScalingStroke"
                    points={ptsStr}
                  />
                  <polyline
                    fill="none"
                    stroke={stroke}
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.95}
                    vectorEffect="nonScalingStroke"
                    points={ptsStr}
                  />
                </>
              ) : (
                <circle
                  cx={pts[0].x}
                  cy={pts[0].y}
                  r={5}
                  fill={stroke}
                  stroke="rgb(15 23 42)"
                  strokeWidth={1.5}
                  vectorEffect="nonScalingStroke"
                />
              )}
              <GazePathDirectionArrows points={pts} step={10} fill={`hsl(${hue} 70% 55%)`} size={5} />
            </g>
          );
        })}
      </ResultVizAspectSvg>
    </ResultVizMaxFrame>
  );

  if (visualOnly) {
    return (
      <div className={RESULT_VIZ_OUTER}>
        <div
          className={`${innerFrame.className} relative flex min-h-0 flex-col overflow-hidden`}
          style={innerFrame.style}
        >
          <p className="pointer-events-none absolute left-0 right-0 top-2 z-10 px-3 text-center text-[10px] text-slate-500">
            <span className="text-slate-400">Colored lines = gaze per cycle.</span> Orange ring = target (brighter = cycle at replay). Latency details in{' '}
            <strong>Parameters</strong>.
          </p>
          {totalGazeSamples === 0 && (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-4 pt-10">
              <p className="max-w-md rounded-lg border border-amber-800/60 bg-amber-950/90 px-3 py-2.5 text-center text-xs leading-relaxed text-amber-50/95 shadow-lg">
                No gaze samples in results — path cannot be drawn. Re-run the test with gaze tracking.
              </p>
            </div>
          )}
          <div className="flex min-h-0 flex-1 flex-col gap-2 px-2 pb-2 pt-9 sm:px-3">
            <div className="min-h-0 flex-1 overflow-hidden">{svgBlock}</div>
          </div>
          {durationSec > 0 && (
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-gray-800 bg-gray-900/40 px-3 pb-3 pt-3 text-xs text-slate-400 sm:px-4 sm:pb-4">
              <span className="shrink-0 w-28 whitespace-nowrap">Replay time</span>
              <input
                type="range"
                min={0}
                max={durationSec}
                step={0.01}
                value={Math.min(effectiveReplay, durationSec)}
                onChange={(e) => setReplayTimeSec(Number(e.target.value))}
                className="min-w-0 flex-1 accent-sky-500"
              />
              <span className="shrink-0 w-[4.5rem] text-right font-mono text-[10px] leading-[13px] tracking-tight">
                {effectiveReplay.toFixed(1)}s <br />
                <span className="text-slate-600"> {durationSec.toFixed(1)}s</span>
              </span>
            </div>
          )}
        </div>
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
        scanningPath={scanningPath}
      />
      {svgBlock}
      <p className="text-xs text-slate-500">Orange circles = target positions; colored traces = gaze per cycle.</p>
    </div>
  );
}
