'use client';

/**
 * GazeOverlay — renders a visual gaze cursor on top of the viewport.
 *
 * Uses CSS transform for position (GPU-composited, zero layout cost).
 * Confidence < 0.5 dims the dot to signal unreliable prediction (blink, occlusion).
 */

import React from 'react';
import { useGaze } from '../hooks/useGaze';

export interface GazeOverlayProps {
  /** Dot radius in px. Default 10. */
  radius?: number;
  /** Dot colour. Default 'rgba(99,102,241,0.8)' (indigo). */
  color?: string;
  /** Show confidence ring (dims when confidence < 0.5). Default true. */
  showConfidence?: boolean;
  /** Only show when gazeModelReady. Default true. */
  requireCalibrated?: boolean;
}

export default function GazeOverlay({
  radius = 10,
  color = 'rgba(99,102,241,0.85)',
  showConfidence = true,
  requireCalibrated = true,
}: GazeOverlayProps) {
  const { gaze, gazeModelReady } = useGaze();

  if (requireCalibrated && !gazeModelReady) return null;
  if (!gaze) return null;

  const dim = radius * 2;
  const opacity = showConfidence ? Math.max(0.25, gaze.confidence) : 1;

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        pointerEvents: 'none',
        zIndex: 9999,
        transform: `translate(${gaze.x - radius}px, ${gaze.y - radius}px)`,
        width: dim,
        height: dim,
        borderRadius: '50%',
        backgroundColor: color,
        opacity,
        // GPU layer: skip layout & paint, straight to compositor
        willChange: 'transform',
        transition: 'opacity 0.15s',
      }}
    />
  );
}
