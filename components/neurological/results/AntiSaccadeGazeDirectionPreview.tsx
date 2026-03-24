'use client';

import React, { useMemo, useState } from 'react';
import { useReplayControls, ReplayControlsBar } from './ReplayControls';
import type { AntiSaccadeTrialResult } from '../tests/antiSaccade/AntiSaccadeTest';
import type { AntiSaccadeDirection } from '../tests/antiSaccade/constants';
import { TRAVEL_DISTANCE_PX } from '../tests/antiSaccade/constants';
import { dimPosition, primaryPosition } from '../tests/antiSaccade/utils';
import { RESULT_VIZ_OUTER, ResultVizAspectSvg, ResultVizMaxFrame, useResultVizInnerFrameStyle } from './resultVizLayout';
import { GazeHeatmapLayer, GazePathDirectionArrows } from './gazeVizSvg';
import { useNeurologicalResultsViewOptions } from './neuroResultsViewOptions';
import { detectAndMapGazeToViewport } from '@/lib/visualSearchGazeCoords';

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
  /** Giống visual_search: toàn bộ mẫu gaze, `t` (s) từ lúc bắt đầu bài test — lưu kèm payload để replay/debug. */
  scanningPath?: Array<{ t: number; x: number; y: number }>;
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
export function AntiSaccadeParamsSection({
  trials,
  scanningPath,
}: {
  trials: AntiSaccadeTrialResult[];
  scanningPath?: Array<{ t: number; x: number; y: number }>;
}) {
  if (!trials?.length) {
    return <p className="text-slate-500 text-sm">No anti-saccade trials.</p>;
  }

  const samplesPerTrial = trials.reduce((n, t) => n + (t.gazeSamples?.length ?? 0), 0);

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 leading-relaxed">
        Gaze samples: <span className="font-mono text-slate-300">{samplesPerTrial}</span> (total across trials)
        {scanningPath != null ? (
          <>
            {' '}
            · <span className="font-mono text-slate-300">{scanningPath.length}</span> points in{' '}
            <code className="text-slate-400">scanningPath</code> (same shape as Visual Search)
          </>
        ) : null}
      </p>
      <p className="text-xs text-slate-500 leading-relaxed">
        Green = target direction (dim); amber = mean gaze. Screen angle: 0° = right, 90° = down.
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
                    ? `${t.angularErrorDeg > 0 ? '+' : ''}${t.angularErrorDeg.toFixed(0)}°`
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap content-center justify-center gap-3 pt-2 sm:gap-4">
        {trials.map((t, i) => (
          <div key={`${t.startTime}-${i}`} className="flex flex-col items-center gap-1">
            <MiniCompass targetDeg={t.targetDirectionDeg} gazeDeg={t.gazeDirectionDeg} />
            <span className="font-mono text-[10px] text-slate-500">#{i + 1}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Gaze paths (screen px) + optional stimulus endpoints; compasses per trial — table in parameters drawer when split.
 */
export default function AntiSaccadeGazeDirectionPreview({
  trials,
  scanningPath,
  viewportWidth,
  viewportHeight,
  visualOnly,
}: Props) {
  const innerFrame = useResultVizInnerFrameStyle();
  const { showStimulusReplay, showGazeHeatmap } = useNeurologicalResultsViewOptions();

  const durationSec = useMemo(() => {
    if (!trials?.length) return 0;
    const t0 = trials[0].startTime;
    let maxMs = 0;
    for (const t of trials) {
      if (!t.gazeSamples?.length) continue;
      const startMs = t.startTime - t0;
      for (const s of t.gazeSamples) {
        const ms = startMs + s.t * 1000;
        if (ms > maxMs) maxMs = ms;
      }
    }
    return maxMs / 1000;
  }, [trials]);

  const { effectiveReplay, playing, speed, setSpeed, toggle, handleScrub } = useReplayControls(durationSec);

  const filteredTrials = useMemo(() => {
    if (!trials?.length) return [];
    if (effectiveReplay >= durationSec - 0.05) return trials;
    
    const t0 = trials[0].startTime;
    return trials.map((t) => {
      const startSec = (t.startTime - t0) / 1000;
      if (startSec > effectiveReplay) {
        return { ...t, gazeSamples: [] };
      }
      return {
        ...t,
        gazeSamples: (t.gazeSamples ?? []).filter((s) => startSec + s.t <= effectiveReplay),
      };
    });
  }, [trials, effectiveReplay, durationSec]);

  const layout = useMemo(() => {
    if (!trials?.length) return null;
    const vw = viewportWidth ?? 1920;
    const vh = viewportHeight ?? 1080;
    const { travelX, travelY } = getTravelToEdges(vw, vh);
    const cx = vw / 2;
    const cy = vh / 2;
    
    let maxAbsX = 0;
    let maxAbsY = 0;
    const localizedHeat: { x: number; y: number }[] = [];

    // Map all samples to viewport across ALL trials to ensure consistent coordinate mode detection
    const allGazePts = trials.flatMap(t => t.gazeSamples ?? []);
    const { mode } = detectAndMapGazeToViewport(allGazePts, vw, vh);

    const mappedGazeTrials = trials.map(t => {
      if (!t.gazeSamples?.length) {
        return {
          ...t,
          mappedSamples: [] as Array<{ x: number; y: number; t: number }>
        };
      }
      
      const pts = mode === 'normalized01'
        ? t.gazeSamples.map(p => ({ ...p, x: p.x * vw, y: p.y * vh }))
        : mode === 'percent100'
        ? t.gazeSamples.map(p => ({ ...p, x: (p.x / 100) * vw, y: (p.y / 100) * vh }))
        : t.gazeSamples;

      return {
        ...t,
        mappedSamples: pts
      };
    });

    for (const t of mappedGazeTrials) {
      const tp = isHorizontalDirection(t.direction) ? travelX : travelY;
      const pEnd = primaryPosition(t.direction, cx, cy, 1, tp);
      const dEnd = dimPosition(t.direction, cx, cy, 1, tp);
      maxAbsX = Math.max(maxAbsX, Math.abs(pEnd.x - cx), Math.abs(dEnd.x - cx));
      maxAbsY = Math.max(maxAbsY, Math.abs(pEnd.y - cy), Math.abs(dEnd.y - cy));

      for (const s of t.mappedSamples ?? []) {
        maxAbsX = Math.max(maxAbsX, Math.abs(s.x - cx));
        maxAbsY = Math.max(maxAbsY, Math.abs(s.y - cy));
      }
    }

    const pad = 36;
    maxAbsX += pad;
    maxAbsY += pad;
    const viewW = maxAbsX * 2;
    const viewH = maxAbsY * 2;
    // Map screen x/y to our symmetric viewBox, so cx/cy maps to center
    const loc = (x: number, y: number) => ({ x: x - cx + maxAbsX, y: y - cy + maxAbsY });

    for (const t of mappedGazeTrials) {
      for (const s of t.mappedSamples ?? []) {
        localizedHeat.push(loc(s.x, s.y));
      }
    }

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
      mappedGazeTrials,
      centerL: loc(cx, cy),
    };
  }, [trials, viewportWidth, viewportHeight]);

  if (!trials?.length) {
    return <p className="text-slate-500 text-sm">No anti-saccade trials.</p>;
  }

  if (!layout) {
    return <p className="text-slate-500 text-sm">No anti-saccade trials.</p>;
  }

  const totalGazeSamples =
    trials.reduce((n, t) => n + (t.gazeSamples?.length ?? 0), 0) || (scanningPath?.length ?? 0);

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
            {filteredTrials.map((t, i) => {
              const tp = isHorizontalDirection(t.direction) ? layout.travelX : layout.travelY;
              const t0 = trials[0].startTime;
              const startSec = (t.startTime - t0) / 1000;
              const elapsedTrial = effectiveReplay - startSec;

              if (elapsedTrial < 0) return null;

              // Full trial samples — filteredTrials truncates gazeSamples mid-replay; duration must stay the real movement length
              const fullTrial = trials[i];
              const tDur =
                fullTrial.gazeSamples?.length > 0
                  ? fullTrial.gazeSamples[fullTrial.gazeSamples.length - 1].t
                  : 1.5;

              const isRectActive = elapsedTrial <= tDur + 0.2;
              const pRatio = tDur > 0 ? Math.min(1, Math.max(0, elapsedTrial / tDur)) : 1;

              const pEndMoving = primaryPosition(t.direction, layout.cx, layout.cy, pRatio, tp);
              const dEndMoving = dimPosition(t.direction, layout.cx, layout.cy, pRatio, tp);

              const pLM = layout.loc(pEndMoving.x, pEndMoving.y);
              const dLM = layout.loc(dEndMoving.x, dEndMoving.y);

              const pEnd = primaryPosition(t.direction, layout.cx, layout.cy, 1, tp);
              const dEnd = dimPosition(t.direction, layout.cx, layout.cy, 1, tp);
              const pEndL = layout.loc(pEnd.x, pEnd.y);
              const dEndL = layout.loc(dEnd.x, dEnd.y);

              const rectSize = 18;

              return (
                <g key={`stim-${t.startTime}-${i}`}>
                  <circle cx={pEndL.x} cy={pEndL.y} r={9} fill="none" stroke="rgb(244 63 94 / 0.2)" strokeWidth="1" strokeDasharray="3 3" />
                  <circle cx={dEndL.x} cy={dEndL.y} r={9} fill="none" stroke="rgb(52 211 153 / 0.2)" strokeWidth="1" strokeDasharray="3 3" />

                  {isRectActive && (
                    <>
                      <rect x={pLM.x - rectSize / 2} y={pLM.y - rectSize / 2} width={rectSize} height={rectSize} fill="rgb(244 63 94 / 0.9)" rx={3} />
                      <rect x={dLM.x - rectSize / 2} y={dLM.y - rectSize / 2} width={rectSize} height={rectSize} fill="rgb(52 211 153 / 0.4)" rx={3} />
                    </>
                  )}
                </g>
              );
            })}
          </g>
        )}
        {showGazeHeatmap && (
          <GazeHeatmapLayer
            points={filteredTrials.flatMap((t, i) => {
              const mt = layout.mappedGazeTrials[i];
              return (mt.mappedSamples ?? []).filter(s => {
                const startSec = (t.startTime - trials[0].startTime) / 1000;
                return startSec + s.t <= effectiveReplay;
              }).map((s) => layout.loc(s.x, s.y));
            })}
          />
        )}
        {filteredTrials.map((t, i) => {
          const mt = layout.mappedGazeTrials[i];
          const samples = mt.mappedSamples ?? [];
          const filtered = samples.filter(s => {
            const startSec = (t.startTime - trials[0].startTime) / 1000;
            return startSec + s.t <= effectiveReplay;
          });
          if (filtered.length === 0) return null;
          const pts = filtered.map((s) => layout.loc(s.x, s.y));
          const ptsStr = pts.map((p) => `${p.x},${p.y}`).join(' ');
          const hue = (i * 37) % 360;
          const stroke = `hsl(${hue} 72% 62%)`;
          return (
            <g key={`path-${t.startTime}-${i}`}>
              {pts.length >= 2 ? (
                <>
                  <polyline
                    fill="none"
                    stroke="rgb(15 23 42)"
                    strokeWidth={5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.85}
                    vectorEffect="nonScalingStroke"
                    points={ptsStr}
                  />
                  <polyline
                    fill="none"
                    stroke={stroke}
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.95}
                    vectorEffect="nonScalingStroke"
                    points={ptsStr}
                  />
                </>
              ) : (
                <circle cx={pts[0].x} cy={pts[0].y} r={5} fill={stroke} stroke="rgb(15 23 42)" strokeWidth={1.5} vectorEffect="nonScalingStroke" />
              )}
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
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div
            className={`${innerFrame.className} relative flex min-h-0 flex-col overflow-hidden`}
            style={innerFrame.style}
          >
            <p className="pointer-events-none absolute left-0 right-0 top-2 z-10 px-3 text-center text-[10px] text-slate-500">
              <span className="text-slate-400">Colored lines = gaze path per trial.</span> Red = bright stimulus, green = dim (target). Compass in{' '}
              <strong>Parameters</strong>. Turn on <strong>Gaze heatmap</strong> in the toolbar for a density view.
            </p>
            {totalGazeSamples === 0 && (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-4 pt-10">
                <p className="max-w-md rounded-lg border border-amber-800/60 bg-amber-950/90 px-3 py-2.5 text-center text-xs leading-relaxed text-amber-50/95 shadow-lg">
                  No <strong>gaze</strong> samples in results (<code className="text-amber-200/90">trials[].gazeSamples</code> is empty) — path cannot be drawn.
                  Re-run with gaze tracking or check saved data.
                </p>
              </div>
            )}
            <div className="flex min-h-0 flex-1 flex-col gap-2 px-2 pb-2 pt-9 sm:px-3">
              <div className="min-h-0 flex-1 overflow-hidden">{viewportSvg}</div>
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
