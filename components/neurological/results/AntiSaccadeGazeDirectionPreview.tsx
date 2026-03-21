'use client';

import React from 'react';
import type { AntiSaccadeTrialResult } from '../tests/antiSaccade/AntiSaccadeTest';
import { RESULT_VIZ_OUTER, useResultVizInnerFrameStyle } from './resultVizLayout';

type Props = {
  trials: AntiSaccadeTrialResult[];
  visualOnly?: boolean;
};

const R = 38;
const CX = 50;
const CY = 50;

function polarLine(deg: number | undefined, color: string, strokeWidth: number) {
  if (deg === undefined || !Number.isFinite(deg)) return null;
  const rad = (deg * Math.PI) / 180;
  const x2 = CX + R * Math.cos(rad);
  const y2 = CY + R * Math.sin(rad);
  return (
    <line
      x1={CX}
      y1={CY}
      x2={x2}
      y2={y2}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
    />
  );
}

function MiniCompass({
  targetDeg,
  gazeDeg,
}: {
  targetDeg: number | undefined;
  gazeDeg: number | undefined;
}) {
  return (
    <svg viewBox="0 0 100 100" className="h-28 w-28 shrink-0 rounded-lg border border-gray-700 bg-gray-900/80 sm:h-32 sm:w-32">
      <circle cx={CX} cy={CY} r={3} fill="rgb(148 163 184)" />
      {polarLine(targetDeg, 'rgb(52 211 153)', 3)}
      {polarLine(gazeDeg, 'rgb(251 191 36)', 2)}
    </svg>
  );
}

/** Trial table + legend — parameters drawer. */
export function AntiSaccadeParamsSection({ trials }: { trials: AntiSaccadeTrialResult[] }) {
  if (!trials?.length) {
    return <p className="text-slate-500 text-sm">No anti-saccade trials.</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 leading-relaxed">
        Green = hướng target (dim); amber = mean gaze. Góc màn hình: 0° = phải, 90° = xuống.
      </p>
      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="w-full min-w-[280px] text-left text-xs text-slate-300">
          <thead className="bg-gray-900/80 text-slate-400">
            <tr>
              <th className="px-2 py-2 font-medium">#</th>
              <th className="px-2 py-2 font-medium">Dir</th>
              <th className="px-2 py-2 font-medium">Target°</th>
              <th className="px-2 py-2 font-medium">Gaze°</th>
              <th className="px-2 py-2 font-medium">Δ°</th>
            </tr>
          </thead>
          <tbody>
            {trials.map((t, i) => (
              <tr key={`${t.startTime}-${i}`} className="border-t border-gray-800">
                <td className="px-2 py-1.5 font-mono text-slate-500">{i + 1}</td>
                <td className="px-2 py-1.5 font-medium uppercase">{t.direction}</td>
                <td className="px-2 py-1.5 font-mono text-emerald-400">
                  {t.targetDirectionDeg != null ? t.targetDirectionDeg.toFixed(0) : '—'}
                </td>
                <td className="px-2 py-1.5 font-mono text-amber-300">
                  {t.gazeDirectionDeg != null ? t.gazeDirectionDeg.toFixed(0) : '—'}
                </td>
                <td className="px-2 py-1.5 font-mono text-slate-200">
                  {t.angularErrorDeg != null
                    ? `${t.angularErrorDeg > 0 ? '+' : ''}${t.angularErrorDeg.toFixed(0)}`
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Mean gaze vs anti-saccade target direction per trial — compasses in main area; table in parameters panel when split.
 */
export default function AntiSaccadeGazeDirectionPreview({ trials, visualOnly }: Props) {
  const innerFrame = useResultVizInnerFrameStyle();

  if (!trials?.length) {
    return <p className="text-slate-500 text-sm">No anti-saccade trials.</p>;
  }

  if (visualOnly) {
    return (
      <div className={RESULT_VIZ_OUTER}>
        <div
          className={`${innerFrame.className} relative flex flex-col overflow-hidden`}
          style={innerFrame.style}
        >
          <p className="pointer-events-none absolute left-0 right-0 top-2 z-10 px-3 text-center text-[10px] text-slate-500">
            Xanh = target; vàng = gaze. Chi tiết số trong panel <strong>Tham số</strong>.
          </p>
          <div className="flex min-h-0 flex-1 flex-wrap content-center justify-center gap-5 overflow-y-auto px-3 pb-4 pt-9 sm:gap-6">
            {trials.map((t, i) => (
              <div key={`${t.startTime}-${i}`} className="flex flex-col items-center gap-1">
                <MiniCompass targetDeg={t.targetDirectionDeg} gazeDeg={t.gazeDirectionDeg} />
                <span className="font-mono text-[10px] text-slate-500">#{i + 1}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Green = direction to correct target (dim); amber = mean gaze direction during movement. Angles are in screen
        coordinates (0° = right, 90° = down).
      </p>
      <div className="space-y-2 rounded-lg border border-gray-800 p-2 sm:p-3">
        {trials.map((t, i) => (
          <div
            key={`${t.startTime}-${i}`}
            className="flex flex-wrap items-center gap-3 rounded-md bg-gray-900/50 px-2 py-2 text-xs text-slate-300"
          >
            <span className="w-8 font-mono text-slate-500">#{i + 1}</span>
            <span className="rounded bg-slate-800 px-1.5 py-0.5 font-medium text-slate-200">{t.direction}</span>
            <MiniCompass targetDeg={t.targetDirectionDeg} gazeDeg={t.gazeDirectionDeg} />
            <div className="min-w-0 flex-1 font-mono text-[11px] leading-relaxed">
              <div>
                Target:{' '}
                <span className="text-emerald-400">
                  {t.targetDirectionDeg != null ? `${t.targetDirectionDeg.toFixed(0)}°` : '—'}
                </span>
                {' · '}
                Gaze:{' '}
                <span className="text-amber-300">
                  {t.gazeDirectionDeg != null ? `${t.gazeDirectionDeg.toFixed(0)}°` : '—'}
                </span>
              </div>
              <div className="text-slate-500">
                Δ (error):{' '}
                <span className="text-slate-200">
                  {t.angularErrorDeg != null ? `${t.angularErrorDeg > 0 ? '+' : ''}${t.angularErrorDeg.toFixed(0)}°` : '—'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
