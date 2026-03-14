import type { GuideStep } from '../../types';

/** Guide steps for Test 5: Saccadic Eye Movement — PDF. */
export const SACCADIC_GUIDE_STEPS: GuideStep[] = [
  {
    id: '1',
    title: 'Saccadic Eye Movement',
    body: 'A target will appear on the left or right side of the screen and switch sides every second. Your task is to look at the target as soon as it appears.',
  },
  {
    id: '2',
    body: 'Move your eyes quickly to the target when it appears. Try to fixate on it accurately. The target will alternate between left and right.',
  },
  {
    id: '3',
    title: 'Cycles',
    body: 'You will see several cycles (left, right, left, right…). We measure how quickly and accurately you look at each target.',
  },
];

export type SaccadicTargetSide = 'left' | 'right';

/** Duration (ms) each target is shown before switching to the other side. */
export const DEFAULT_TARGET_DURATION_MS = 1000;
/** Total number of target appearances (cycles). 18 = 9 left + 9 right. */
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
export const GAZE_SAMPLE_INTERVAL_MS = 20;
