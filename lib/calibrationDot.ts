/**
 * The shrinking dot used by calibration (components/CalibrationLayer.tsx) and
 * the pre-test drift check (components/neurological/RealTestIntro.tsx).
 *
 * It appears large and contracts to a small point: the change in size pulls
 * the eye to it without instructions, and the contraction draws the eye to its
 * centre, the spot its coordinates label (the iOS / Tobii calibration dot).
 * The start has to be clearly larger than the end, and the shrink slow enough
 * to be seen — at 44 → 14 px over 700 ms with a front-loaded curve it read as
 * a small dot from the first frame.
 */
export const CALIB_DOT_START_PX = 80;
/** End size as a fraction of the start: 80 px × 0.2 = 16 px. */
export const CALIB_DOT_END_SCALE = 0.2;
/**
 * Also the calibration settle floor (App.tsx): frames count only once the dot
 * is small, then a 700 ms stable run completes it — ~1.5 s per dot for a
 * steady participant, longer when the gaze takes time to settle.
 */
export const CALIB_DOT_SHRINK_MS = 800;
/** Even ease-in-out, so the large phase is visible rather than gone in the first frames. */
export const CALIB_DOT_EASING = 'cubic-bezier(0.45, 0, 0.25, 1)';
/** Border at the start size; scales down with the dot (≈1.2 px at the end). */
export const CALIB_DOT_BORDER_PX = 6;

/** Inline style for the dot element (centred on its left/top). */
export function calibDotStyle(): Record<string, string | number> {
  return {
    width: CALIB_DOT_START_PX,
    height: CALIB_DOT_START_PX,
    border: `${CALIB_DOT_BORDER_PX}px solid white`,
    transform: `translate(-50%, -50%) scale(${CALIB_DOT_END_SCALE})`,
    animation: `calib-dot-shrink ${CALIB_DOT_SHRINK_MS}ms ${CALIB_DOT_EASING} both`,
    '--calib-dot-end': CALIB_DOT_END_SCALE,
  };
}
