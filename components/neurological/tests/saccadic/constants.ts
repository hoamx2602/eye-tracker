import type { GuideStep } from '../../types';

/** Guide steps for Test 5: Saccadic Eye Movement — PDF. */
export const SACCADIC_GUIDE_STEPS: GuideStep[] = [
  {
    id: '1',
    title: 'Saccadic Eye Movement',
    body: 'A small dot will appear in the centre of the screen. Look at it. After a moment, a target will appear on the left or the right. Your task is to look at the target as soon as it appears.',
  },
  {
    id: '2',
    body: 'Move your eyes quickly to the target when it appears, then back to the centre dot when it returns. The side and the timing change at random, so you cannot guess them — just react.',
  },
  {
    id: '3',
    title: 'Targets',
    body: 'You will see several targets. We measure how quickly and accurately you look at each one.',
  },
];

export type SaccadicTargetSide = 'left' | 'right';

/** Duration (ms) each target is shown before the centre dot returns. */
export const DEFAULT_TARGET_DURATION_MS = 1000;
/**
 * Central fixation before each target is drawn uniformly from this range (ms).
 * A fixed interval lets the participant time the jump in advance, and the
 * measured "latency" becomes an anticipation.
 */
export const DEFAULT_FIXATION_MIN_MS = 1000;
export const DEFAULT_FIXATION_MAX_MS = 2000;
/** Diameter of the central fixation dot (px). */
export const FIXATION_DOT_SIZE_PX = 14;
/** Total number of target appearances (cycles). 18 = 9 left + 9 right, in random order. */
export const DEFAULT_TOTAL_CYCLES = 18;
/** Practice: number of cycles. */
export const PRACTICE_CYCLES = 3;
/** Horizontal position of left target as fraction of viewport width (0–1). */
export const LEFT_TARGET_X_FRACTION = 0.25;
/** Horizontal position of right target. */
export const RIGHT_TARGET_X_FRACTION = 0.75;
/** Vertical center for both targets (0–1). */
export const TARGET_Y_FRACTION = 0.5;
/** AOI radius (px): gaze within this distance of target center counts as fixation. */
export const AOI_RADIUS_PX = 80;
/** Gaze sample interval (ms) per cycle. */
export const GAZE_SAMPLE_INTERVAL_MS = 100;
