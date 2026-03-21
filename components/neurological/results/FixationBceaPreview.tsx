'use client';

import React, { useMemo } from 'react';
import { computeBceaForSamples } from '@/lib/bivariateEllipse';
import { ResultVizAspectSvg, ResultVizMaxFrame } from './resultVizLayout';

type Sample = { t: number; x: number; y: number };

type Props = {
  gazeSamples: Sample[];
  viewportWidth?: number;
  viewportHeight?: number;
  bcea68Px2?: number;
  bcea95Px2?: number;
  visualOnly?: boolean;
};

export function FixationParamsSection({ area68, area95 }: { area68: number; area95: number }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 text-sm text-slate-300">
        <span>
          BCEA 68%:{' '}
          <span className="font-mono text-emerald-400">{area68.toFixed(0)} px²</span>
        </span>
        <span>
          BCEA 95%:{' '}
          <span className="font-mono text-sky-400">{area95.toFixed(0)} px²</span>
        </span>
      </div>
      <p className="text-xs text-slate-500 leading-relaxed">
        Bivariate Contour Ellipse Area (BCEA) từ hiệp phương sai (x, y). Cyan = 95%, xanh = 68%; xám = gaze (subsample).
      </p>
    </div>
  );
}

/** Downsample for drawing when many points */
function subsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) {
    out.push(arr[Math.min(arr.length - 1, Math.floor(i * step))]);
  }
  return out;
}

export default function FixationBceaPreview({
  gazeSamples,
  viewportWidth: _viewportWidth,
  viewportHeight: _viewportHeight,
  bcea68Px2,
  bcea95Px2,
  visualOnly,
}: Props) {
  const layout = useMemo(() => {
    const samples = gazeSamples ?? [];
    if (samples.length < 2) return null;
    const xy = samples.map((s) => ({ x: s.x, y: s.y }));
    const b68 = computeBceaForSamples(xy, '68');
    const b95 = computeBceaForSamples(xy, '95');
    const pad = 40;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of xy) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    if (b95.ellipse) {
      const { centerX, centerY, semiMajorPx, semiMinorPx, rotationRad } = b95.ellipse;
      const c = Math.cos(rotationRad);
      const s = Math.sin(rotationRad);
      const ext = Math.hypot(semiMajorPx * c, semiMajorPx * s) + Math.hypot(semiMinorPx * s, semiMinorPx * c);
      minX = Math.min(minX, centerX - ext);
      maxX = Math.max(maxX, centerX + ext);
      minY = Math.min(minY, centerY - ext);
      maxY = Math.max(maxY, centerY + ext);
    }
    const vx0 = minX - pad;
    const vy0 = minY - pad;
    const vw = Math.max(maxX - minX + pad * 2, 120);
    const vh = Math.max(maxY - minY + pad * 2, 120);
    const toLocal = (x: number, y: number) => ({ x: x - vx0, y: y - vy0 });
    const drawPts = subsample(xy, 2500).map((p) => toLocal(p.x, p.y));
    const rotDeg = (r: number) => (r * 180) / Math.PI;

    return {
      vx0,
      vy0,
      vw,
      vh,
      drawPts,
      b68ellipse: b68.ellipse
        ? {
            ...b68.ellipse,
            cx: toLocal(b68.ellipse.centerX, b68.ellipse.centerY).x,
            cy: toLocal(b68.ellipse.centerX, b68.ellipse.centerY).y,
            rotDeg: rotDeg(b68.ellipse.rotationRad),
          }
        : null,
      b95ellipse: b95.ellipse
        ? {
            ...b95.ellipse,
            cx: toLocal(b95.ellipse.centerX, b95.ellipse.centerY).x,
            cy: toLocal(b95.ellipse.centerX, b95.ellipse.centerY).y,
            rotDeg: rotDeg(b95.ellipse.rotationRad),
          }
        : null,
      area68: bcea68Px2 ?? b68.areaPx2,
      area95: bcea95Px2 ?? b95.areaPx2,
    };
  }, [gazeSamples, bcea68Px2, bcea95Px2]);

  if (!layout) {
    return <p className="text-slate-500 text-sm">Not enough gaze samples for BCEA.</p>;
  }

  const pointsStr = layout.drawPts.map((p) => `${p.x},${p.y}`).join(' ');

  const svgBlock = (
    <ResultVizMaxFrame>
      <ResultVizAspectSvg
        contentWidth={layout.vw}
        contentHeight={layout.vh}
        panelFill="rgb(15 23 42 / 0.5)"
        role="img"
        aria-label="Fixation gaze points and BCEA ellipses"
      >
        {layout.b95ellipse && (
          <ellipse
            cx={layout.b95ellipse.cx}
            cy={layout.b95ellipse.cy}
            rx={layout.b95ellipse.semiMajorPx}
            ry={layout.b95ellipse.semiMinorPx}
            fill="none"
            stroke="rgb(56 189 248 / 0.45)"
            strokeWidth="2"
            transform={`rotate(${layout.b95ellipse.rotDeg}, ${layout.b95ellipse.cx}, ${layout.b95ellipse.cy})`}
          />
        )}
        {layout.b68ellipse && (
          <ellipse
            cx={layout.b68ellipse.cx}
            cy={layout.b68ellipse.cy}
            rx={layout.b68ellipse.semiMajorPx}
            ry={layout.b68ellipse.semiMinorPx}
            fill="none"
            stroke="rgb(52 211 153 / 0.7)"
            strokeWidth="2"
            transform={`rotate(${layout.b68ellipse.rotDeg}, ${layout.b68ellipse.cx}, ${layout.b68ellipse.cy})`}
          />
        )}
        <polyline
          fill="none"
          stroke="rgb(148 163 184 / 0.35)"
          strokeWidth="1"
          points={pointsStr}
        />
      </ResultVizAspectSvg>
    </ResultVizMaxFrame>
  );

  if (visualOnly) {
    return svgBlock;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <FixationParamsSection area68={layout.area68} area95={layout.area95} />
      {svgBlock}
    </div>
  );
}
