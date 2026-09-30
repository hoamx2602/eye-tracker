'use client';

import React, { useMemo } from 'react';
import type { EyeAnalysis, RgbImage } from '@/lib/iop/types';
import { deriveViz } from '@/lib/iop/viz/derived';
import { displayEye } from '@/lib/iop/viz/display';
import { rgbCss } from '@/lib/iop/viz/palette';
import { pipelineTiles } from '@/lib/iop/viz/pipelineTiles';
import { reportBlocks, type BlockExtra } from '@/lib/iop/viz/reportBlocks';
import { REGION_LEGEND, segmentationTiles } from '@/lib/iop/viz/segmentationTiles';
import FeatureDistributionChart from './FeatureDistributionChart';
import NotebookBlock from './NotebookBlock';
import { FormulaCell } from './NotebookCells';
import RadialProfileChart from './RadialProfileChart';
import RedLeadHistogram from './RedLeadHistogram';
import { downloadReport } from './renderTile';

interface IopVisualizationsProps {
  eye: EyeAnalysis;
  /** The uploaded photo, so figures can be drawn at its resolution. */
  source: RgbImage;
  /** Used in download file names, e.g. the uploaded image's name. */
  imageName: string;
}

function RegionLegend() {
  return (
    <ul className="flex flex-wrap gap-4 text-xs text-slate-300" aria-label="Region colours">
      {REGION_LEGEND.map(({ name, colour }) => (
        <li key={name} className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: rgbCss(colour) }} />
          {name}
        </li>
      ))}
    </ul>
  );
}

function Extra({ kind, eye }: { kind: BlockExtra; eye: EyeAnalysis }) {
  switch (kind) {
    case 'formulas': return <FormulaCell />;
    case 'red-lead-chart': return <RedLeadHistogram eye={eye} />;
    case 'radial-chart': return <RadialProfileChart eye={eye} />;
    case 'classes-chart': return <FeatureDistributionChart features={eye.features} />;
    case 'region-legend': return <RegionLegend />;
  }
}

/**
 * The analysis of one eye as a notebook: numbered blocks, in the order the
 * analysis notebook runs, each with its figures and printed values.
 */
export default function IopVisualizations({ eye, source, imageName }: IopVisualizationsProps) {
  const blocks = useMemo(() => {
    const view = displayEye(source, eye);
    const derived = deriveViz(view);
    const tiles = new Map([...segmentationTiles(view, derived), ...pipelineTiles(view)].map((tile) => [tile.id, tile]));
    return reportBlocks(view, derived, tiles);
  }, [source, eye]);
  const filePrefix = `iop-${imageName.replace(/\.[^.]+$/, '').replace(/[^a-z0-9-]+/gi, '_')}-${eye.side}`;

  return (
    <section className="space-y-6" aria-label="Visualisations">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <nav aria-label="Blocks" className="flex flex-1 flex-wrap gap-2">
          {blocks.map((block, k) => (
            <a key={block.id} href={`#iop-block-${block.id}`}
              className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 transition duration-150 ease-out hover:border-blue-500 hover:text-white">
              <span className="font-mono text-blue-400">{k + 1}</span> {block.title}
            </a>
          ))}
        </nav>
        <button type="button" onClick={() => downloadReport(blocks, `IOP analysis · ${imageName}`, `${filePrefix}-report.png`)}
          className="shrink-0 rounded bg-slate-700 px-3 py-1.5 text-sm text-slate-100 transition duration-150 ease-out hover:bg-slate-600">
          Download report (PNG)
        </button>
      </div>
      {blocks.map((block, k) => (
        <NotebookBlock key={block.id} block={block} number={k + 1} filePrefix={filePrefix}>
          {block.extras?.map((kind) => <Extra key={kind} kind={kind} eye={eye} />)}
        </NotebookBlock>
      ))}
    </section>
  );
}
