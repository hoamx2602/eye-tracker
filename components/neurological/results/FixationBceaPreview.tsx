'use client';

import React, { useMemo, useState } from 'react';
import { useReplayControls, ReplayControlsBar } from './ReplayControls';
import { computeBceaForSamples } from '@/lib/bivariateEllipse';
import { detectAndMapGazeToViewport } from '@/lib/visualSearchGazeCoords';
import {
  RESULT_VIZ_OUTER,
  ResultVizAspectSvg,
  ResultVizMaxFrame,
  useResultVizInnerFrameStyle,
} from './resultVizLayout';
import { GazeHeatmapLayer, GazePathDirectionArrows } from './gazeVizSvg';
import { useNeurologicalResultsViewOptions } from './neuroResultsViewOptions';

type Sample = { t: number; x: number; y: number };

type Props = {
  gazeSamples: Sample[];
  viewportWidth?: number;
  viewportHeight?: number;
  bcea68Px2?: number;
  bcea95Px2?: number;
  startTime?: number;
  endTime?: number;
  durationMs?: number;
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
        Bivariate Contour Ellipse Area (BCEA) from covariance (x, y). Cyan = 95%, green = 68%; gray = gaze (subsample).
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
  viewportWidth: viewportWidthProp,
  viewportHeight: viewportHeightProp,
  bcea68Px2,
  bcea95Px2,
  startTime,
  endTime,
  durationMs,
  visualOnly,
}: Props) {
  const innerFrame = useResultVizInnerFrameStyle();
  const { showStimulusReplay, showGazeHeatmap } = useNeurologicalResultsViewOptions();

  const vwScreen = viewportWidthProp ?? 1920;
  const vhScreen = viewportHeightProp ?? 1080;

  const durationSec = useMemo(() => {
    if (durationMs != null && durationMs > 0) return durationMs / 1000;
    if (
      startTime != null &&
      endTime != null &&
      Number.isFinite(startTime) &&
      Number.isFinite(endTime) &&
      endTime >= startTime
    ) {
      return (endTime - startTime) / 1000;
    }
    const s = gazeSamples ?? [];
    if (!s.length) return 0;
    return Math.max(0, ...s.map((x) => x.t));
  }, [durationMs, startTime, endTime, gazeSamples]);

  const { effectiveReplay, playing, speed, setSpeed, toggle, handleScrub } = useReplayControls(durationSec);

  const filteredSamples = useMemo(() => {
    const all = gazeSamples ?? [];
    return all.filter((s) => s.t <= effectiveReplay + 1e-4);
  }, [gazeSamples, effectiveReplay]);

  const layout = useMemo(() => {
    const raw = filteredSamples;
    if (raw.length < 1) {
      const pad = 200;
      const cx = vwScreen / 2;
      const cy = vhScreen / 2;
      return {
        kind: 'empty' as const,
        vx0: cx - pad,
        vy0: cy - pad,
        vw: pad * 2,
        vh: pad * 2,
        drawPts: [] as { x: number; y: number }[],
        b68ellipse: null,
        b95ellipse: null,
        area68: bcea68Px2 ?? 0,
        area95: bcea95Px2 ?? 0,
      };
    }

    const { mode } = detectAndMapGazeToViewport(raw, vwScreen, vhScreen);
    const mapPt = (p: Sample): Sample => {
      if (mode === 'normalized01') return { ...p, x: p.x * vwScreen, y: p.y * vhScreen };
      if (mode === 'percent100') return { ...p, x: (p.x / 100) * vwScreen, y: (p.y / 100) * vhScreen };
      return p;
    };
    const mapped = raw.map(mapPt);
    const xy = mapped.map((s) => ({ x: s.x, y: s.y }));

    if (xy.length < 2) {
      const p = xy[0];
      const pad = 80;
      const vx0 = p.x - pad;
      const vy0 = p.y - pad;
      const vw = pad * 2;
      const vh = pad * 2;
      const toLocal = (x: number, y: number) => ({ x: x - vx0, y: y - vy0 });
      return {
        kind: 'sparse' as const,
        vx0,
        vy0,
        vw,
        vh,
        drawPts: [toLocal(p.x, p.y)],
        b68ellipse: null,
        b95ellipse: null,
        area68: bcea68Px2 ?? 0,
        area95: bcea95Px2 ?? 0,
      };
    }

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
      kind: 'full' as const,
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
      area68: b68.areaPx2,
      area95: b95.areaPx2,
    };
  }, [filteredSamples, bcea68Px2, bcea95Px2, vwScreen, vhScreen]);

  const totalSamples = gazeSamples?.length ?? 0;

  if (!gazeSamples?.length) {
    return <p className="text-slate-500 text-sm">No gaze samples for fixation.</p>;
  }

  if (!layout) {
    return <p className="text-slate-500 text-sm">Could not build fixation layout.</p>;
  }

  const pointsStr = layout.drawPts.map((p) => `${p.x},${p.y}`).join(' ');
  const fixationCenterLocal = {
    x: vwScreen / 2 - layout.vx0,
    y: vhScreen / 2 - layout.vy0,
  };

  const svgBlock = (
    <ResultVizMaxFrame>
      <ResultVizAspectSvg
        contentWidth={layout.vw}
        contentHeight={layout.vh}
        panelFill="rgb(15 23 42 / 0.5)"
        role="img"
        aria-label="Fixation gaze replay and BCEA ellipses"
      >
        {showStimulusReplay && (
          <g aria-hidden>
            <line
              x1={fixationCenterLocal.x - 10}
              y1={fixationCenterLocal.y}
              x2={fixationCenterLocal.x + 10}
              y2={fixationCenterLocal.y}
              stroke="rgb(148 163 184 / 0.5)"
              strokeWidth="1.5"
            />
            <line
              x1={fixationCenterLocal.x}
              y1={fixationCenterLocal.y - 10}
              x2={fixationCenterLocal.x}
              y2={fixationCenterLocal.y + 10}
              stroke="rgb(148 163 184 / 0.5)"
              strokeWidth="1.5"
            />
          </g>
        )}
        {layout.kind === 'full' && layout.b95ellipse && (
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
        {layout.kind === 'full' && layout.b68ellipse && (
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
        {showGazeHeatmap && <GazeHeatmapLayer points={layout.drawPts} />}
        {layout.drawPts.length >= 2 && (
          <>
            <polyline
              fill="none"
              stroke="rgb(148 163 184 / 0.45)"
              strokeWidth={2}
              vectorEffect="nonScalingStroke"
              points={pointsStr}
            />
            <GazePathDirectionArrows points={layout.drawPts} step={12} fill="rgb(125 211 252)" size={5} />
          </>
        )}
        {layout.drawPts.length === 1 && (
          <circle
            cx={layout.drawPts[0].x}
            cy={layout.drawPts[0].y}
            r={5}
            fill="rgb(125 211 252 / 0.9)"
            stroke="rgb(15 23 42)"
            strokeWidth={1}
            vectorEffect="nonScalingStroke"
          />
        )}
      </ResultVizAspectSvg>
    </ResultVizMaxFrame>
  );

  if (visualOnly) {
    return (
      <div className={RESULT_VIZ_OUTER}>
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div
            className={`${innerFrame.className} relative flex min-h-0 flex-col overflow-hidden`}
            style={innerFrame.style}
          >
            <p className="pointer-events-none absolute left-0 right-0 top-2 z-10 px-3 text-center text-[10px] text-slate-500">
              <span className="text-slate-400">Scrub the slider to replay gaze.</span> BCEA ellipse uses samples up to that time. Full metrics in{' '}
              <strong>Parameters</strong>.
            </p>
            <div className="flex min-h-0 flex-1 flex-col gap-2 px-2 pb-2 pt-9 sm:px-3">
              <div className="min-h-0 flex-1 overflow-hidden">{svgBlock}</div>
            </div>
          </div>
        </div>
        {durationSec > 0 && (
          <ReplayControlsBar
            effectiveReplay={effectiveReplay}
            durationSec={durationSec}
            playing={playing}
            speed={speed}
            onToggle={toggle}
            onScrub={handleScrub}
            onSpeedChange={setSpeed}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <FixationParamsSection area68={layout.area68} area95={layout.area95} />
      {svgBlock}
      <p className="text-xs text-slate-500">
        {totalSamples} samples · BCEA in the chart reflects samples up to the replay slider (may differ from summary totals before scrubbing to the end).
      </p>
    </div>
  );
}
