'use client';

import React, { useState } from 'react';
import { MANUAL_POINT_ORDER, type ManualEyePoints } from '@/lib/iop/eyeGeometry';
import type { EyeSideLabel, Point } from '@/lib/iop/types';

interface IopManualPickerProps {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  onSubmit: (points: ManualEyePoints, side: EyeSideLabel) => void;
  /** Why automatic detection failed, if it was tried. */
  autoFailure?: string | null;
}

/**
 * Six clicks, for when neither face landmarks nor the close-up detector find
 * the eye, or their outline is wrong. The lid points define the two eyelid
 * circles of the paper's Fig. 6.
 */
export default function IopManualPicker({ imageUrl, imageWidth, imageHeight, onSubmit, autoFailure }: IopManualPickerProps) {
  const [points, setPoints] = useState<Point[]>([]);
  const [side, setSide] = useState<EyeSideLabel>('unknown');
  const complete = points.length === MANUAL_POINT_ORDER.length;
  const nextLabel = complete ? 'All points placed' : MANUAL_POINT_ORDER[points.length].label;

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (complete) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * imageWidth;
    const y = ((event.clientY - box.top) / box.height) * imageHeight;
    setPoints((previous) => [...previous, { x, y }]);
  };

  const submit = () => {
    const entries = MANUAL_POINT_ORDER.map(({ key }, i) => [key, points[i]]);
    onSubmit(Object.fromEntries(entries) as ManualEyePoints, side);
  };

  return (
    <div className="rounded-xl bg-slate-800/60 border border-slate-700/80 p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-white font-semibold">Mark the eye by hand</h2>
          {autoFailure && (
            <p className="text-amber-300 text-sm">Automatic detection was not confident: {autoFailure}</p>
          )}
          <p className="text-slate-400 text-sm">
            Step {Math.min(points.length + 1, MANUAL_POINT_ORDER.length)}/{MANUAL_POINT_ORDER.length}:{' '}
            <span className="text-blue-400">{nextLabel}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={side}
            onChange={(event) => setSide(event.target.value as EyeSideLabel)}
            className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm text-slate-200"
            aria-label="Which eye"
          >
            <option value="unknown">Eye side not recorded</option>
            <option value="right">Right eye (subject)</option>
            <option value="left">Left eye (subject)</option>
          </select>
          <button type="button" onClick={() => setPoints((p) => p.slice(0, -1))} disabled={!points.length}
            className="px-3 py-1 rounded bg-slate-700 text-sm text-slate-200 disabled:opacity-40 hover:bg-slate-600 transition">
            Undo
          </button>
          <button type="button" onClick={submit} disabled={!complete}
            className="px-3 py-1 rounded bg-blue-600 text-sm text-white disabled:opacity-40 hover:bg-blue-500 transition">
            Analyse
          </button>
        </div>
      </div>
      <div className="relative w-full cursor-crosshair select-none" onClick={handleClick}>
        {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
        <img src={imageUrl} alt="Uploaded eye" className="w-full h-auto rounded" draggable={false} />
        {points.map((point, i) => (
          <span
            key={i}
            className="absolute w-3 h-3 -ml-1.5 -mt-1.5 rounded-full bg-blue-500 border border-white text-[10px] leading-3 text-center text-white"
            style={{ left: `${(point.x / imageWidth) * 100}%`, top: `${(point.y / imageHeight) * 100}%` }}
            title={MANUAL_POINT_ORDER[i].label}
          />
        ))}
      </div>
    </div>
  );
}
