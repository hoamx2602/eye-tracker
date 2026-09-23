import type { AntiSaccadeDirection } from './constants';
import { DIRECTIONS, OPPOSITE_DIRECTION } from './constants';

/** Shuffle and return a copy. */
function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Generate trial order: each trial has primary direction (random), dim is opposite.
 */
export function generateTrialDirections(count: number, horizontalOnly = false): AntiSaccadeDirection[] {
  // Horizontal only for the step paradigm: the tracker's vertical axis carries
  // a fraction of the horizontal signal, so up/down trials are decided far
  // less reliably, and the clinical anti-saccade task is horizontal anyway.
  const set: AntiSaccadeDirection[] = horizontalOnly ? ['left', 'right'] : [...DIRECTIONS];
  const pool: AntiSaccadeDirection[] = [];
  while (pool.length < count) {
    pool.push(...shuffle(set));
  }
  return pool.slice(0, count);
}

/** Uniform random duration in [minMs, maxMs]. */
export function randomDurationMs(minMs: number, maxMs: number): number {
  return Math.round(minMs + Math.random() * Math.max(0, maxMs - minMs));
}

/**
 * Position of primary rect at progress [0, 1]. centerX/Y in px.
 */
export function primaryPosition(
  direction: AntiSaccadeDirection,
  centerX: number,
  centerY: number,
  progress: number,
  travelPx: number
): { x: number; y: number } {
  const d = progress * travelPx;
  switch (direction) {
    case 'left':
      return { x: centerX - d, y: centerY };
    case 'right':
      return { x: centerX + d, y: centerY };
    case 'up':
      return { x: centerX, y: centerY - d };
    case 'down':
      return { x: centerX, y: centerY + d };
    default:
      return { x: centerX, y: centerY };
  }
}

/**
 * Dim rect moves opposite to primary.
 */
export function dimPosition(
  direction: AntiSaccadeDirection,
  centerX: number,
  centerY: number,
  progress: number,
  travelPx: number
): { x: number; y: number } {
  const opposite = OPPOSITE_DIRECTION[direction];
  return primaryPosition(opposite, centerX, centerY, progress, travelPx);
}
