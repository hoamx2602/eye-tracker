'use client';

import React, { useMemo, useState } from 'react';
import type { EyeAnalysis, RgbImage } from '@/lib/iop/types';
import { displayEye } from '@/lib/iop/viz/display';
import { pipelineTiles } from '@/lib/iop/viz/pipelineTiles';
import { segmentationTiles } from '@/lib/iop/viz/segmentationTiles';
import FeatureDistributionChart from './FeatureDistributionChart';
import RadialProfileChart from './RadialProfileChart';
import RedLeadHistogram from './RedLeadHistogram';
import { downloadFigure } from './renderTile';
import VizTileGrid from './VizTileGrid';

type Tab = 'segmentation' | 'pipeline' | 'measurements';

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'segmentation', label: 'Segmentation', hint: 'Each region the features are measured on, as in the analysis notebook.' },
  { id: 'pipeline', label: 'Pipeline', hint: 'Every processing step from the crop to the active contour, in order.' },
  { id: 'measurements', label: 'Measurements', hint: 'How the numbers arise, and where they sit against the paper.' },
];

interface IopVisualizationsProps {
  eye: EyeAnalysis;
  /** The uploaded photo, so tiles can be drawn at its resolution. */
  source: RgbImage;
  /** Used in download file names, e.g. the uploaded image's name. */
  imageName: string;
}

/** Visual evidence for one analysed eye: segmentation, pipeline steps and measurement charts. */
export default function IopVisualizations({ eye, source, imageName }: IopVisualizationsProps) {
  const [tab, setTab] = useState<Tab>('segmentation');
  const view = useMemo(() => displayEye(source, eye), [source, eye]);
  const segmentation = useMemo(() => segmentationTiles(view), [view]);
  const pipeline = useMemo(() => pipelineTiles(view), [view]);
  const filePrefix = `iop-${imageName.replace(/\.[^.]+$/, '').replace(/[^a-z0-9-]+/gi, '_')}-${eye.side}`;
  const figureTiles = tab === 'pipeline' ? pipeline : segmentation;

  return (
    <section className="space-y-4" aria-label="Visualisations">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" className="inline-flex rounded-lg border border-slate-700 bg-slate-900/60 p-1">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`px-3 py-1.5 text-sm rounded-md transition duration-150 ease-out ${
                tab === id ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {tab !== 'measurements' && (
          <button
            type="button"
            onClick={() => downloadFigure(figureTiles, `${TABS.find((t) => t.id === tab)?.label} · ${imageName}`, `${filePrefix}-${tab}-figure.png`)}
            className="px-3 py-1.5 rounded bg-slate-700 text-sm text-slate-100 hover:bg-slate-600 transition duration-150 ease-out"
          >
            Download figure (PNG)
          </button>
        )}
      </div>
      <p className="text-xs text-slate-400">{TABS.find((t) => t.id === tab)?.hint}</p>

      {tab === 'segmentation' && <VizTileGrid tiles={segmentation} filePrefix={filePrefix} showRegionLegend />}
      {tab === 'pipeline' && <VizTileGrid tiles={pipeline} filePrefix={filePrefix} />}
      {tab === 'measurements' && (
        <div className="space-y-4">
          <FeatureDistributionChart features={eye.features} />
          <div className="grid gap-4 lg:grid-cols-2">
            <RadialProfileChart eye={eye} />
            <RedLeadHistogram eye={eye} />
          </div>
        </div>
      )}
    </section>
  );
}
