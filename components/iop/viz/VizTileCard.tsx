'use client';

import React, { useEffect, useRef } from 'react';
import type { VizTile } from '@/lib/iop/viz/draw';
import { downloadCanvas, renderTile } from './renderTile';

interface VizTileCardProps {
  tile: VizTile;
  /** Figure label, e.g. "Fig. 5a". */
  label: string;
  filePrefix: string;
}

/** One visualisation panel with its caption and a PNG download. */
export default function VizTileCard({ tile, label, filePrefix }: VizTileCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) renderTile(canvasRef.current, tile);
  }, [tile]);

  return (
    <figure className="rounded-lg border border-slate-700/80 bg-slate-900/60 p-2 flex flex-col gap-2">
      <canvas ref={canvasRef} className="w-full h-auto rounded bg-black" aria-label={tile.title} role="img" />
      <figcaption className="flex-1 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-semibold text-slate-100">
            <span className="text-slate-400">{label}</span> · {tile.title}
          </span>
          <button
            type="button"
            onClick={() => canvasRef.current && downloadCanvas(canvasRef.current, `${filePrefix}-${tile.id}.png`)}
            className="shrink-0 text-xs text-slate-400 hover:text-white transition duration-150 ease-out"
            aria-label={`Download ${tile.title} as PNG`}
          >
            PNG ↓
          </button>
        </div>
        <p className="text-xs leading-5 text-slate-400">{tile.caption}</p>
      </figcaption>
    </figure>
  );
}
