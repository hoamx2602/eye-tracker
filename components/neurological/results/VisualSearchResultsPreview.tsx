'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { neuroDebugLog, neuroPersistWarn } from '@/lib/neuroDebugLog';
import { applyGazeModeToFixations, detectAndMapGazeToViewport } from '@/lib/visualSearchGazeCoords';
import { ResultVizAspectSvg, ResultVizMaxFrame } from './resultVizLayout';
import { GazeHeatmapLayer, GazePathDirectionArrows } from './gazeVizSvg';
import { useNeurologicalResultsViewOptions } from './neuroResultsViewOptions';

type NumberPos = { number: number; x: number; y: number };
type PathPt = { t: number; x: number; y: number };

type FixationPt = { number: number; timestamp: number; gazeX: number; gazeY: number };

type StimulusBounds = { left: number; top: number; width: number; height: number };

type Props = {
  completionTimeMs: number;
  numberPositions: NumberPos[];
  scanningPath: PathPt[];
  gazeFixationPerNumber: Record<number, number>;
  sequence: number[];
  fixations?: FixationPt[];
  viewportWidth?: number;
  viewportHeight?: number;
  stimulusBounds?: StimulusBounds;
  startTime?: number;
  endTime?: number;
  visualOnly?: boolean;
};

export function VisualSearchParamsSection({
  completionTimeMs,
  sequence,
  gazeFixationPerNumber,
}: Pick<Props, 'completionTimeMs' | 'sequence' | 'gazeFixationPerNumber'>) {
  const fixationRows = useMemo(() => {
    const entries = Object.entries(gazeFixationPerNumber ?? {})
      .map(([k, v]) => ({ num: Number(k), count: v as number }))
      .sort((a, b) => a.num - b.num);
    return entries;
  }, [gazeFixationPerNumber]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 text-sm text-slate-300">
        <span>
          Completion:{' '}
          <span className="font-mono text-sky-400">{(completionTimeMs / 1000).toFixed(2)} s</span>
        </span>
        <span>
          Order found:{' '}
          <span className="font-mono text-slate-200">{sequence?.length ? sequence.join(' → ') : '—'}</span>
        </span>
      </div>
      {fixationRows.length > 0 && (
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2 text-xs">
          <span className="text-slate-500">Fixations per number: </span>
          <span className="font-mono text-slate-300">
            {fixationRows.map((r) => `${r.num}: ${r.count}`).join(' · ')}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Scanpath kiểu cổ điển: đường nối các fixation theo thời gian + vòng có số thứ tự (kích thước ~ dwell).
 * numberPositions: % trong vùng stimulus; scanningPath: pixel viewport (cùng eye tracking).
 */
export default function VisualSearchResultsPreview({
  completionTimeMs,
  numberPositions,
  scanningPath,
  gazeFixationPerNumber,
  sequence,
  fixations = [],
  viewportWidth,
  viewportHeight,
  stimulusBounds,
  startTime,
  endTime,
  visualOnly,
}: Props) {
  const { showStimulusReplay, showGazeHeatmap } = useNeurologicalResultsViewOptions();
  const warnedEmptyRef = useRef(false);
  const warnedModeRef = useRef(false);
  const warnedNoValidGazeRef = useRef(false);

  const layout = useMemo(() => {
    const path = scanningPath ?? [];
    const vw = viewportWidth ?? 1920;
    const vh = viewportHeight ?? 1080;
    console.log('[Neuro][VSPreview] layout memo: path.length=', path.length, 'numberPositions.length=', numberPositions.length, 'vw=', vw, 'vh=', vh, 'path[0..2]=', path.slice(0, 3));
    if (path.length === 0 && numberPositions.length === 0) {
      console.warn('[Neuro][VSPreview] layout → null (no path AND no numberPositions)');
      return null;
    }

    const numbersPx = numberPositions.map((n) =>
      stimulusBounds && stimulusBounds.width > 0 && stimulusBounds.height > 0
        ? {
            number: n.number,
            x: stimulusBounds.left + (n.x / 100) * stimulusBounds.width,
            y: stimulusBounds.top + (n.y / 100) * stimulusBounds.height,
          }
        : {
            number: n.number,
            x: (n.x / 100) * vw,
            y: (n.y / 100) * vh,
          }
    );

    const xy = path.map((p) => ({ x: p.x, y: p.y }));
    const { pts: mapped, mode } = detectAndMapGazeToViewport(xy, vw, vh);
    const pathPts = path.map((p, i) => ({
      t: p.t,
      x: mapped[i]!.x,
      y: mapped[i]!.y,
    }));
    const poly = pathPts.map((p) => `${p.x},${p.y}`).join(' ');
    const fixationsResolved = applyGazeModeToFixations(fixations, mode, vw, vh);

    /** Nhiều mẫu nhưng gần như cố định tại (0,0) — khớp khi không có ước lượng gaze thật, chỉ placeholder từ API. */
    let noValidGazeCoords = false;
    if (pathPts.length >= 20) {
      const xs = pathPts.map((p) => p.x);
      const ys = pathPts.map((p) => p.y);
      const mx = Math.max(...xs);
      const mn = Math.min(...xs);
      const my = Math.max(...ys);
      const ny = Math.min(...ys);
      const cx = (mx + mn) / 2;
      const cy = (my + ny) / 2;
      noValidGazeCoords =
        mx - mn < 3 && my - ny < 3 && Math.hypot(cx, cy) < 32;
    }

    console.log('[Neuro][VSPreview] layout built: rawPathLen=', path.length, 'mode=', mode, 'noValidGazeCoords=', noValidGazeCoords, 'fixationsResolved.length=', fixationsResolved.length, 'pathPts range x:', pathPts.length > 0 ? [Math.min(...pathPts.map(p=>p.x)).toFixed(1), Math.max(...pathPts.map(p=>p.x)).toFixed(1)] : 'empty', 'y:', pathPts.length > 0 ? [Math.min(...pathPts.map(p=>p.y)).toFixed(1), Math.max(...pathPts.map(p=>p.y)).toFixed(1)] : 'empty');
    return {
      vw,
      vh,
      poly,
      pathPts,
      numbers: numbersPx,
      gazeMode: mode,
      rawPathLen: path.length,
      fixationsResolved,
      noValidGazeCoords,
    };
  }, [scanningPath, numberPositions, viewportWidth, viewportHeight, stimulusBounds, fixations]);

  /** Fixation theo thời gian → scanpath (đoạn nối + vòng có số 1..N). */
  const scanplot = useMemo(() => {
    const fx = layout?.fixationsResolved ?? fixations;
    const sorted = [...fx].sort((a, b) => a.timestamp - b.timestamp);
    const tEnd =
      endTime ??
      (startTime != null ? startTime + completionTimeMs : sorted.length ? sorted[sorted.length - 1]!.timestamp + 1 : 0);

    console.log('[Neuro][VSPreview] scanplot memo: sorted fixations=', sorted.length, 'layout exists=', !!layout, 'pathPts=', layout?.pathPts?.length ?? 0, 'noValidGazeCoords=', layout?.noValidGazeCoords);
    // --- Fallback: synthesize fixation nodes from raw gaze path when AOI fixations are empty ---
    if (sorted.length === 0 && layout && layout.pathPts.length >= 2 && !layout.noValidGazeCoords) {
      console.log('[Neuro][VSPreview] → using synthetic scanpath fallback, nodeCount will be computed from', layout.pathPts.length, 'points');
      const pts = layout.pathPts;
      const totalDur = pts[pts.length - 1]!.t - pts[0]!.t;
      // Sample roughly every 1 second, but at least 6 and at most 20 nodes
      const nodeCount = Math.max(6, Math.min(20, Math.ceil(totalDur)));
      const step = Math.max(1, Math.floor(pts.length / nodeCount));
      const synthNodes: { cx: number; cy: number; r: number; label: string; targetNum: number; fill: string; stroke: string; key: string }[] = [];
      const synthSegments: { x1: number; y1: number; x2: number; y2: number; stroke: string; key: string; label?: string }[] = [];
      let prevPt: { x: number; y: number; t?: number } | null = null;
      let k = 0;
      for (let i = 0; i < pts.length; i += step) {
        const p = pts[i]!;
        const hue = (k * 47) % 360;
        if (prevPt) {
          const dt = p.t && prevPt.t ? p.t - prevPt.t : 0;
          synthSegments.push({
            key: `sseg-${k}`,
            x1: prevPt.x,
            y1: prevPt.y,
            x2: p.x,
            y2: p.y,
            stroke: `hsl(${hue} 72% 58%)`,
            label: dt > 0 ? `${(dt / 1000).toFixed(2)}s` : undefined,
          });
        }
        synthNodes.push({
          cx: p.x,
          cy: p.y,
          r: 18,
          label: String(k + 1),
          targetNum: 0,
          fill: `hsl(${hue} 65% 50% / 0.38)`,
          stroke: `hsl(${hue} 75% 62%)`,
          key: `sfx-${k}`,
        });
        prevPt = p;
        k++;
      }
      // Always include the last point if not already included
      const lastPt = pts[pts.length - 1]!;
      if (prevPt && (prevPt.x !== lastPt.x || prevPt.y !== lastPt.y)) {
        const hue = (k * 47) % 360;
        const dt = lastPt.t && prevPt.t ? lastPt.t - prevPt.t : 0;
        synthSegments.push({
          key: `sseg-${k}`,
          x1: prevPt.x,
          y1: prevPt.y,
          x2: lastPt.x,
          y2: lastPt.y,
          stroke: `hsl(${hue} 72% 58%)`,
          label: dt > 0 ? `${(dt / 1000).toFixed(2)}s` : undefined,
        });
        synthNodes.push({
          cx: lastPt.x,
          cy: lastPt.y,
          r: 18,
          label: String(k + 1),
          targetNum: 0,
          fill: `hsl(${hue} 65% 50% / 0.38)`,
          stroke: `hsl(${hue} 75% 62%)`,
          key: `sfx-${k}`,
        });
      }
      return { segments: synthSegments, nodes: synthNodes };
    }

    const segments: { x1: number; y1: number; x2: number; y2: number; stroke: string; key: string; label?: string }[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i]!;
      const b = sorted[i + 1]!;
      const hue = (i * 47) % 360;
      const dt = b.timestamp - a.timestamp;
      segments.push({
        key: `seg-${i}`,
        x1: a.gazeX,
        y1: a.gazeY,
        x2: b.gazeX,
        y2: b.gazeY,
        stroke: `hsl(${hue} 72% 58%)`,
        label: `${(dt / 1000).toFixed(2)}s`,
      });
    }
    const nodes = sorted.map((f, i) => {
      const nextT = i < sorted.length - 1 ? sorted[i + 1]!.timestamp : tEnd;
      const durMs = Math.max(80, nextT - f.timestamp);
      const r = 12 + Math.min(24, durMs / 55);
      const hue = (i * 47) % 360;
      return {
        cx: f.gazeX,
        cy: f.gazeY,
        r,
        label: String(i + 1),
        targetNum: f.number,
        fill: `hsl(${hue} 65% 50% / 0.38)`,
        stroke: `hsl(${hue} 75% 62%)`,
        key: `fx-${f.timestamp}-${i}`,
      };
    });
    return { segments, nodes };
  }, [layout, fixations, endTime, startTime, completionTimeMs]);

  useEffect(() => {
    if (!layout) return;
    const raw = scanningPath?.length ?? 0;
    const xs = layout.pathPts.map((p) => p.x);
    const ys = layout.pathPts.map((p) => p.y);
    neuroDebugLog('[VisualSearch] chart', {
      rawSamples: raw,
      mappedPoints: layout.pathPts.length,
      gazeMode: layout.gazeMode,
      noValidGazeCoords: layout.noValidGazeCoords,
      fixations: fixations.length,
      scanplotNodes: scanplot.nodes.length,
      xRange: xs.length ? [Math.min(...xs), Math.max(...xs)] : null,
      yRange: ys.length ? [Math.min(...ys), Math.max(...ys)] : null,
    });
    if (raw === 0 && numberPositions.length > 0 && !warnedEmptyRef.current) {
      warnedEmptyRef.current = true;
      neuroPersistWarn(
        '[VisualSearch] scanningPath rỗng — không có đường gaze. Kiểm tra: (1) bấm SPACE sau vài giây, (2) PATCH neurological run có testResults.visual_search.scanningPath, (3) filter console [Neuro] lúc hoàn thành bài.'
      );
    }
    if (layout.gazeMode !== 'pixels' && !warnedModeRef.current) {
      warnedModeRef.current = true;
      neuroPersistWarn(
        `[VisualSearch] Đã map tọa độ gaze từ ${layout.gazeMode} → pixel viewport (${viewportWidth ?? '?'}×${viewportHeight ?? '?'}). Nếu vẫn sai, kiểm tra calibration.`
      );
    }
    if (layout.noValidGazeCoords && raw > 0 && !warnedNoValidGazeRef.current) {
      warnedNoValidGazeRef.current = true;
      neuroPersistWarn(
        '[VisualSearch] Các mẫu lưu được gần (0,0) — thường không phải “nhìn góc màn” mà là chưa có dữ liệu gaze hợp lệ (regressor chưa train / chưa calibration trong session, hoặc pipeline không đưa ra tọa độ). Calibration xong rồi chạy lại neurological; nếu đã calibrate mà vẫn vậy, báo dev (gazeModelReady).'
      );
    }
  }, [layout, scanningPath?.length, numberPositions.length, fixations.length, scanplot.nodes.length, viewportWidth, viewportHeight]);

  if (!layout) {
    return <p className="text-slate-500 text-sm">No visual search data.</p>;
  }

  const noPath = layout.rawPathLen === 0;

  const svgBlock = (
    <ResultVizMaxFrame>
      <ResultVizAspectSvg
        contentWidth={layout.vw}
        contentHeight={layout.vh}
        panelFill="rgb(15 23 42 / 0.4)"
        role="img"
        aria-label="Visual search gaze path and scanpath"
      >
        {showGazeHeatmap && layout.pathPts.length > 0 && <GazeHeatmapLayer points={layout.pathPts} />}
        {layout.poly.length > 0 && (
          <polyline
            fill="none"
            stroke="rgb(96 165 250)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={0.42}
            points={layout.poly}
          />
        )}
        {layout.pathPts.length > 1 && scanplot.nodes.length === 0 && (
          <GazePathDirectionArrows points={layout.pathPts} step={10} />
        )}
        {scanplot.segments.map((s) => {
          const cx = (s.x1 + s.x2) / 2;
          const cy = (s.y1 + s.y2) / 2;
          // Calculate angle for text rotation
          const dx = s.x2 - s.x1;
          const dy = s.y2 - s.y1;
          const inRange = Math.abs(dx) > 10 || Math.abs(dy) > 10;
          return (
          <g key={s.key} className="group cursor-default">
            {/* Thicker invisible line for easier hovering */}
            <line
              x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
              stroke="transparent"
              strokeWidth="20"
            />
            <line
              x1={s.x1}
              y1={s.y1}
              x2={s.x2}
              y2={s.y2}
              stroke={s.stroke}
              strokeWidth="3.5"
              strokeLinecap="round"
              opacity={0.92}
            />
            {(() => {
              const len = Math.hypot(dx, dy);
              if (len > 35) {
                const ux = dx / len;
                const uy = dy / len;
                // Place arrowhead 22px away from destination (just outside circle)
                const tipX = s.x1 + ux * (len - 22);
                const tipY = s.y1 + uy * (len - 22);
                // Base is 14px back from tip
                const baseX = tipX - ux * 14;
                const baseY = tipY - uy * 14;
                // Vector perpendicular to line
                const nx = -uy;
                const ny = ux;
                const p1x = baseX + nx * 7;
                const p1y = baseY + ny * 7;
                const p2x = baseX - nx * 7;
                const p2y = baseY - ny * 7;
                return (
                  <polygon
                    points={`${tipX},${tipY} ${p1x},${p1y} ${p2x},${p2y}`}
                    fill={s.stroke}
                    opacity={0.92}
                  />
                );
              }
              return null;
            })()}
            {s.label && inRange && (
              <g className="opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                <rect
                  x={cx - 24}
                  y={cy - 12}
                  width="48"
                  height="24"
                  fill="rgb(15 23 42 / 0.85)"
                  stroke={s.stroke}
                  strokeWidth="1"
                  rx="4"
                />
                <text
                  x={cx}
                  y={cy}
                  fill="white"
                  fontSize="12"
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontWeight="bold"
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
            <text
              x={n.cx}
              y={n.cy}
              textAnchor="middle"
              dominantBaseline="central"
              fill="white"
              fontSize={Math.max(11, Math.min(18, n.r * 0.45))}
              fontWeight="bold"
              style={{ textShadow: '0 1px 2px rgb(0 0 0 / 0.8)' }}
            >
              {n.label}
            </text>
            <title>
              Fixation {n.label} · target #{n.targetNum} · ~dwell used for size
            </title>
          </g>
        ))}
        {showStimulusReplay &&
          layout.numbers.map((n) => (
            <g key={n.number}>
              <circle
                cx={n.x}
                cy={n.y}
                r={22}
                fill="rgb(30 41 59 / 0.85)"
                stroke="rgb(148 163 184)"
                strokeWidth="1"
              />
              <text
                x={n.x}
                y={n.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill="white"
                fontSize="14"
                fontWeight="bold"
              >
                {n.number}
              </text>
            </g>
          ))}
      </ResultVizAspectSvg>
    </ResultVizMaxFrame>
  );

  if (visualOnly) {
    return svgBlock;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <VisualSearchParamsSection
        completionTimeMs={completionTimeMs}
        sequence={sequence}
        gazeFixationPerNumber={gazeFixationPerNumber}
      />
      <p className="text-[11px] leading-relaxed text-slate-500">
        Đường nhạt + mũi tên = toàn bộ mẫu gaze; đường đậm màu + vòng số 1…N = các fixation (AOI) theo thời gian — giống scanpath tham chiếu.
      </p>
      {noPath && (
        <div className="rounded-lg border border-amber-700/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-100">
          <strong className="text-amber-300">Không có mẫu gaze (scanningPath rỗng).</strong> Màn chỉ hiện stimulus. Mở console (filter{' '}
          <code className="rounded bg-black/40 px-1">[Neuro]</code>) khi hoàn thành bài — phải thấy{' '}
          <code className="rounded bg-black/40 px-1">scanningPathLen &gt; 0</code>. Nếu = 0: thử lại bài vài giây trước khi SPACE; đảm bảo eye
          tracking chạy (NEURO_FLOW).
        </div>
      )}
      {layout.noValidGazeCoords && !noPath && (
        <div className="rounded-lg border border-rose-800/60 bg-rose-950/35 px-3 py-2 text-xs text-rose-100">
          <strong className="text-rose-300">Không có tọa độ gaze hợp lệ trong các mẫu đã lưu.</strong> Thường là pipeline chỉ trả giá trị mặc định (0,0) khi mô hình chưa calibration trong session này — không phải do “nhìn một điểm trên màn”. Làm calibration (tracking) rồi chạy lại bài; nếu đã calibrate mà vẫn vậy, báo dev.
        </div>
      )}
      {layout.gazeMode !== 'pixels' && !noPath && (
        <p className="text-[11px] text-sky-300/95">
          Đã tự nhận dạng tọa độ gaze dạng {layout.gazeMode} và nhân lên kích thước viewport — nếu vị trí sai, báo dev.
        </p>
      )}
      {svgBlock}
    </div>
  );
}
