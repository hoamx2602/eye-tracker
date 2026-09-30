'use client';

import React from 'react';
import type { VizTile } from '@/lib/iop/viz/draw';
import { REGION_LEGEND } from '@/lib/iop/viz/segmentationTiles';
import { rgbCss } from '@/lib/iop/viz/palette';
import VizTileCard from './VizTileCard';

interface VizTileGridProps {
  tiles: VizTile[];
  filePrefix: string;
  showRegionLegend?: boolean;
}

/** Tiles in a responsive grid, with the region colour key where regions are shown. */
export default function VizTileGrid({ tiles, filePrefix, showRegionLegend = false }: VizTileGridProps) {
  return (
    <div className="space-y-3">
      {showRegionLegend && (
        <ul className="flex flex-wrap gap-4 text-xs text-slate-300" aria-label="Region colours">
          {REGION_LEGEND.map(({ name, colour }) => (
            <li key={name} className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ background: rgbCss(colour) }} />
              {name}
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((tile, k) => (
          <VizTileCard key={tile.id} tile={tile} letter={String.fromCharCode(97 + k)} filePrefix={filePrefix} />
        ))}
      </div>
    </div>
  );
}
