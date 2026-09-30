'use client';

import React from 'react';
import type { OutputLine } from '@/lib/iop/viz/reportBlocks';

/** Printed values, styled like a notebook cell's output. */
export function OutputCell({ lines }: { lines: OutputLine[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="flex gap-3 rounded-lg border border-slate-700/80 bg-slate-950/70 px-4 py-3">
      <span className="select-none pt-0.5 font-mono text-xs text-rose-300/80">Out:</span>
      <dl className="space-y-1 font-mono text-sm">
        {lines.map(({ label, value }) => (
          <div key={label} className="flex flex-wrap gap-x-2">
            <dt className="text-slate-400">{label}:</dt>
            <dd className="text-slate-100 tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Fraction({ top, bottom }: { top: React.ReactNode; bottom: React.ReactNode }) {
  return (
    <span className="inline-flex flex-col items-center align-middle leading-tight">
      <span className="border-b border-slate-300 px-1 pb-0.5">{top}</span>
      <span className="px-1 pt-0.5">{bottom}</span>
    </span>
  );
}

/** The RAP and MRL formulas. */
export function FormulaCell() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-lg border border-slate-700/80 bg-slate-900/60 px-4 py-3">
        <p className="text-xs font-semibold text-slate-400">Red Area Percentage (RAP)</p>
        <p className="mt-2 font-serif text-lg text-slate-100">
          RAP = <Fraction top={<>&Sigma;<sub>i</sub> P<sub>i</sub></>} bottom="m" />
        </p>
        <p className="mt-2 text-xs leading-5 text-slate-400">P<sub>i</sub> = 1 for a reddish sclera pixel, m = number of sclera pixels.</p>
      </div>
      <div className="rounded-lg border border-slate-700/80 bg-slate-900/60 px-4 py-3">
        <p className="text-xs font-semibold text-slate-400">Mean Redness Level (MRL)</p>
        <p className="mt-2 font-serif text-lg text-slate-100">
          MRL = <Fraction top="3·M(RPV) − M(GPV) − M(BPV)" bottom="3 × 255" />
        </p>
        <p className="mt-2 text-xs leading-5 text-slate-400">M(·) = mean red, green and blue value over all m sclera pixels.</p>
      </div>
    </div>
  );
}
