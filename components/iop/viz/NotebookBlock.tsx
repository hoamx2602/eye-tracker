'use client';

import React from 'react';
import type { ReportBlock } from '@/lib/iop/viz/reportBlocks';
import { OutputCell } from './NotebookCells';
import VizTileCard from './VizTileCard';

interface NotebookBlockProps {
  block: ReportBlock;
  number: number;
  filePrefix: string;
  /** Formulas, charts or a legend placed between the figures and the output. */
  children?: React.ReactNode;
}

const COLUMNS: Record<number, string> = {
  1: 'grid-cols-1 max-w-3xl',
  2: 'grid-cols-1 md:grid-cols-2',
  3: 'grid-cols-1 md:grid-cols-3',
};

/**
 * One step of the analysis, laid out like a notebook cell group: a numbered
 * heading and explanation, the figures large, extras, then printed values.
 */
export default function NotebookBlock({ block, number, filePrefix, children }: NotebookBlockProps) {
  const { id, title, description, figures, outputs } = block;
  return (
    <section id={`iop-block-${id}`} className="scroll-mt-4 space-y-3 border-t border-slate-700/70 pt-6 first:border-t-0 first:pt-0">
      <header className="flex items-baseline gap-3">
        <span className="font-mono text-sm text-blue-400">[{number}]</span>
        <div>
          <h3 className="text-lg font-bold tracking-tight text-white">{title}</h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">{description}</p>
        </div>
      </header>
      {figures.length > 0 && (
        <div className={`grid gap-3 ${COLUMNS[Math.min(3, figures.length)]}`}>
          {figures.map((tile, k) => (
            <VizTileCard key={tile.id} tile={tile} label={`Fig. ${number}${figures.length > 1 ? String.fromCharCode(97 + k) : ''}`} filePrefix={filePrefix} />
          ))}
        </div>
      )}
      {children}
      <OutputCell lines={outputs} />
    </section>
  );
}
