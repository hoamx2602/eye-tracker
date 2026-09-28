'use client';

import React from 'react';
import { FEATURE_LABELS, PAPER_TABLE4 } from '@/lib/iop/classifier';
import { FEATURE_ORDER, type IopFeatures } from '@/lib/iop/types';

interface IopFeatureTableProps {
  features: IopFeatures;
}

/** Which paper class mean a value is nearer to, in units of that class's STD. */
function nearerClass(key: keyof IopFeatures, value: number): 'normal' | 'high' {
  const { normal, high } = PAPER_TABLE4[key];
  return Math.abs(value - normal.mean) / normal.std <= Math.abs(value - high.mean) / high.std ? 'normal' : 'high';
}

const range = (mean: number, std: number) => `${mean.toFixed(2)} ± ${std.toFixed(2)}`;

/** The five features beside the paper's Table 4 class statistics. */
export default function IopFeatureTable({ features }: IopFeatureTableProps) {
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-slate-700 text-xs text-slate-400 uppercase tracking-wider">
          <th className="py-2 pr-2 font-medium">Feature</th>
          <th className="py-2 pr-2 font-medium">Value</th>
          <th className="py-2 pr-2 font-medium">Paper normal</th>
          <th className="py-2 pr-2 font-medium">Paper high</th>
          <th className="py-2 font-medium">Nearer</th>
        </tr>
      </thead>
      <tbody>
        {FEATURE_ORDER.map((key) => {
          const value = features[key];
          const { normal, high } = PAPER_TABLE4[key];
          const nearer = Number.isFinite(value) ? nearerClass(key, value) : null;
          return (
            <tr key={key} className="border-b border-slate-700/60">
              <td className="py-2 pr-2 text-slate-200">{FEATURE_LABELS[key]}</td>
              <td className="py-2 pr-2 font-mono text-white">{Number.isFinite(value) ? value.toFixed(4) : '—'}</td>
              <td className="py-2 pr-2 font-mono text-slate-400">{range(normal.mean, normal.std)}</td>
              <td className="py-2 pr-2 font-mono text-slate-400">{range(high.mean, high.std)}</td>
              <td className={`py-2 ${nearer === 'high' ? 'text-amber-400' : 'text-slate-400'}`}>{nearer ?? '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
