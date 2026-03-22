'use client';

import React, { useMemo } from 'react';
import type { AntiSaccadeTrialResult } from '../tests/antiSaccade/AntiSaccadeTest';
import type { AntiSaccadeDirection } from '../tests/antiSaccade/constants';
import { TRAVEL_DISTANCE_PX } from '../tests/antiSaccade/constants';
import { dimPosition, primaryPosition } from '../tests/antiSaccade/utils';
import { RESULT_VIZ_OUTER, ResultVizAspectSvg, ResultVizMaxFrame, useResultVizInnerFrameStyle } from './resultVizLayout';
import { GazeHeatmapLayer, GazePathDirectionArrows } from './gazeVizSvg';
import { useNeurologicalResultsViewOptions } from './neuroResultsViewOptions';

const EDGE_MARGIN_PX = 24;

function isHorizontalDirection(d: AntiSaccadeDirection): boolean {
  return d === 'left' || d === 'right';
}

function getTravelToEdges(vw: number, vh: number): { travelX: number; travelY: number } {
  const cx = vw / 2;
  const cy = vh / 2;
  const travelX = Math.max(TRAVEL_DISTANCE_PX, Math.min(cx - EDGE_MARGIN_PX, vw - cx - EDGE_MARGIN_PX));
  const travelY = Math.max(TRAVEL_DISTANCE_PX, Math.min(cy - EDGE_MARGIN_PX, vh - cy - EDGE_MARGIN_PX));
  return { travelX, travelY };
}

type Props = {
  trials: AntiSaccadeTrialResult[];
  viewportWidth?: number;
  viewportHeight?: number;
  visualOnly?: boolean;
};

const R = 38;
const CX = 50;
const CY = 50;

function polarLine(deg: number | undefined, color: string, strokeWidth: number) {
  if (deg === undefined || !Number.isFinite(deg)) return null;
  const rad = (deg * Math.PI) / 180;
  const x2 = CX + R * Math.cos(rad);
  const y2 = CY + R * Math.sin(rad);
  return (
    <line
      x1={CX}
      y1={CY}
      x2={x2}
      y2={y2}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
    />
  );
}

function MiniCompass({
  targetDeg,
  gazeDeg,
}: {
  targetDeg: number | undefined;
  gazeDeg: number | undefined;
}) {
  return (
    <svg viewBox="0 0 100 100" className="h-28 w-28 shrink-0 rounded-lg border border-gray-700 bg-gray-900/80 sm:h-32 sm:w-32">
      <circle cx={CX} cy={CY} r={3} fill="rgb(148 163 184)" />
      {polarLine(targetDeg, 'rgb(52 211 153)', 3)}
      {polarLine(gazeDeg, 'rgb(251 191 36)', 2)}
    </svg>
  );
}

