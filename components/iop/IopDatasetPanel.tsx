'use client';

import React from 'react';
import { downloadCsv, type IopDatasetRow } from '@/lib/iop/dataset';

interface IopDatasetPanelProps {
  rows: IopDatasetRow[];
  persisted: boolean;
  onClear: () => void;
}

/** Collected rows, CSV export and a reset. */
export default function IopDatasetPanel({ rows, persisted, onClear }: IopDatasetPanelProps) {
  const counts = rows.reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.label]: (acc[row.label] ?? 0) + 1 }), {});

  return (
    <section className="rounded-xl bg-slate-800/60 border border-slate-700/80 p-6 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-white">Dataset in this browser</h2>
          <p className="text-sm text-slate-400">
            {rows.length} rows · normal {counts.normal ?? 0} · high {counts.high ?? 0} · unlabelled {counts.unknown ?? 0}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={!rows.length} onClick={() => downloadCsv(rows)}
            className="px-3 py-1.5 rounded bg-blue-600 text-sm text-white disabled:opacity-40 hover:bg-blue-500 transition">
            Export CSV
          </button>
          <button type="button" disabled={!rows.length} onClick={onClear}
            className="px-3 py-1.5 rounded bg-slate-700 text-sm text-slate-200 disabled:opacity-40 hover:bg-red-600 transition">
            Clear
          </button>
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Stored only in this browser&apos;s local storage{persisted ? '' : ' (unavailable here - export before leaving)'}. Export regularly;
        clearing site data deletes the rows.
      </p>
    </section>
  );
}
