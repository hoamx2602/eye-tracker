'use client';

import React from 'react';
import type { AntiSaccadeStimulusShape } from './constants';

export type StimulusShapeProps = {
  shape: AntiSaccadeStimulusShape;
  left: number;
  top: number;
  width: number;
  height: number;
  isPrimary: boolean;
  opacity?: number;
  className?: string;
  style?: React.CSSProperties;
  ariaHidden?: boolean;
};

/** Vật thể kích thích: vẽ theo shape (CSS hoặc emoji). */
export default function StimulusShape({
  shape,
  left,
  top,
  width,
  height,
  isPrimary,
  opacity = 1,
  className = '',
  style = {},
  ariaHidden,
}: StimulusShapeProps) {
  const baseClass = 'absolute flex items-center justify-center';
  const primaryClass = 'bg-blue-400 border-2 border-blue-300';
  const dimClass = 'border-2 border-dashed border-slate-400 bg-slate-500';

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
        className={`${baseClass} rounded-full ${isPrimary ? 'bg-blue-400 border-2 border-blue-300' : 'border-2 border-dashed border-slate-400 bg-slate-500'} ${className}`}
        style={commonStyle}
        aria-hidden={ariaHidden}
      />
    );
  }

  if (shape === 'triangle') {
    const clip = 'polygon(50% 0%, 0% 100%, 100% 100%)';
    return (
      <div
        className={`${baseClass} ${isPrimary ? 'bg-blue-400 border-2 border-blue-300' : 'border-2 border-dashed border-slate-400 bg-slate-500'} ${className}`}
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
        <span style={{ fontSize: size }} role="img" aria-label="Ghế">
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
