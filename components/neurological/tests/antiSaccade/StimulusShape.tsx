'use client';

import React from 'react';
import type { AntiSaccadeRectColor, AntiSaccadeStimulusShape } from './constants';

export type StimulusShapeProps = {
  shape: AntiSaccadeStimulusShape;
  left: number;
  top: number;
  width: number;
  height: number;
  isPrimary: boolean;
  primaryColor?: AntiSaccadeRectColor;
  dimColor?: AntiSaccadeRectColor;
  opacity?: number;
  className?: string;
  style?: React.CSSProperties;
  ariaHidden?: boolean;
};

/** Stimulus shape: drawn via CSS or emoji. */
export default function StimulusShape({
  shape,
  left,
  top,
  width,
  height,
  isPrimary,
  primaryColor = 'red',
  dimColor = 'blue',
  opacity = 1,
  className = '',
  style = {},
  ariaHidden,
}: StimulusShapeProps) {
  const baseClass = 'absolute flex items-center justify-center';

  const PRIMARY: Record<AntiSaccadeRectColor, { fill: string; border: string }> = {
    red: { fill: 'bg-red-400', border: 'border-red-300' },
    blue: { fill: 'bg-blue-400', border: 'border-blue-300' },
  };
  const DIM: Record<AntiSaccadeRectColor, { fill: string; border: string }> = {
    red: { fill: 'bg-red-500', border: 'border-red-300' },
    blue: { fill: 'bg-blue-500', border: 'border-blue-300' },
  };

  const primaryClass = `${PRIMARY[primaryColor].fill} border-2 ${PRIMARY[primaryColor].border}`;
  const dimClass = `border-2 border-dashed ${DIM[dimColor].border} ${DIM[dimColor].fill}`;

  const commonStyle: React.CSSProperties = {
    left,
    top,
    width,
    height,
    opacity,
    ...style,
  };

  if (shape === 'rectangle') {
    return (
      <div
        className={`${baseClass} rounded-lg ${isPrimary ? primaryClass : dimClass} ${className}`}
        style={commonStyle}
        aria-hidden={ariaHidden}
      />
    );
  }

  if (shape === 'circle' || shape === 'ball') {
    return (
      <div
        className={`${baseClass} rounded-full ${isPrimary ? primaryClass : dimClass} ${className}`}
        style={commonStyle}
        aria-hidden={ariaHidden}
      />
    );
  }

  if (shape === 'triangle') {
    const clip = 'polygon(50% 0%, 0% 100%, 100% 100%)';
    return (
      <div
        className={`${baseClass} ${isPrimary ? primaryClass : dimClass} ${className}`}
        style={{ ...commonStyle, clipPath: clip, WebkitClipPath: clip, borderRadius: 2 }}
        aria-hidden={ariaHidden}
      />
    );
  }

  if (shape === 'table') {
    return (
      <div
        className={`${baseClass} rounded-lg ${isPrimary ? 'bg-amber-600 border-2 border-amber-500' : 'border-2 border-dashed border-amber-700 bg-amber-800/60'} ${className}`}
        style={commonStyle}
        aria-hidden={ariaHidden}
      />
    );
  }

  if (shape === 'chair') {
    const size = Math.min(width, height) * 0.85;
    return (
      <div
        className={`${baseClass} rounded-lg ${isPrimary ? 'bg-amber-100 border-2 border-amber-400' : 'border-2 border-dashed border-amber-700 bg-amber-900/50'} ${className}`}
        style={commonStyle}
        aria-hidden={ariaHidden}
      >
        <span style={{ fontSize: size }} role="img" aria-label="Chair">
          🪑
        </span>
      </div>
    );
  }

  return (
    <div
      className={`${baseClass} rounded-lg ${isPrimary ? primaryClass : dimClass} ${className}`}
      style={commonStyle}
      aria-hidden={ariaHidden}
    />
  );
}
