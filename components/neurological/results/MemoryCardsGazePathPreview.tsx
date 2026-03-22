'use client';

import React, { useMemo, useState } from 'react';
import { FLIP_BACK_DELAY_MS } from '../tests/memoryCards/constants';
import type { MemoryCardsGridRect, MemoryCardsMove } from '../tests/memoryCards/MemoryCardsTest';
import { ResultVizAspectSvg, ResultVizMaxFrame } from './resultVizLayout';
import { GazeHeatmapLayer, GazePathDirectionArrows } from './gazeVizSvg';
import { useNeurologicalResultsViewOptions } from './neuroResultsViewOptions';
import { detectAndMapGazeToViewport } from '@/lib/visualSearchGazeCoords';

const SYMBOLS = '◆●▲■★♦♥♣✓✗○◇☆▪▫①②③④⑤⑥⑦⑧⑨⑩'.split('');

function cardSymbol(id: number): string {
  if (id < 0) return '';
  return SYMBOLS[id % SYMBOLS.length] ?? String(id);
}

/** Trạng thái lật / khớp tại thời điểm `tSec` (giây từ lúc bắt đầu test). */
function cardStateAtTime(
  tSec: number,
  startTime: number,
  moves: MemoryCardsMove[],
  flipBackDelaySec: number
): { matched: Set<number>; revealed: Set<number> } {
  const sorted = [...moves].sort((a, b) => a.timestamp - b.timestamp);
  const matched = new Set<number>();
  const revealed = new Set<number>();

  for (const m of sorted) {
    const relT = (m.timestamp - startTime) / 1000;
    if (relT > tSec) break;
    if (m.match) {
      matched.add(m.card1Index);
      matched.add(m.card2Index);
    }
  }
  for (const m of sorted) {
    const relT = (m.timestamp - startTime) / 1000;
    if (relT > tSec) break;
    if (!m.match && relT + flipBackDelaySec > tSec) {
      revealed.add(m.card1Index);
      revealed.add(m.card2Index);
    }
  }
  return { matched, revealed };
}

/** Kết thúc game: mọi ô hợp lệ đều đã khớp (khi không có moves để replay). */
function allMatchedIndices(board: number[]): Set<number> {
  const s = new Set<number>();
  for (let i = 0; i < board.length; i++) {
    if (board[i] >= 0) s.add(i);
  }
  return s;
}

type Props = {
  gazePath: Array<{ t: number; x: number; y: number }>;
  board?: number[];
  cols?: number;
  rows?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  /** Lưới pixel lúc test — ưu tiên hơn ước lượng. */
  gridRect?: MemoryCardsGridRect;
  moves?: MemoryCardsMove[];
  startTime?: number;
  completionTimeMs?: number;
  visualOnly?: boolean;
};

export function MemoryCardsParamsSection({ sampleCount }: { sampleCount: number }) {
  return (
    <p className="text-xs text-slate-400 leading-relaxed">
      <span className="text-slate-500">Samples:</span>{' '}
      <span className="font-mono text-slate-200">{sampleCount}</span>
      <br />
      <span className="text-slate-500">Path</span> = gaze trace; <span className="text-slate-500">dot</span> = last point.
    </p>
  );
}

/**
 * Gaze (viewport px) + lưới card; nếu có `gridRect` + `moves` thì căn đúng pixel và tái hiện lật theo thời gian.
 */
