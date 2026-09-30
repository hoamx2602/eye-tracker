'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

/**
 * Chart primitives for the facial-speech report. Plain inline SVG: the payload
 * is a few hundred points per panel, so a charting dependency would cost more
 * than it saves.
 *
 * The palette is validated for the dark chart surface (#111827) — worst
 * adjacent CVD separation 27.3 ΔE, normal-vision 29.9 ΔE. Left and right are
 * also always direct-labelled, so which side a mark belongs to never rests on
 * colour alone. These are the same colours the backend draws the landmarks in,
 * so a dot on a face and a line on a plot mean the same side.
 */
export const SIDE_COLOR = { left: '#3987e5', right: '#008300' } as const;
const GRID = '#374151';
const AXIS_TEXT = '#9ca3af';

const WIDTH = 640;
const HEIGHT = 190;
const PAD = { top: 14, right: 14, bottom: 26, left: 44 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [min];
  const raw = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((value) => value >= raw) ?? magnitude * 10;
  const ticks: number[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max + step * 0.001; value += step) ticks.push(value);
  return ticks;
}

function format(value: number, unit: string) {
  const decimals = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : Math.abs(value) >= 1 ? 2 : 3;
  return `${value.toFixed(decimals)}${unit ? ` ${unit}` : ''}`;
}

interface HoverState {
  index: number;
  clientX: number;
}

