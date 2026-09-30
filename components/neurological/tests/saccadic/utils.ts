import type { SaccadicTargetSide } from './constants';
import {
  LEFT_TARGET_X_FRACTION,
  RIGHT_TARGET_X_FRACTION,
  TARGET_Y_FRACTION,
} from './constants';

/**
 * Target center position in screen pixels.
 * edgePaddingPx: minimum gap (px) between target center and screen edge; defaults to 0 (no clamp).
 */
export function getTargetPosition(
  side: SaccadicTargetSide,
  viewportWidth: number,
  viewportHeight: number,
  edgePaddingPx = 0
): { x: number; y: number } {
  const rawX =
    side === 'left'
      ? viewportWidth * LEFT_TARGET_X_FRACTION
      : viewportWidth * RIGHT_TARGET_X_FRACTION;
  const rawY = viewportHeight * TARGET_Y_FRACTION;
  const pad = Math.max(0, edgePaddingPx);
  const x = Math.max(pad, Math.min(viewportWidth - pad, rawX));
  const y = Math.max(pad, Math.min(viewportHeight - pad, rawY));
  return { x, y };
}

/** `count` sides, half left and half right (the odd one random), shuffled. */
export function balancedSides(count: number): SaccadicTargetSide[] {
  const sides: SaccadicTargetSide[] = [];
  for (let i = 0; i < count; i++) sides.push(i % 2 === 0 ? 'left' : 'right');
  if (count % 2 === 1 && Math.random() < 0.5) sides[count - 1] = 'right';
  for (let i = sides.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [sides[i], sides[j]] = [sides[j]!, sides[i]!];
  }
  return sides;
}

/** Uniform random fixation duration in [minMs, maxMs]. */
export function randomFixationMs(minMs: number, maxMs: number): number {
  return Math.round(minMs + Math.random() * Math.max(0, maxMs - minMs));
}
