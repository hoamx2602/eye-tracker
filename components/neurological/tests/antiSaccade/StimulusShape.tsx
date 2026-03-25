'use client';

import React from 'react';
import { resolveAntiSaccadeRectHex } from './constants';
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
  const borderClass = isPrimary ? 'border-2' : 'border-2 border-dashed';

  const primaryResolved = resolveAntiSaccadeRectHex(primaryColor, 'primary', 'red');
  const dimResolved = resolveAntiSaccadeRectHex(dimColor, 'dim', 'blue');

  const commonStyle: React.CSSProperties = {
    left,
    top,
    width,
    height,
    opacity,
    ...style,
    backgroundColor: isPrimary ? primaryResolved.fillHex : dimResolved.fillHex,
    borderColor: isPrimary ? primaryResolved.borderHex : dimResolved.borderHex,
  };

  if (shape === 'rectangle') {
    return (
      <div
        className={`${baseClass} rounded-lg ${borderClass} ${className}`}
        style={commonStyle}
        aria-hidden={ariaHidden}
      />
    );
  }

  if (shape === 'circle' || shape === 'ball') {
    return (
      <div
        className={`${baseClass} rounded-full ${borderClass} ${className}`}
        style={commonStyle}
        aria-hidden={ariaHidden}
      />
    );
  }

  if (shape === 'triangle') {
    const clip = 'polygon(50% 0%, 0% 100%, 100% 100%)';
    return (
      <div
        className={`${baseClass} ${borderClass} ${className}`}
        style={{ ...commonStyle, clipPath: clip, WebkitClipPath: clip, borderRadius: 2 }}
        aria-hidden={ariaHidden}
      />
    );
  }

  if (shape === 'table') {
    return (
      <div
        className={`${baseClass} rounded-lg ${borderClass} ${className}`}
        style={commonStyle}
        aria-hidden={ariaHidden}
      />
    );
  }

  if (shape === 'chair') {
    const size = Math.min(width, height) * 0.85;
    return (
      <div
        className={`${baseClass} rounded-lg ${borderClass} ${className}`}
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
      className={`${baseClass} rounded-lg ${borderClass} ${className}`}
      style={commonStyle}
      aria-hidden={ariaHidden}
    />
  );
}