/** Shared frame: grid, axes, tick labels, and the hover crosshair plumbing. */
function ChartFrame({
  children,
  xTicks,
  yTicks,
  xScale,
  yScale,
  xUnit,
  yUnit,
  pointCount,
  onHover,
  hover,
  tooltip,
}: {
  children: React.ReactNode;
  xTicks: number[];
  yTicks: number[];
  xScale: (value: number) => number;
  yScale: (value: number) => number;
  xUnit: string;
  yUnit: string;
  pointCount: number;
  onHover: (state: HoverState | null) => void;
  hover: HoverState | null;
  tooltip?: { x: number; rows: { label: string; value: string; color?: string }[] };
}) {
  const ref = useRef<SVGSVGElement>(null);

  const handleMove = useCallback(
    (event: React.MouseEvent<SVGSVGElement>) => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect || pointCount === 0) return;
      const fraction = (event.clientX - rect.left) / rect.width;
      const plotFraction = (fraction * WIDTH - PAD.left) / PLOT_W;
      const index = Math.round(plotFraction * (pointCount - 1));
      if (index < 0 || index >= pointCount) {
        onHover(null);
        return;
      }
      onHover({ index, clientX: event.clientX - rect.left });
    },
    [onHover, pointCount],
  );

  return (
    <div className="relative">
      <svg
        ref={ref}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full touch-none"
        role="img"
        onMouseMove={handleMove}
        onMouseLeave={() => onHover(null)}
      >
        {yTicks.map((tick) => (
          <g key={`y${tick}`}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={yScale(tick)} y2={yScale(tick)} stroke={GRID} strokeWidth={1} />
            <text x={PAD.left - 6} y={yScale(tick) + 3.5} textAnchor="end" fontSize={10} fill={AXIS_TEXT}>
              {format(tick, '')}
            </text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <text key={`x${tick}`} x={xScale(tick)} y={HEIGHT - 8} textAnchor="middle" fontSize={10} fill={AXIS_TEXT}>
            {format(tick, '')}
          </text>
        ))}
        <text x={WIDTH - PAD.right} y={HEIGHT - 8} textAnchor="end" fontSize={10} fill={AXIS_TEXT}>
          {xUnit}
        </text>
        <text x={PAD.left - 6} y={PAD.top - 4} textAnchor="end" fontSize={10} fill={AXIS_TEXT}>
          {yUnit}
        </text>
        {children}
        {tooltip ? (
          <line x1={tooltip.x} x2={tooltip.x} y1={PAD.top} y2={PAD.top + PLOT_H} stroke="#9ca3af" strokeWidth={1} strokeDasharray="3 3" />
        ) : null}
      </svg>
      {tooltip && hover ? (
        <div
          className="pointer-events-none absolute top-2 z-10 rounded-lg border border-gray-700 bg-gray-950/95 px-2.5 py-1.5 text-[11px] shadow-xl"
          style={{
            left: `${(tooltip.x / WIDTH) * 100}%`,
            transform: tooltip.x > WIDTH / 2 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)',
          }}
        >
          {tooltip.rows.map((row) => (
            <div key={row.label} className="flex items-center gap-2 whitespace-nowrap">
              {row.color ? <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: row.color }} /> : null}
              <span className="text-gray-400">{row.label}</span>
              <span className="ml-auto font-mono text-gray-100">{row.value}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Left-versus-right trace over one task window, with the peak marked. */
export function SideTraceChart({
  tMs,
  left,
  right,
  unit,
  peakTMs,
}: {
  tMs: number[];
  left: number[];
  right: number[];
  unit: string;
  peakTMs: number;
}) {
  const [hover, setHover] = useState<HoverState | null>(null);
  const geometry = useMemo(() => {
    const t0 = tMs[0] ?? 0;
    const seconds = tMs.map((value) => (value - t0) / 1000);
    const xMax = Math.max(seconds[seconds.length - 1] ?? 1, 0.001);
    const yMax = Math.max(...left, ...right, 0.001) * 1.1;
    const xScale = (value: number) => PAD.left + (value / xMax) * PLOT_W;
    const yScale = (value: number) => PAD.top + PLOT_H - (value / yMax) * PLOT_H;
    const path = (values: number[]) =>
      values.map((value, index) => `${index ? 'L' : 'M'}${xScale(seconds[index]).toFixed(1)} ${yScale(value).toFixed(1)}`).join(' ');
    return {
      seconds,
      xScale,
      yScale,
      leftPath: path(left),
      rightPath: path(right),
      xTicks: niceTicks(0, xMax),
      yTicks: niceTicks(0, yMax),
      peakX: xScale((peakTMs - t0) / 1000),
    };
  }, [tMs, left, right, peakTMs]);

  const tooltip = hover
    ? {
        x: geometry.xScale(geometry.seconds[hover.index]),
        rows: [
          { label: 'time', value: `${geometry.seconds[hover.index].toFixed(2)} s` },
          { label: 'left', value: format(left[hover.index], unit), color: SIDE_COLOR.left },
          { label: 'right', value: format(right[hover.index], unit), color: SIDE_COLOR.right },
        ],
      }
    : undefined;

  return (
    <ChartFrame
      xTicks={geometry.xTicks}
      yTicks={geometry.yTicks}
      xScale={geometry.xScale}
      yScale={geometry.yScale}
      xUnit="s"
      yUnit={unit}
      pointCount={tMs.length}
      onHover={setHover}
      hover={hover}
      tooltip={tooltip}
    >
      <line
        x1={geometry.peakX}
        x2={geometry.peakX}
        y1={PAD.top}
        y2={PAD.top + PLOT_H}
        stroke="#6b7280"
        strokeWidth={1}
        strokeDasharray="2 4"
      />
      <text x={geometry.peakX} y={PAD.top - 3} textAnchor="middle" fontSize={9} fill="#6b7280">
        peak
      </text>
      <path d={geometry.rightPath} fill="none" stroke={SIDE_COLOR.right} strokeWidth={2} strokeLinejoin="round" />
      <path d={geometry.leftPath} fill="none" stroke={SIDE_COLOR.left} strokeWidth={2} strokeLinejoin="round" />
      {hover ? (
        <>
          <circle cx={geometry.xScale(geometry.seconds[hover.index])} cy={geometry.yScale(right[hover.index])} r={4} fill={SIDE_COLOR.right} stroke="#111827" strokeWidth={2} />
          <circle cx={geometry.xScale(geometry.seconds[hover.index])} cy={geometry.yScale(left[hover.index])} r={4} fill={SIDE_COLOR.left} stroke="#111827" strokeWidth={2} />
        </>
      ) : null}
    </ChartFrame>
  );
}

/** Energy envelope with the segments that were treated as speech shaded in. */
export function EnvelopeChart({
  envelope,
  gate,
  trials,
  durationS,
}: {
  envelope: number[];
  gate: number;
  trials: [number, number][];
  durationS: number;
}) {
  const [hover, setHover] = useState<HoverState | null>(null);
  const geometry = useMemo(() => {
    const yMax = Math.max(...envelope, gate, 0.001) * 1.15;
    const xScale = (value: number) => PAD.left + (value / Math.max(durationS, 0.001)) * PLOT_W;
    const yScale = (value: number) => PAD.top + PLOT_H - (value / yMax) * PLOT_H;
    const step = durationS / Math.max(envelope.length - 1, 1);
    const area =
      `M${xScale(0).toFixed(1)} ${yScale(0).toFixed(1)} ` +
      envelope.map((value, index) => `L${xScale(index * step).toFixed(1)} ${yScale(value).toFixed(1)}`).join(' ') +
      ` L${xScale(durationS).toFixed(1)} ${yScale(0).toFixed(1)} Z`;
    return { xScale, yScale, area, step, yMax, xTicks: niceTicks(0, durationS), yTicks: niceTicks(0, yMax, 3) };
  }, [envelope, gate, durationS]);

  const tooltip = hover
    ? {
        x: geometry.xScale(hover.index * geometry.step),
        rows: [
          { label: 'time', value: `${(hover.index * geometry.step).toFixed(2)} s` },
          { label: 'level', value: envelope[hover.index]?.toFixed(3) ?? '—' },
        ],
      }
    : undefined;

  return (
    <ChartFrame
      xTicks={geometry.xTicks}
      yTicks={geometry.yTicks}
      xScale={geometry.xScale}
      yScale={geometry.yScale}
      xUnit="s"
      yUnit="rms"
      pointCount={envelope.length}
      onHover={setHover}
      hover={hover}
      tooltip={tooltip}
    >
      {trials.map(([start, end], index) => (
        <g key={`${start}-${end}`}>
          <rect
            x={geometry.xScale(start)}
            y={PAD.top}
            width={Math.max(geometry.xScale(end) - geometry.xScale(start), 1)}
            height={PLOT_H}
            fill={SIDE_COLOR.left}
            opacity={0.14}
          />
          <text x={(geometry.xScale(start) + geometry.xScale(end)) / 2} y={PAD.top + 10} textAnchor="middle" fontSize={9} fill="#9ca3af">
            {index + 1}
          </text>
        </g>
      ))}
      <path d={geometry.area} fill="#4b5563" opacity={0.55} />
      <line x1={PAD.left} x2={WIDTH - PAD.right} y1={geometry.yScale(gate)} y2={geometry.yScale(gate)} stroke="#eab308" strokeWidth={1.5} strokeDasharray="4 3" />
      <text x={WIDTH - PAD.right} y={geometry.yScale(gate) - 4} textAnchor="end" fontSize={9} fill="#eab308">
        speech gate
      </text>
    </ChartFrame>
  );
}

/** Pitch track per phonation. Gaps are unvoiced frames, not zero-pitch frames. */
export function PitchContourChart({ contours }: { contours: { trial: number; hz: (number | null)[]; step_s: number }[] }) {
  const geometry = useMemo(() => {
    const values = contours.flatMap((contour) => contour.hz.filter((value): value is number => value !== null));
    if (!values.length) return null;
    const yMin = Math.min(...values) * 0.9;
    const yMax = Math.max(...values) * 1.1;
    const longest = Math.max(...contours.map((contour) => contour.hz.length));
    const durationS = longest * (contours[0]?.step_s ?? 0.01);
    const xScale = (value: number) => PAD.left + (value / Math.max(durationS, 0.001)) * PLOT_W;
    const yScale = (value: number) => PAD.top + PLOT_H - ((value - yMin) / Math.max(yMax - yMin, 0.001)) * PLOT_H;
    // Each unvoiced run starts a new subpath, so voice breaks render as gaps.
    const paths = contours.map((contour) => {
      let path = '';
      let pen = false;
      contour.hz.forEach((value, index) => {
        if (value === null) {
          pen = false;
          return;
        }
        path += `${pen ? 'L' : 'M'}${xScale(index * contour.step_s).toFixed(1)} ${yScale(value).toFixed(1)} `;
        pen = true;
      });
      return { trial: contour.trial, path };
    });
    return { xScale, yScale, paths, durationS, yMin, yMax };
  }, [contours]);

  if (!geometry) return null;
  // Trials of the same task are one entity measured repeatedly, so they share a
  // hue and are separated by opacity rather than by being recoloured as if they
  // were different series.
  return (
    <ChartFrame
      xTicks={niceTicks(0, geometry.durationS)}
      yTicks={niceTicks(geometry.yMin, geometry.yMax, 3)}
      xScale={geometry.xScale}
      yScale={geometry.yScale}
      xUnit="s"
      yUnit="Hz"
      pointCount={0}
      onHover={() => undefined}
      hover={null}
    >
      {geometry.paths.map((item, index) => (
        <path
          key={item.trial}
          d={item.path}
          fill="none"
          stroke={SIDE_COLOR.left}
          strokeWidth={2}
          strokeLinecap="round"
          opacity={1 - index * 0.28}
        />
      ))}
    </ChartFrame>
  );
}

export function SideLegend() {
  return (
    <div className="flex items-center gap-4 text-[11px] text-gray-400">
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full" style={{ background: SIDE_COLOR.left }} /> Left (subject)
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full" style={{ background: SIDE_COLOR.right }} /> Right (subject)
      </span>
    </div>
  );
}
