import type { GuideStep } from '../../types';

/** Guide steps for Test 6: Fixation Stability — PDF. */
export const FIXATION_STABILITY_GUIDE_STEPS: GuideStep[] = [
  {
    id: '1',
    title: 'Fixation Stability',
    body: 'A small dot will appear in the center of the screen. Your task is to keep your gaze on the dot as steadily as possible.',
  },
  {
    id: '2',
    body: 'Try not to look away. The dot may blink slightly to help you focus. Stay as still as you can with your eyes.',
  },
  {
    id: '3',
    title: 'Duration',
    body: 'The test lasts for several seconds. When it ends, your gaze stability will be recorded automatically.',
  },
];

/** Test duration in seconds (5–15). */
export const DEFAULT_DURATION_SEC = 5;
export const MIN_DURATION_SEC = 5;
export const MAX_DURATION_SEC = 15;
/** Blink interval (ms) for the center dot. 0 = no blink. */
export const DEFAULT_BLINK_INTERVAL_MS = 600;
/** Gaze sample interval (ms). ~33 ms ≈ 30 Hz. */
export const GAZE_SAMPLE_INTERVAL_MS = 100;
/** Practice duration (seconds). */
export const PRACTICE_DURATION_SEC = 3;
