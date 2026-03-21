'use client';

import React, { useMemo } from 'react';
import { getStimulusPosition } from '../tests/peripheralVision/utils';
import type { PeripheralZone } from '../tests/peripheralVision/constants';
import type { PeripheralVisionTrialResult } from '../tests/peripheralVision/PeripheralVisionTest';

type Props = {
  trials: PeripheralVisionTrialResult[];
  metrics?: {
    avgRT?: number;
    accuracy?: number;
    centerStability?: number;
  };
  viewportWidth?: number;
  viewportHeight?: number;
};

export default function PeripheralVisionResultsPreview({
  trials,
  metrics,
  viewportWidth,
  viewportHeight,
}: Props) {
  const vw = viewportWidth ?? 1920;
  const vh = viewportHeight ?? 1080;
  const center = { x: vw / 2, y: vh / 2 };

  const zones = useMemo(() => {
    const list: PeripheralZone[] = ['top', 'bottom', 'left', 'right'];
    return list.map((z) => ({
      z,
      pos: getStimulusPosition(z, vw, vh),
    }));
  }, [vw, vh]);

  if (!trials?.length) {
    return <p className="text-slate-500 text-sm">No peripheral vision trials.</p>;
  }

  const hits = trials.filter((t) => t.hit).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 text-sm text-slate-300">
        {metrics?.avgRT != null && (
          <span>
            Mean RT (hits):{' '}
            <span className="font-mono text-sky-400">{metrics.avgRT.toFixed(0)} ms</span>
          </span>
        )}
        {metrics?.accuracy != null && (
          <span>
            Accuracy:{' '}
            <span className="font-mono text-emerald-400">{metrics.accuracy.toFixed(1)}%</span>
          </span>
        )}
        {metrics?.centerStability != null && (
          <span>
            Mean dist. center→gaze:{' '}
            <span className="font-mono text-slate-200">{metrics.centerStability.toFixed(1)} px</span>
          </span>
        )}
        <span className="text-slate-500">
          Hits: {hits} / {trials.length}
        </span>
      </div>

      <div className="w-full overflow-hidden rounded-xl border border-gray-800 bg-gray-900/50">
        <svg
          className="h-52 w-full"
          viewBox={`0 0 ${vw} ${vh}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Peripheral stimulus zones"
        >
          <rect width={vw} height={vh} fill="rgb(15 23 42 / 0.35)" />
          <circle cx={center.x} cy={center.y} r={10} fill="rgb(245 158 11 / 0.9)" />
          {zones.map(({ z, pos }) => (
            <circle
              key={z}
              cx={pos.x}
              cy={pos.y}
              r={14}
              fill="rgb(255 255 255 / 0.08)"
              stroke="rgb(148 163 184 / 0.6)"
              strokeWidth="1"
            />
          ))}
          <text x={center.x} y={center.y - 20} textAnchor="middle" fill="rgb(148 163 184)" fontSize="12">
            Center
          </text>
        </svg>
      </div>
      <p className="text-xs text-slate-500">
        Schematic: fixation center (amber); ring markers = typical peripheral stimulus positions (zones).
      </p>

      <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-800">
        <table className="w-full min-w-[360px] text-left text-xs text-slate-300">
          <thead className="sticky top-0 bg-gray-900/95 text-slate-400">
            <tr>
              <th className="px-2 py-2 font-medium">#</th>
              <th className="px-2 py-2 font-medium">Zone</th>
              <th className="px-2 py-2 font-medium">Hit</th>
              <th className="px-2 py-2 font-medium">RT (ms)</th>
            </tr>
          </thead>
          <tbody>
            {trials.map((t, i) => (
              <tr key={`${t.stimulusOnsetTime}-${i}`} className="border-t border-gray-800">
                <td className="px-2 py-1.5 font-mono text-slate-500">{i + 1}</td>
                <td className="px-2 py-1.5 font-medium capitalize">{t.stimulusPosition}</td>
                <td className="px-2 py-1.5">{t.hit ? <span className="text-emerald-400">Yes</span> : <span className="text-rose-400">No</span>}</td>
                <td className="px-2 py-1.5 font-mono">{t.rtMs != null ? t.rtMs.toFixed(0) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
