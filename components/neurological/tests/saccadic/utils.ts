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
