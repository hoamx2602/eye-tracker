'use client';

import React from 'react';

type Pt = { x: number; y: number };

/**
 * Mũi tên hướng nhìn dọc polyline — mỗi `step` đoạn vẽ một mũi tại 1/3 đoạn (hướng tới điểm sau).
 */
export function GazePathDirectionArrows({
  points,
  step = 8,
  fill = 'rgb(125 211 252)',
  size = 6,
}: {
  points: Pt[];
  step?: number;
  fill?: string;
  size?: number;
}) {
  if (points.length < 2) return null;
  const els: React.ReactNode[] = [];
  let k = 0;
  for (let i = 0; i < points.length - 1; i += step) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 4) continue;
    const px = a.x + dx * 0.35;
    const py = a.y + dy * 0.35;
    const ang = Math.atan2(dy, dx) * (180 / Math.PI);
    els.push(
      <g key={`arr-${k++}`} transform={`translate(${px},${py}) rotate(${ang})`}>
        <polygon points={`0,-${size * 0.45} ${size},0 0,${size * 0.45}`} fill={fill} opacity={0.9} />
      </g>
    );
  }
  return <g aria-hidden>{els}</g>;
}

/** Heatmap đơn giản: chấm mờ chồng lên nhau. */
export function GazeHeatmapLayer({
  points,
  radius = 22,
  opacity = 0.06,
  fill = 'rgb(251 191 36)',
}: {
  points: Pt[];
  radius?: number;
  opacity?: number;
  fill?: string;
}) {
  if (points.length === 0) return null;
  const step = points.length > 2000 ? Math.ceil(points.length / 2000) : 1;
  const els: React.ReactNode[] = [];
  let k = 0;
  for (let i = 0; i < points.length; i += step) {
    const p = points[i];
    els.push(<circle key={`h-${k++}`} cx={p.x} cy={p.y} r={radius} fill={fill} opacity={opacity} />);
  }
  return <g aria-hidden>{els}</g>;
}