export default function MemoryCardsGazePathPreview({
  gazePath,
  board,
  cols: colsIn,
  rows: rowsIn,
  viewportWidth,
  viewportHeight,
  gridRect: gridRectIn,
  moves,
  startTime,
  completionTimeMs,
  visualOnly,
}: Props) {
  const { showStimulusReplay, showGazeHeatmap } = useNeurologicalResultsViewOptions();

  const durationSec = useMemo(() => {
    const fromCompletion = Math.max(0, (completionTimeMs ?? 0) / 1000);
    if (fromCompletion > 0) return fromCompletion;
    const maxT = gazePath.reduce((m, p) => Math.max(m, p.t), 0);
    return maxT;
  }, [completionTimeMs, gazePath]);

  const [replayTimeSec, setReplayTimeSec] = useState<number | null>(null);
  const effectiveReplay = replayTimeSec ?? durationSec;

  const layout = useMemo(() => {
    if (gazePath.length === 0) return null;
    const vw = viewportWidth ?? 1920;
    const vh = viewportHeight ?? 1080;
    const cols = colsIn ?? 2;
    const rows = rowsIn ?? 2;

    let gx0: number;
    let gy0: number;
    let gridW: number;
    let gridH: number;

    if (gridRectIn && gridRectIn.width > 0 && gridRectIn.height > 0) {
      gx0 = gridRectIn.left;
      gy0 = gridRectIn.top;
      gridW = gridRectIn.width;
      gridH = gridRectIn.height;
    } else {
      const cellAr = cols / Math.max(rows, 1);
      const maxGridW = vw * 0.92;
      const maxGridH = vh * 0.85;
      gridW = maxGridW;
      gridH = gridW / cellAr;
      if (gridH > maxGridH) {
        gridH = maxGridH;
        gridW = gridH * cellAr;
      }
      gx0 = (vw - gridW) / 2;
      gy0 = (vh - gridH) / 2;
    }

    const cw = gridW / cols;
    const rh = gridH / rows;

    return {
      vw,
      vh,
      cols,
      rows,
      grid: { gx0, gy0, cw, rh },
      sampleCount: gazePath.length,
      board: board ?? null,
      hasSavedGrid: Boolean(gridRectIn),
    };
  }, [gazePath, viewportWidth, viewportHeight, board, colsIn, rowsIn, gridRectIn]);

  const pathForReplay = useMemo(() => {
    if (!layout) return [];
    return gazePath.filter((p) => p.t <= effectiveReplay);
  }, [gazePath, effectiveReplay, layout]);

  const pathPts = useMemo(() => {
    if (!layout || pathForReplay.length === 0) return [];
    const xy = pathForReplay.map((p) => ({ x: p.x, y: p.y }));
    const { pts: mapped } = detectAndMapGazeToViewport(xy, layout.vw, layout.vh);
    return pathForReplay.map((p, i) => ({ t: p.t, x: mapped[i]!.x, y: mapped[i]!.y }));
  }, [pathForReplay, layout]);
  const last = pathPts[pathPts.length - 1];

  const scanplot = useMemo(() => {
    if (!layout || pathPts.length < 2) return { segments: [], nodes: [] };
    const pts = pathPts;
    const totalDurSec = Math.max(1, pts[pts.length - 1]!.t - pts[0]!.t); // t is already seconds
    const nodeCount = Math.max(6, Math.min(30, Math.ceil(totalDurSec * 1.5))); // ~1.5 nodes per second
    const step = Math.max(1, Math.floor(pts.length / nodeCount));
    
    const synthNodes: { cx: number; cy: number; r: number; label: string; fill: string; stroke: string; key: string }[] = [];
    const synthSegments: { x1: number; y1: number; x2: number; y2: number; stroke: string; key: string; label?: string }[] = [];
    let prevPt: typeof pts[0] | null = null;
    let k = 0;
    
    for (let i = 0; i < pts.length; i += step) {
      const p = pts[i]!;
      const hue = (k * 35) % 360;
      if (prevPt) {
        const dt = p.t - prevPt.t; // dt is in seconds
        synthSegments.push({
          key: `sseg-${k}`,
          x1: prevPt.x,
          y1: prevPt.y,
          x2: p.x,
          y2: p.y,
          stroke: `hsl(${hue} 72% 58%)`,
          label: dt > 0 ? `${dt.toFixed(2)}s` : undefined,
        });
      }
      synthNodes.push({
        cx: p.x,
        cy: p.y,
        r: 16,
        label: String(k + 1),
        fill: `hsl(${hue} 65% 50% / 0.38)`,
        stroke: `hsl(${hue} 75% 62%)`,
        key: `sfx-${k}`,
      });
      prevPt = p;
      k++;
    }
    
    const lastPt = pts[pts.length - 1]!;
    if (prevPt && (prevPt.x !== lastPt.x || prevPt.y !== lastPt.y)) {
      const hue = (k * 35) % 360;
      const dt = lastPt.t - prevPt.t; // dt is in seconds
      synthSegments.push({
        key: `sseg-${k}`,
        x1: prevPt.x,
        y1: prevPt.y,
        x2: lastPt.x,
        y2: lastPt.y,
        stroke: `hsl(${hue} 72% 58%)`,
        label: dt > 0 ? `${dt.toFixed(2)}s` : undefined,
      });
      synthNodes.push({
        cx: lastPt.x,
        cy: lastPt.y,
        r: 16,
        label: String(k + 1),
        fill: `hsl(${hue} 65% 50% / 0.38)`,
        stroke: `hsl(${hue} 75% 62%)`,
        key: `sfx-${k}`,
      });
    }
    
    return { segments: synthSegments, nodes: synthNodes };
  }, [layout, pathForReplay]);

  const { matched, revealed } = useMemo(() => {
    if (!layout?.board?.length) {
      return { matched: new Set<number>(), revealed: new Set<number>() };
    }
    const b = layout.board;
    if (moves?.length && startTime != null) {
      return cardStateAtTime(effectiveReplay, startTime, moves, FLIP_BACK_DELAY_MS / 1000);
    }
    return { matched: allMatchedIndices(b), revealed: new Set<number>() };
  }, [layout?.board, moves, startTime, effectiveReplay]);

  const gridCells = useMemo(() => {
    if (!layout?.board || !showStimulusReplay) return [];
    const { gx0, gy0, cw, rh } = layout.grid;
    const { cols } = layout;
    const b = layout.board;
    const out: React.ReactNode[] = [];
    let k = 0;
    for (let i = 0; i < b.length; i++) {
      const v = b[i];
      if (v < 0) continue;
      const row = Math.floor(i / cols);
      const col = i % cols;
      const x = gx0 + col * cw;
      const y = gy0 + row * rh;
      const isMatched = matched.has(i);
      const isRevealed = isMatched || revealed.has(i);
      const fill = isMatched ? 'rgb(4 120 87 / 0.85)' : isRevealed ? 'rgb(37 99 235 / 0.88)' : 'rgb(30 41 59 / 0.92)';
      const stroke = isMatched ? 'rgb(52 211 153)' : isRevealed ? 'rgb(96 165 250)' : 'rgb(100 116 139)';
      out.push(
        <g key={`c-${k++}`}>
          <rect
            x={x + 2}
            y={y + 2}
            width={cw - 4}
            height={rh - 4}
            rx={6}
            fill={fill}
            stroke={stroke}
            strokeWidth="1"
          />
          {isRevealed ? (
            <text
              x={x + cw / 2}
              y={y + rh / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fill="white"
              fontSize={Math.min(cw, rh) * 0.35}
              fontWeight="bold"
            >
              {cardSymbol(v)}
            </text>
          ) : (
            <text
              x={x + cw / 2}
              y={y + rh / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fill="rgb(203 213 225)"
              fontSize={Math.min(cw, rh) * 0.32}
              fontWeight="bold"
            >
              ?
            </text>
          )}
        </g>
      );
    }
    return out;
  }, [layout, showStimulusReplay, matched, revealed]);

  if (!layout) {
    return <p className="text-slate-500 text-sm">No gaze path samples.</p>;
  }

  const showReplaySlider = durationSec > 0 && (moves?.length ?? 0) > 0 && startTime != null;

  const chart = (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-2">
      <ResultVizMaxFrame>
        <ResultVizAspectSvg
          contentWidth={layout.vw}
          contentHeight={layout.vh}
          panelFill="rgb(15 23 42 / 0.4)"
          role="img"
          aria-label="Gaze path during memory cards"
        >
          {gridCells}
          {showGazeHeatmap && pathPts.length > 0 && <GazeHeatmapLayer points={pathPts} />}
          {scanplot.segments.map((s) => {
            const cx = (s.x1 + s.x2) / 2;
            const cy = (s.y1 + s.y2) / 2;
            const dx = s.x2 - s.x1;
            const dy = s.y2 - s.y1;
            const inRange = Math.abs(dx) > 10 || Math.abs(dy) > 10;
            return (
            <g key={s.key} className="group cursor-default">
              <line
                x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
                stroke="transparent" strokeWidth="20"
              />
              <line
                x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
                stroke={s.stroke} strokeWidth="3.5" strokeLinecap="round" opacity={0.92}
              />
              {(() => {
                const len = Math.hypot(dx, dy);
                if (len > 35) {
                  const ux = dx / len;
                  const uy = dy / len;
                  const tipX = s.x1 + ux * (len - 20);
                  const tipY = s.y1 + uy * (len - 20);
                  const baseX = tipX - ux * 14;
                  const baseY = tipY - uy * 14;
                  const nx = -uy;
                  const ny = ux;
                  const p1x = baseX + nx * 7;
                  const p1y = baseY + ny * 7;
                  const p2x = baseX - nx * 7;
                  const p2y = baseY - ny * 7;
                  return (
                    <polygon
                      points={`${tipX},${tipY} ${p1x},${p1y} ${p2x},${p2y}`}
                      fill={s.stroke} opacity={0.92}
                    />
                  );
                }
                return null;
              })()}
              {s.label && inRange && (
                <g className="opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <rect
                    x={cx - 24} y={cy - 12} width="48" height="24"
                    fill="rgb(15 23 42 / 0.85)" stroke={s.stroke} strokeWidth="1" rx="4"
                  />
                  <text
                    x={cx} y={cy} fill="white" fontSize="12" textAnchor="middle" dominantBaseline="central" fontWeight="bold"
                  >
                    {s.label}
                  </text>
                </g>
              )}
              <title>Time taken: {s.label ?? 'Unknown'}</title>
            </g>
          )})}
          {scanplot.nodes.map((n) => (
            <g key={n.key}>
              <circle cx={n.cx} cy={n.cy} r={n.r} fill={n.fill} stroke={n.stroke} strokeWidth="2.2" opacity={0.95} />
              <text x={n.cx} y={n.cy} textAnchor="middle" dominantBaseline="central" fill="white" fontSize={13} fontWeight="bold" style={{ textShadow: '0 1px 2px rgb(0 0 0 / 0.8)' }}>
                {n.label}
              </text>
            </g>
          ))}
          {last && (
            <circle cx={last.x} cy={last.y} r={6} fill="rgb(251 191 36)" stroke="rgb(15 23 42)" strokeWidth={1} />
          )}
        </ResultVizAspectSvg>
      </ResultVizMaxFrame>
      {showReplaySlider && (
        <label className="flex shrink-0 flex-col gap-1 px-1 text-[11px] text-slate-400 sm:flex-row sm:items-center sm:gap-3">
          <span className="whitespace-nowrap">Thời điểm tái hiện</span>
          <input
            type="range"
            min={0}
            max={durationSec}
            step={Math.min(0.1, durationSec / 200) || 0.01}
            value={Math.min(effectiveReplay, durationSec)}
            onChange={(e) => setReplayTimeSec(Number(e.target.value))}
            className="min-w-0 flex-1 accent-sky-500"
          />
          <span className="font-mono text-slate-300 tabular-nums">
            {effectiveReplay.toFixed(1)}s / {durationSec.toFixed(1)}s
          </span>
        </label>
      )}
    </div>
  );

  if (visualOnly) {
    return chart;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {chart}
      <p className="shrink-0 text-xs text-slate-500">
        {layout.sampleCount} samples · path = gaze đến mốc thời gian · dot = điểm cuối
        {!layout.hasSavedGrid && ' · ước lượng lưới (thiếu gridRect)'}
        {!layout.board && ' · dữ liệu cũ không có board'}
      </p>
    </div>
  );
}
