'use client';

import React, { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';

export type TestTrajectoryPoint = { t: number; targetX: number; targetY: number; gazeX: number; gazeY: number };
export type TestTrajectorySegment = { patternName: string; points: TestTrajectoryPoint[] };

export interface ChartSmoothingConfig {
  method: string; // 'NONE' | 'MOVING_AVERAGE' | 'GAUSSIAN'
  window: number;
}

// ---------------------------------------------------------------------------
// Smoothing utilities
// ---------------------------------------------------------------------------

function movingAverage(data: number[], win: number): number[] {
  const half = Math.floor(win / 2);
  return data.map((_, i) => {
    const start = Math.max(0, i - half);
    const end = Math.min(data.length, i + half + 1);
    let sum = 0;
    for (let j = start; j < end; j++) sum += data[j];
    return sum / (end - start);
  });
}

function gaussianKernel(win: number): number[] {
  const sigma = win / 4;
  const center = Math.floor(win / 2);
  const weights = Array.from({ length: win }, (_, i) =>
    Math.exp(-0.5 * ((i - center) / sigma) ** 2)
  );
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => w / total);
}

function gaussianSmooth(data: number[], win: number): number[] {
  const kernel = gaussianKernel(win);
  const half = Math.floor(win / 2);
  return data.map((_, i) => {
    let sum = 0, totalW = 0;
    for (let k = 0; k < win; k++) {
      const idx = i - half + k;
      if (idx >= 0 && idx < data.length) {
        sum += data[idx] * kernel[k];
        totalW += kernel[k];
      }
    }
    return sum / totalW;
  });
}

function applySmoothing(values: number[], cfg: ChartSmoothingConfig): number[] {
  if (cfg.method === 'NONE' || cfg.window < 2) return values;
  if (cfg.method === 'GAUSSIAN') return gaussianSmooth(values, cfg.window);
  // default: MOVING_AVERAGE
  return movingAverage(values, cfg.window);
}

function smoothSegment(
  seg: TestTrajectorySegment,
  cfg: ChartSmoothingConfig
): TestTrajectorySegment {
  if (cfg.method === 'NONE' || cfg.window < 2) return seg;
  const gazeXs = applySmoothing(seg.points.map((p) => p.gazeX), cfg);
  const gazeYs = applySmoothing(seg.points.map((p) => p.gazeY), cfg);
  return {
    patternName: seg.patternName,
    points: seg.points.map((p, i) => ({ ...p, gazeX: gazeXs[i], gazeY: gazeYs[i] })),
  };
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

function DarkTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ name?: string; value?: unknown; color?: string }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 shadow-xl text-left">
      {label != null && <p className="text-gray-200 text-xs font-medium mb-1">{String(label)}</p>}
      {payload.map((entry, i) => (
        <p key={i} className="text-xs" style={{ color: entry.color ?? '#9ca3af' }}>
          {entry.name}: <span className="font-mono">{typeof entry.value === 'number' ? entry.value.toFixed(3) : String(entry.value)}</span>
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function TestModeCharts({
  testTrajectories,
  smoothing,
}: {
  testTrajectories: TestTrajectorySegment[] | null;
  smoothing?: ChartSmoothingConfig;
}) {
  const cfg: ChartSmoothingConfig = smoothing ?? { method: 'NONE', window: 1 };

  const smoothedTrajectories = useMemo(
    () => testTrajectories?.map((seg) => smoothSegment(seg, cfg)) ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [testTrajectories, cfg.method, cfg.window]
  );

  if (!smoothedTrajectories || smoothedTrajectories.length === 0) return null;

  const smoothingLabel =
    cfg.method === 'NONE' || cfg.window < 2
      ? null
      : cfg.method === 'GAUSSIAN'
        ? `Gaussian smoothing (σ window ${cfg.window})`
        : `Moving average (window ${cfg.window})`;

  return (
    <div className="space-y-4">
      {smoothingLabel && (
        <p className="text-xs text-gray-500 italic">{smoothingLabel} applied to gaze signal</p>
      )}
      {smoothedTrajectories.map((seg, i) => (
        <details key={i} className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden print:break-inside-avoid" open={true}>
          <summary className="cursor-pointer select-none px-4 py-3 flex items-center justify-between gap-3 hover:bg-gray-800/50">
            <span className="text-sm font-medium text-gray-200">{seg.patternName}</span>
            <span className="text-xs text-gray-500">{seg.points.length} points</span>
          </summary>
          <div className="px-4 pb-4 pt-2 grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 gap-6">
            <div>
              <div className="text-xs text-gray-500 mb-2">X — Position (%)</div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={seg.points} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis
                    dataKey="t"
                    tick={{ fill: '#9ca3af', fontSize: 10 }}
                    name="Time (s)"
                    tickFormatter={(val) => Number(val).toFixed(1)}
                    minTickGap={30}
                  />
                  <YAxis
                    tick={{ fill: '#9ca3af', fontSize: 10 }}
                    tickFormatter={(val) => Math.round(Number(val)).toLocaleString()}
                  />
                  <Tooltip content={<DarkTooltip />} />
                  <ReferenceLine y={50} stroke="#374151" />
                  <Line type="monotone" dataKey="targetX" stroke="#86efac" strokeWidth={2} dot={false} name="Target X" />
                  <Line type="monotone" dataKey="gazeX" stroke="#a78bfa" strokeWidth={2} dot={false} name="Eye X" />
                </LineChart>
              </ResponsiveContainer>
              <div className="flex gap-4 mt-2">
                <span className="text-xs text-gray-400 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-300" /> Target</span>
                <span className="text-xs text-gray-400 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-violet-400" /> Eye</span>
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-2">Y — Position (%)</div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={seg.points} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis
                    dataKey="t"
                    tick={{ fill: '#9ca3af', fontSize: 10 }}
                    name="Time (s)"
                    tickFormatter={(val) => Number(val).toFixed(1)}
                    minTickGap={30}
                  />
                  <YAxis
                    tick={{ fill: '#9ca3af', fontSize: 10 }}
                    tickFormatter={(val) => Math.round(Number(val)).toLocaleString()}
                  />
                  <Tooltip content={<DarkTooltip />} />
                  <ReferenceLine y={50} stroke="#374151" />
                  <Line type="monotone" dataKey="targetY" stroke="#86efac" strokeWidth={2} dot={false} name="Target Y" />
                  <Line type="monotone" dataKey="gazeY" stroke="#a78bfa" strokeWidth={2} dot={false} name="Eye Y" />
                </LineChart>
              </ResponsiveContainer>
              <div className="flex gap-4 mt-2">
                <span className="text-xs text-gray-400 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-300" /> Target</span>
                <span className="text-xs text-gray-400 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-violet-400" /> Eye</span>
              </div>
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}
