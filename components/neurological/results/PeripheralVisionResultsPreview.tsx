'use client';

import React, { useMemo, useState } from 'react';
import { useReplayControls, ReplayControlsBar } from './ReplayControls';
import {
  RESULT_VIZ_OUTER,
  ResultVizAspectSvg,
  ResultVizMaxFrame,
  useResultVizInnerFrameStyle,
} from './resultVizLayout';
import {
  getTrialStimulusPixelPosition,
  stimulusAngleDegFromCenter,
} from '../tests/peripheralVision/utils';
import type { PeripheralVisionTrialResult } from '../tests/peripheralVision/PeripheralVisionTest';
import { GazeHeatmapLayer, GazePathDirectionArrows } from './gazeVizSvg';
import { useNeurologicalResultsViewOptions } from './neuroResultsViewOptions';
import { detectAndMapGazeToViewport } from '@/lib/visualSearchGazeCoords';

type Props = {
  trials: PeripheralVisionTrialResult[];
  startTime?: number;
  endTime?: number;
  scanningPath?: Array<{ t: number; x: number; y: number }>;
  stimulusDurationMs?: number;
  metrics?: {
    avgRT?: number;
    accuracy?: number;
    centerStability?: number;
    avgCenteringDistancePx?: number;
    avgCenteringStdPx?: number;
  };
  viewportWidth?: number;
  viewportHeight?: number;
  visualOnly?: boolean;
};

type MappedTrial = PeripheralVisionTrialResult & {
  mappedSamples: Array<{ t: number; x: number; y: number }>;
};

function globalSampleTimeSec(tr: PeripheralVisionTrialResult, s: { t: number }, testStartMs: number): number {
  const startMs = tr.trialStartTime ?? tr.stimulusOnsetTime;
  return (startMs - testStartMs) / 1000 + s.t;
}

