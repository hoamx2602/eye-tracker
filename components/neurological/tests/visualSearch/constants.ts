import type { GuideStep } from '../../types';

/** Guide steps for Test 2: Sequential Visual Search and Number Tracking (PDF). */
export const VISUAL_SEARCH_GUIDE_STEPS: GuideStep[] = [
  {
    id: '1',
    title: 'Sequential Visual Search',
    body: 'Numbers will appear on screen in random positions. Your task is to look at them in order: 1, then 2, then 3, and so on.',
  },
  {
    id: '2',
    body: 'Move your eyes only — keep your head still. Look at each number in ascending order.',
  },
  {
    id: '3',
    title: 'When finished',
    body: 'When you have looked at all numbers in order, press SPACE to end the test.',
  },
];

/** Default number of targets in the real test (6–10). */
export const DEFAULT_NUMBER_COUNT = 8;
/** Number of numbers in practice. */
export const PRACTICE_COUNT = 4;
/** AOI radius in pixels: gaze within this distance of a number center counts as "looking at" that number. */
export const DEFAULT_AOI_RADIUS_PX = 80;
/** Minimum distance between number centers (as fraction of min(width,height)) so they don't overlap. */
export const MIN_SPACING_FRACTION = 0.15;
/** Gaze path sample interval (ms) — 0.1s cố định, đồng bộ với yêu cầu lưu scanpath. */
export const GAZE_PATH_INTERVAL_MS = 100;
/**
 * Confirmation mode for Visual Search targets:
 * - 'gaze'  — gaze-only, hold 1.5 s to confirm, press SPACE when done
 * - 'hold'  — press and hold each number for 1.5 s to confirm
 * - 'click' — single click instantly confirms
 */
export type VisualSearchConfirmMode = 'gaze' | 'hold' | 'click';
export const DEFAULT_CONFIRM_MODE: VisualSearchConfirmMode = 'gaze';
/** Minimum press duration (ms) before release counts as a pointer confirmation (hold mode, 0 = any tap). */
export const DEFAULT_CLICK_HOLD_DURATION_MS = 300;
/** Gaze dwell duration (ms) on a number before it is visually confirmed (turns green). */
export const DWELL_CONFIRM_MS = 1500;
