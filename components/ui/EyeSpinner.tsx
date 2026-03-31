'use client';

/**
 * EyeSpinner — branded eye loading indicator
 *
 * Visual: individual radial line segments radiating from the eye centre.
 * Lines are irregularly spaced, with varying lengths and stroke widths,
 * creating a glitch / energy-field feel (NOT smooth circle rings).
 * Two independent groups rotate at different speeds + directions for depth.
 */

import React from 'react';

export type EyeSpinnerSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE_PX: Record<EyeSpinnerSize, number> = {
  xs: 20,
  sm: 32,
  md: 48,
  lg: 72,
  xl: 96,
};

export interface EyeSpinnerProps {
  size?:      EyeSpinnerSize | number;
  className?: string;
  label?:     string;
  color?:     string;
}

// ─── Line definitions ───────────────────────────────────────────────────────
// Each tuple: [angleDeg, innerRadius, outerRadius, strokeWidth, opacity]
// innerRadius = where line starts from center; outerRadius = where it ends.
// Angular spacing is intentionally non-uniform (clusters + gaps → glitch feel).

type L = [number, number, number, number, number];

// Main group — 30 lines, ~2.5s CW
// Prominent long/thick marks with short/thin "satellite" marks in between.
const MAIN: L[] = [
  [0,   35, 47, 2.8, 0.95],
  [13,  40, 44, 0.7, 0.38],
  [23,  37, 45, 1.3, 0.65],
  [34,  41, 43, 0.6, 0.28],
  [46,  35, 46, 2.3, 0.85],
  [56,  40, 43, 0.8, 0.42],
  [67,  36, 50, 2.7, 0.92],
  [75,  41, 45, 0.7, 0.35],
  [85,  37, 43, 1.2, 0.58],
  [96,  40, 44, 0.8, 0.40],
  [107, 35, 47, 2.5, 0.88],
  [119, 39, 43, 1.0, 0.48],
  [131, 36, 49, 2.8, 0.93],
  [142, 41, 44, 0.6, 0.30],
  [153, 37, 43, 1.2, 0.60],
  [166, 40, 44, 0.8, 0.42],
  [177, 35, 46, 2.2, 0.82],
  [189, 39, 43, 0.9, 0.45],
  [201, 36, 50, 2.9, 0.96],
  [214, 41, 44, 0.6, 0.30],
  [225, 37, 44, 1.2, 0.56],
  [239, 40, 44, 0.8, 0.40],
  [251, 35, 48, 2.4, 0.88],
  [263, 39, 44, 1.0, 0.50],
  [276, 36, 50, 2.7, 0.92],
  [289, 41, 44, 0.6, 0.30],
  [301, 37, 43, 1.2, 0.57],
  [314, 40, 44, 0.8, 0.40],
  [327, 35, 47, 2.1, 0.82],
  [344, 39, 42, 0.9, 0.46],
];

// Secondary group — 12 shorter lines at tighter radii, ~6.5s CCW.
// Overlap with MAIN at some angles → creates the "stacked depth" effect.
const SECONDARY: L[] = [
  [8,   32, 40, 1.6, 0.42],
  [40,  32, 38, 1.0, 0.30],
  [72,  32, 41, 1.8, 0.48],
  [105, 32, 37, 0.9, 0.28],
  [138, 32, 40, 1.4, 0.38],
  [168, 32, 38, 1.0, 0.30],
  [197, 32, 42, 1.9, 0.50],
  [228, 32, 37, 0.8, 0.26],
  [258, 32, 40, 1.5, 0.40],
  [285, 32, 38, 1.0, 0.30],
  [318, 32, 41, 1.7, 0.44],
  [352, 32, 37, 0.9, 0.28],
];

// Outer accent group — 8 very fine long lines, ~11s CW (almost static).
const OUTER: L[] = [
  [20,  44, 52, 0.5, 0.18],
  [65,  44, 51, 0.5, 0.15],
  [112, 44, 53, 0.5, 0.18],
  [158, 44, 50, 0.5, 0.14],
  [195, 44, 52, 0.5, 0.17],
  [243, 44, 51, 0.5, 0.15],
  [288, 44, 53, 0.5, 0.18],
  [335, 44, 50, 0.5, 0.14],
];