export function PeripheralParamsSection({
  trials,
  metrics,
  viewportWidth: vwProp,
  viewportHeight: vhProp,
}: Pick<Props, 'trials' | 'metrics' | 'viewportWidth' | 'viewportHeight'>) {
  const vw = vwProp ?? 1920;
  const vh = vhProp ?? 1080;
  if (!trials?.length) {
    return <p className="text-slate-500 text-sm">No peripheral vision trials.</p>;
  }

  const hits = trials.filter((t) => t.hit).length;
  const hasCentering = trials.some((t) => t.centeringMeanDistancePx != null);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 text-sm text-slate-300">
        {metrics?.avgRT != null && (
          <span>
            Mean RT (hits):{' '}
            <span className="font-mono text-sky-400">{metrics.avgRT.toFixed(0)} ms</span>
          </span>
        )}
        {metrics?.accuracy != null && (
          <span>
            Accuracy:{' '}
            <span className="font-mono text-emerald-400">{metrics.accuracy.toFixed(1)}%</span>
          </span>
        )}
        {metrics?.avgCenteringDistancePx != null && (
          <span>
            Gaze stability at center (delay, mean dist.):{' '}
            <span className="font-mono text-amber-300">{metrics.avgCenteringDistancePx.toFixed(1)} px</span>
          </span>
        )}
        {metrics?.avgCenteringStdPx != null && (
          <span>
            Mean σ distance (delay):{' '}
            <span className="font-mono text-slate-200">{metrics.avgCenteringStdPx.toFixed(1)} px</span>
          </span>
        )}
        {metrics?.centerStability != null && (
          <span className="text-slate-500">
            Mean dist. all samples (legacy):{' '}
            <span className="font-mono text-slate-400">{metrics.centerStability.toFixed(1)} px</span>
          </span>
        )}
        <span className="text-slate-500">
          Hits: {hits} / {trials.length}
        </span>
      </div>

      <div className="max-h-[min(50vh,360px)] overflow-y-auto rounded-lg border border-gray-800">
        <table className="w-full min-w-[320px] text-left text-xs text-slate-300">
          <thead className="sticky top-0 bg-gray-900/95 text-slate-400">
            <tr>
              <th className="px-2 py-2 font-medium">#</th>
              <th className="px-2 py-2 font-medium">Angle (°)</th>
              <th className="px-2 py-2 font-medium">Hit</th>
              <th className="px-2 py-2 font-medium">RT (ms)</th>
              {hasCentering && (
                <>
                  <th className="px-2 py-2 font-medium">Center μ</th>
                  <th className="px-2 py-2 font-medium">Center σ</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {trials.map((t, i) => (
              <tr key={`${t.stimulusOnsetTime}-${i}`} className="border-t border-gray-800">
                <td className="px-2 py-1.5 font-mono text-slate-500">{i + 1}</td>
                <td className="px-2 py-1.5 font-mono text-slate-200">
                  {Math.round(stimulusAngleDegFromCenter(t, vw, vh))}°
                </td>
                <td className="px-2 py-1.5">
                  {t.hit ? <span className="text-emerald-400">Yes</span> : <span className="text-rose-400">No</span>}
                </td>
                <td className="px-2 py-1.5 font-mono">{t.rtMs != null ? t.rtMs.toFixed(0) : '—'}</td>
                {hasCentering && (
                  <>
                    <td className="px-2 py-1.5 font-mono text-amber-200/90">
                      {t.centeringMeanDistancePx != null ? t.centeringMeanDistancePx.toFixed(1) : '—'}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-slate-400">
                      {t.centeringStdDistancePx != null ? t.centeringStdDistancePx.toFixed(1) : '—'}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function PeripheralVisionResultsPreview({
  trials,
  startTime: startTimeProp,
  endTime: endTimeProp,
  scanningPath,
  stimulusDurationMs: stimulusDurationMsProp,
  metrics,
  viewportWidth,
  viewportHeight,
  visualOnly,
}: Props) {
  const innerFrame = useResultVizInnerFrameStyle();
  const { showStimulusReplay, showGazeHeatmap } = useNeurologicalResultsViewOptions();

  const vw = viewportWidth ?? 1920;
  const vh = viewportHeight ?? 1080;
  const center = { x: vw / 2, y: vh / 2 };
  const stimulusDurationSec = (stimulusDurationMsProp ?? 300) / 1000;

  const testStartMs = useMemo(() => {
    if (typeof startTimeProp === 'number' && Number.isFinite(startTimeProp)) return startTimeProp;
    return trials[0]?.trialStartTime ?? trials[0]?.stimulusOnsetTime ?? 0;
  }, [startTimeProp, trials]);

  const durationSec = useMemo(() => {
    if (
      typeof startTimeProp === 'number' &&
      typeof endTimeProp === 'number' &&
      Number.isFinite(startTimeProp) &&
      Number.isFinite(endTimeProp) &&
      endTimeProp >= startTimeProp
    ) {
      return (endTimeProp - startTimeProp) / 1000;
    }
    let maxT = 0;
    for (const tr of trials) {
      for (const s of tr.gazeSamples ?? []) {
        const g = globalSampleTimeSec(tr, s, testStartMs);
        if (g > maxT) maxT = g;
      }
    }
    return maxT;
  }, [trials, startTimeProp, endTimeProp, testStartMs]);

  const { effectiveReplay, playing, speed, setSpeed, toggle, handleScrub } = useReplayControls(durationSec);

  const layout = useMemo(() => {
    if (!trials?.length) return null;
    const pad = 40;
    const allGazePts = trials.flatMap((t) => t.gazeSamples ?? []);
    const { mode } = detectAndMapGazeToViewport(allGazePts, vw, vh);

    const mapPt = (p: { t: number; x: number; y: number }) => {
      if (mode === 'normalized01') return { ...p, x: p.x * vw, y: p.y * vh };
      if (mode === 'percent100') return { ...p, x: (p.x / 100) * vw, y: (p.y / 100) * vh };
      return p;
    };

    const mappedTrials: MappedTrial[] = trials.map((tr) => ({
      ...tr,
      mappedSamples: (tr.gazeSamples ?? []).map((s) => mapPt(s)),
    }));

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
    expand(center.x, center.y);
    for (const tr of trials) {
      const sp = getTrialStimulusPixelPosition(tr, vw, vh);
      expand(sp.x, sp.y);
    }
    for (const mt of mappedTrials) {
      for (const s of mt.mappedSamples) {
        expand(s.x, s.y);
      }
    }
    if (!Number.isFinite(minX)) {
      minX = 0;
      minY = 0;
      maxX = vw;
      maxY = vh;
    }
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;
    const viewW = Math.max(maxX - minX, 200);
    const viewH = Math.max(maxY - minY, 200);
    const loc = (x: number, y: number) => ({ x: x - minX, y: y - minY });

    const allHeat: { x: number; y: number }[] = [];
    for (const mt of mappedTrials) {
      for (const s of mt.mappedSamples) {
        allHeat.push(loc(s.x, s.y));
      }
    }

    return {
      viewW,
      viewH,
      loc,
      centerL: loc(center.x, center.y),
      stimulusMarkersL: trials.map((tr) => {
        const sp = getTrialStimulusPixelPosition(tr, vw, vh);
        return loc(sp.x, sp.y);
      }),
      allHeat,
      mappedTrials,
    };
  }, [trials, vw, vh, center.x, center.y]);

  const totalGazeSamples = trials.reduce((n, t) => n + (t.gazeSamples?.length ?? 0), 0) || (scanningPath?.length ?? 0);

  const flashActiveForTrial = (tr: PeripheralVisionTrialResult): boolean => {
    const flashStart = (tr.stimulusOnsetTime - testStartMs) / 1000;
    const flashEnd = flashStart + stimulusDurationSec;
    return effectiveReplay >= flashStart - 1e-6 && effectiveReplay < flashEnd;
  };

  if (!trials?.length) {
    return <p className="text-slate-500 text-sm">No peripheral vision trials.</p>;
  }

  if (!layout) {
    return <p className="text-slate-500 text-sm">No peripheral vision trials.</p>;
  }

  const svgBlock = (
    <ResultVizMaxFrame>
      <ResultVizAspectSvg
        contentWidth={layout.viewW}
        contentHeight={layout.viewH}
        panelFill="rgb(15 23 42 / 0.35)"
        role="img"
        aria-label="Peripheral vision gaze replay"
      >
        {showStimulusReplay && (
          <>
            <circle cx={layout.centerL.x} cy={layout.centerL.y} r={10} fill="rgb(245 158 11 / 0.9)" />
            <text x={layout.centerL.x} y={layout.centerL.y - 20} textAnchor="middle" fill="rgb(148 163 184)" fontSize="12">
              Center
            </text>
            {trials.map((tr, i) => {
              const pos = layout.stimulusMarkersL[i];
              if (!pos) return null;
              const flashOn = flashActiveForTrial(tr);
              return (
                <circle
                  key={`${tr.stimulusOnsetTime}-${i}`}
                  cx={pos.x}
                  cy={pos.y}
                  r={flashOn ? 18 : 14}
                  fill={flashOn ? 'rgb(255 255 255 / 0.35)' : 'rgb(255 255 255 / 0.08)'}
                  stroke={flashOn ? 'rgb(251 191 36)' : 'rgb(148 163 184 / 0.6)'}
                  strokeWidth={flashOn ? 2.5 : 1}
                />
              );
            })}
          </>
        )}
        {showGazeHeatmap && (
          <GazeHeatmapLayer
            points={layout.mappedTrials.flatMap((mt, i) => {
              const tr = trials[i];
              return mt.mappedSamples
                .filter((s) => globalSampleTimeSec(tr, s, testStartMs) <= effectiveReplay)
                .map((s) => layout.loc(s.x, s.y));
            })}
          />
        )}
        {layout.mappedTrials.map((mt, i) => {
          const tr = trials[i];
          const filtered = mt.mappedSamples.filter(
            (s) => globalSampleTimeSec(tr, s, testStartMs) <= effectiveReplay
          );
          if (filtered.length === 0) return null;
          const pts = filtered.map((s) => layout.loc(s.x, s.y));
          const ptsStr = pts.map((p) => `${p.x},${p.y}`).join(' ');
          const hue = (i * 41) % 360;
          const stroke = `hsl(${hue} 72% 62%)`;
          return (
            <g key={`${tr.stimulusOnsetTime}-${i}`}>
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
                <circle
                  cx={pts[0].x}
                  cy={pts[0].y}
                  r={5}
                  fill={stroke}
                  stroke="rgb(15 23 42)"
                  strokeWidth={1.5}
                  vectorEffect="nonScalingStroke"
                />
              )}
              <GazePathDirectionArrows points={pts} step={10} fill={`hsl(${hue} 65% 55%)`} size={5} />
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
              <span className="text-slate-400">Colored lines = gaze per trial.</span> Bright ring = flash location (random per trial). Center stability (delay) is in{' '}
              <strong>Parameters</strong>.
            </p>
            {totalGazeSamples === 0 && (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-4 pt-10">
                <p className="max-w-md rounded-lg border border-amber-800/60 bg-amber-950/90 px-3 py-2.5 text-center text-xs text-amber-50/95 shadow-lg">
                  No gaze samples — path cannot be drawn.
                </p>
              </div>
            )}
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
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <PeripheralParamsSection trials={trials} metrics={metrics} viewportWidth={vw} viewportHeight={vh} />
      {svgBlock}
      <p className="text-xs text-slate-500">
        Gaze path per trial; flash highlight follows stimulus timing. Toggle heatmap in the toolbar.
      </p>
    </div>
  );
}
