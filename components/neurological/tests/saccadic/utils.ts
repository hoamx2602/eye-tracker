import type { SaccadicTargetSide } from './constants';
import {
  LEFT_TARGET_X_FRACTION,
  RIGHT_TARGET_X_FRACTION,
  TARGET_Y_FRACTION,
} from './constants';

/**
 * Target center position in screen pixels.
 */
export function getTargetPosition(
  side: SaccadicTargetSide,
  viewportWidth: number,
  viewportHeight: number
): { x: number; y: number } {
  const x =
    side === 'left'
      ? viewportWidth * LEFT_TARGET_X_FRACTION
      : viewportWidth * RIGHT_TARGET_X_FRACTION;
  const y = viewportHeight * TARGET_Y_FRACTION;
  return { x, y };
}
