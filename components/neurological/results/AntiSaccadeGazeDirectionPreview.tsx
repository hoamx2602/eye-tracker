'use client';

import React from 'react';
import type { AntiSaccadeTrialResult } from '../tests/antiSaccade/AntiSaccadeTest';

type Props = {
  trials: AntiSaccadeTrialResult[];
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
    <svg viewBox="0 0 100 100" className="h-20 w-20 shrink-0 rounded-lg border border-gray-700 bg-gray-900/80">
      <circle cx={CX} cy={CY} r={3} fill="rgb(148 163 184)" />
      {polarLine(targetDeg, 'rgb(52 211 153)', 3)}
      {polarLine(gazeDeg, 'rgb(251 191 36)', 2)}
    </svg>
  );
}

/**
 * Shows mean gaze direction vs correct anti-saccade (dim) direction per trial.
 */
export default function AntiSaccadeGazeDirectionPreview({ trials }: Props) {
  if (!trials?.length) {
    return <p className="text-slate-500 text-sm">No anti-saccade trials.</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Green = direction to correct target (dim); amber = mean gaze direction during movement. Angles are in screen
        coordinates (0° = right, 90° = down).
      </p>
      <div className="max-h-80 space-y-2 overflow-y-auto rounded-lg border border-gray-800 p-2">
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