/** Trial table + legend — parameters drawer. */
export function AntiSaccadeParamsSection({ trials }: { trials: AntiSaccadeTrialResult[] }) {
  if (!trials?.length) {
    return <p className="text-slate-500 text-sm">No anti-saccade trials.</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 leading-relaxed">
        Green = hướng target (dim); amber = mean gaze. Góc màn hình: 0° = phải, 90° = xuống.
      </p>
      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="w-full min-w-[280px] text-left text-xs text-slate-300">
          <thead className="bg-gray-900/80 text-slate-400">
            <tr>
              <th className="px-2 py-2 font-medium">#</th>
              <th className="px-2 py-2 font-medium">Dir</th>
              <th className="px-2 py-2 font-medium">Target°</th>
              <th className="px-2 py-2 font-medium">Gaze°</th>
              <th className="px-2 py-2 font-medium">Δ°</th>
            </tr>
          </thead>
          <tbody>
            {trials.map((t, i) => (
              <tr key={`${t.startTime}-${i}`} className="border-t border-gray-800">
                <td className="px-2 py-1.5 font-mono text-slate-500">{i + 1}</td>
                <td className="px-2 py-1.5 font-medium uppercase">{t.direction}</td>
                <td className="px-2 py-1.5 font-mono text-emerald-400">
                  {t.targetDirectionDeg != null ? t.targetDirectionDeg.toFixed(0) : '—'}
                </td>
                <td className="px-2 py-1.5 font-mono text-amber-300">
                  {t.gazeDirectionDeg != null ? t.gazeDirectionDeg.toFixed(0) : '—'}
                </td>
                <td className="px-2 py-1.5 font-mono text-slate-200">
                  {t.angularErrorDeg != null
                    ? `${t.angularErrorDeg > 0 ? '+' : ''}${t.angularErrorDeg.toFixed(0)}`
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Gaze paths (screen px) + optional stimulus endpoints; compasses per trial — table in parameters drawer when split.
 */
export default function AntiSaccadeGazeDirectionPreview({
  trials,
  viewportWidth,
  viewportHeight,
  visualOnly,
}: Props) {
  const innerFrame = useResultVizInnerFrameStyle();
  const { showStimulusReplay, showGazeHeatmap } = useNeurologicalResultsViewOptions();

  const layout = useMemo(() => {
    if (!trials?.length) return null;
    const vw = viewportWidth ?? 1920;
    const vh = viewportHeight ?? 1080;
    const { travelX, travelY } = getTravelToEdges(vw, vh);
    const cx = vw / 2;
    const cy = vh / 2;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const expand = (x: number, y: number) => {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    };
    expand(cx, cy);
    const allHeat: { x: number; y: number }[] = [];
    for (const t of trials) {
      const tp = isHorizontalDirection(t.direction) ? travelX : travelY;
      const pEnd = primaryPosition(t.direction, cx, cy, 1, tp);
      const dEnd = dimPosition(t.direction, cx, cy, 1, tp);
      expand(pEnd.x, pEnd.y);
      expand(dEnd.x, dEnd.y);
      for (const s of t.gazeSamples ?? []) {
        expand(s.x, s.y);
        allHeat.push({ x: s.x, y: s.y });
      }
    }
    const pad = 36;
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;
    const viewW = Math.max(maxX - minX, 320);
    const viewH = Math.max(maxY - minY, 240);
    const loc = (x: number, y: number) => ({ x: x - minX, y: y - minY });
    const localizedHeat = allHeat.map((p) => loc(p.x, p.y));
    return {
      vw,
      vh,
      viewW,
      viewH,
      loc,
      cx,
      cy,
      travelX,
      travelY,
      localizedHeat,
      centerL: loc(cx, cy),
    };
  }, [trials, viewportWidth, viewportHeight]);

  if (!trials?.length) {
    return <p className="text-slate-500 text-sm">No anti-saccade trials.</p>;
  }

  if (!layout) {
    return <p className="text-slate-500 text-sm">No anti-saccade trials.</p>;
  }

  const viewportSvg = (
    <ResultVizMaxFrame>
      <ResultVizAspectSvg
        contentWidth={layout.viewW}
        contentHeight={layout.viewH}
        panelFill="rgb(15 23 42 / 0.4)"
        role="img"
        aria-label="Anti-saccade gaze paths and stimulus layout"
      >
        {showStimulusReplay && (
          <g aria-hidden>
            <circle cx={layout.centerL.x} cy={layout.centerL.y} r={6} fill="rgb(148 163 184 / 0.9)" />
            {trials.map((t, i) => {
              const tp = isHorizontalDirection(t.direction) ? layout.travelX : layout.travelY;
              const pEnd = primaryPosition(t.direction, layout.cx, layout.cy, 1, tp);
              const dEnd = dimPosition(t.direction, layout.cx, layout.cy, 1, tp);
              const pL = layout.loc(pEnd.x, pEnd.y);
              const dL = layout.loc(dEnd.x, dEnd.y);
              return (
                <g key={`stim-${t.startTime}-${i}`} opacity={0.45}>
                  <circle cx={pL.x} cy={pL.y} r={9} fill="rgb(244 63 94 / 0.35)" stroke="rgb(244 63 94 / 0.7)" strokeWidth="1.5" />
                  <circle cx={dL.x} cy={dL.y} r={9} fill="rgb(52 211 153 / 0.3)" stroke="rgb(52 211 153 / 0.75)" strokeWidth="1.5" />
                </g>
              );
            })}
          </g>
        )}
        {showGazeHeatmap && <GazeHeatmapLayer points={layout.localizedHeat} />}
        {trials.map((t, i) => {
          const samples = t.gazeSamples ?? [];
          if (samples.length === 0) return null;
          const pts = samples.map((s) => layout.loc(s.x, s.y));
          const ptsStr = pts.map((p) => `${p.x},${p.y}`).join(' ');
          const hue = (i * 37) % 360;
          return (
            <g key={`path-${t.startTime}-${i}`}>
              <polyline
                fill="none"
                stroke={`hsl(${hue} 65% 58%)`}
                strokeWidth="1.35"
                opacity={0.88}
                points={ptsStr}
              />
              <GazePathDirectionArrows points={pts} step={8} fill={`hsl(${hue} 65% 52%)`} size={5} />
            </g>
          );
        })}
      </ResultVizAspectSvg>
    </ResultVizMaxFrame>
  );

  if (visualOnly) {
    return (
      <div className={RESULT_VIZ_OUTER}>
        <div
          className={`${innerFrame.className} relative flex min-h-0 flex-col overflow-hidden`}
          style={innerFrame.style}
        >
          <p className="pointer-events-none absolute left-0 right-0 top-2 z-10 px-3 text-center text-[10px] text-slate-500">
            Cùng toạ độ màn hình lúc test; đỏ = kích thích sáng, xanh = dim (đích). La bàn từng trial bên dưới — chi tiết trong{' '}
            <strong>Tham số</strong>.
          </p>
          <div className="flex min-h-0 flex-1 flex-col gap-2 px-2 pb-2 pt-9 sm:px-3">
            <div className="min-h-0 flex-1 overflow-hidden">{viewportSvg}</div>
            <div className="flex max-h-[38vh] shrink-0 flex-wrap content-center justify-center gap-3 overflow-y-auto overflow-x-hidden border-t border-gray-800/80 pt-2 sm:gap-4">
              {trials.map((t, i) => (
                <div key={`${t.startTime}-${i}`} className="flex flex-col items-center gap-1">
                  <MiniCompass targetDeg={t.targetDirectionDeg} gazeDeg={t.gazeDirectionDeg} />
                  <span className="font-mono text-[10px] text-slate-500">#{i + 1}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Green = direction to correct target (dim); amber = mean gaze direction during movement. Angles are in screen
        coordinates (0° = right, 90° = down).
      </p>
      <div className="space-y-2 rounded-lg border border-gray-800 p-2 sm:p-3">
        {trials.map((t, i) => (
          <div
            key={`${t.startTime}-${i}`}
            className="flex flex-wrap items-center gap-3 rounded-md bg-gray-900/50 px-2 py-2 text-xs text-slate-300"
          >
            <span className="w-8 font-mono text-slate-500">#{i + 1}</span>
            <span className="rounded bg-slate-800 px-1.5 py-0.5 font-medium text-slate-200">{t.direction}</span>
            <MiniCompass targetDeg={t.targetDirectionDeg} gazeDeg={t.gazeDirectionDeg} />
            <div className="min-w-0 flex-1 font-mono text-[11px] leading-relaxed">
              <div>
                Target:{' '}
                <span className="text-emerald-400">
                  {t.targetDirectionDeg != null ? `${t.targetDirectionDeg.toFixed(0)}°` : '—'}
                </span>
                {' · '}
                Gaze:{' '}
                <span className="text-amber-300">
                  {t.gazeDirectionDeg != null ? `${t.gazeDirectionDeg.toFixed(0)}°` : '—'}
                </span>
              </div>
              <div className="text-slate-500">
                Δ (error):{' '}
                <span className="text-slate-200">
                  {t.angularErrorDeg != null ? `${t.angularErrorDeg > 0 ? '+' : ''}${t.angularErrorDeg.toFixed(0)}°` : '—'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