// ─── Helper ─────────────────────────────────────────────────────────────────

function LineGroup({
  lines,
  color,
  dur,
  ccw,
  glowId,
  bright,
}: {
  lines: L[];
  color: string;
  dur: string;
  ccw?: boolean;
  glowId?: string;
  bright?: boolean;
}) {
  return (
    <g filter={bright && glowId ? `url(#${glowId})` : undefined}>
      {lines.map(([angle, innerR, outerR, sw, opacity], i) => (
        <line
          key={i}
          x1="50"
          y1={50 - outerR}
          x2="50"
          y2={50 - innerR}
          stroke={color}
          strokeWidth={sw}
          strokeLinecap="round"
          opacity={opacity}
          transform={`rotate(${angle} 50 50)`}
        />
      ))}
      <animateTransform
        attributeName="transform"
        attributeType="XML"
        type="rotate"
        from={`0 50 50`}
        to={`${ccw ? -360 : 360} 50 50`}
        dur={dur}
        repeatCount="indefinite"
      />
    </g>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function EyeSpinner({
  size      = 'md',
  className = '',
  label,
  color     = '#3b82f6',
}: EyeSpinnerProps) {
  const px  = typeof size === 'number' ? size : SIZE_PX[size];
  const uid = React.useId().replace(/:/g, '');

  return (
    <div className="inline-flex flex-col items-center gap-2">
      <svg
        width={px}
        height={px}
        viewBox="0 0 100 100"
        className={className}
        aria-label={label ?? 'Loading'}
        role="img"
        overflow="visible"
      >
        <defs>
          <radialGradient id={`${uid}-iris`} cx="44%" cy="37%" r="66%">
            <stop offset="0%"   stopColor="#bfdbfe" />
            <stop offset="45%"  stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#1e3a8a" />
          </radialGradient>
          <radialGradient id={`${uid}-pupil`} cx="38%" cy="34%" r="58%">
            <stop offset="0%"   stopColor="#1e1b4b" />
            <stop offset="100%" stopColor="#03010a" />
          </radialGradient>
          {/* Glow for the main ring */}
          <filter id={`${uid}-glow`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* ── Outer ghost ring ─── almost-static, barely visible */}
        <LineGroup lines={OUTER}     color={color} dur="11s"   />

        {/* ── Secondary ring ─── tighter, CCW, creates depth */}
        <LineGroup lines={SECONDARY} color={color} dur="6.5s" ccw />

        {/* ── Main energy ring ─── primary visual, CW, glow */}
        <LineGroup lines={MAIN}      color={color} dur="2.5s"
                   glowId={`${uid}-glow`} bright />

        {/* ── Eye outline ────────────────────────────────────────── */}
        <path
          d="M 23,50 C 33,29 67,29 77,50 C 67,71 33,71 23,50 Z"
          fill="none"
          stroke="#93c5fd"
          strokeWidth="1.4"
          strokeLinecap="round"
          opacity="0.75"
        />

        {/* ── Iris ─────────────────────────────────────────────── */}
        <circle cx="50" cy="50" r="11.5" fill={`url(#${uid}-iris)`} />

        {/* ── Limbal ring ──────────────────────────────────────── */}
        <circle cx="50" cy="50" r="11.5"
          fill="none" stroke="#1e3a8a" strokeWidth="1" opacity="0.55" />

        {/* ── Pupil ────────────────────────────────────────────── */}
        <circle cx="50" cy="50" r="5.2" fill={`url(#${uid}-pupil)`} />

        {/* ── Specular highlights ──────────────────────────────── */}
        <circle cx="54.5" cy="45.5" r="2.3" fill="white" opacity="0.82" />
        <circle cx="46"   cy="53"   r="1.0" fill="white" opacity="0.28" />
      </svg>

      {label && (
        <span className="text-sm text-blue-300 font-medium animate-pulse select-none">
          {label}
        </span>
      )}
    </div>
  );
}
