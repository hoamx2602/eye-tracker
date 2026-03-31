'use client';

import React from 'react';
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

export default function TestModeCharts({ testTrajectories }: { testTrajectories: TestTrajectorySegment[] | null }) {
  if (!testTrajectories || testTrajectories.length === 0) return null;

  return (
    <div className="space-y-4">
      {testTrajectories.map((seg, i) => (
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
