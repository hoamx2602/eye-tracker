import type { GuideStep } from '../../types';

/**
 * Guide steps for Test 2: Sequential Visual Search and Number Tracking (PDF),
 * adapted to how confirmation actually works — a participant confirms a
 * number by clicking it, holding a click, or just gazing at it, and the
 * wrong description ("hold it until it turns green" when the configured
 * mode is a plain click) is worse than no instruction at all, since it sets
 * an expectation the task then doesn't meet.
 */
export function getVisualSearchGuideSteps(confirmMode: VisualSearchConfirmMode): GuideStep[] {
  const confirmAction =
    confirmMode === 'click'
      ? 'click it'
      : confirmMode === 'hold'
        ? 'click and hold it until it turns green'
        : 'hold your gaze on it until it turns green';
  return [
    {
      id: '1',
      title: 'Sequential Visual Search',
      body: 'Numbers will appear on screen in random positions. Your task is to look at them in order: 1, then 2, then 3, and so on.',
    },
    {
      id: '2',
      body: `Move your eyes only — keep your head still. Keep your gaze on each number in ascending order and ${confirmAction} to move to the next one.`,
    },
    {
      id: '3',
      title: 'Order matters',
      body: `Numbers only turn green in the right order, so if one does not respond, it is not the next one yet. The test ends by itself once the last number is green.`,
    },
  ];
}

/** Backward-compatible default (gaze mode). Use getVisualSearchGuideSteps() for the actual configured mode. */
export const VISUAL_SEARCH_GUIDE_STEPS: GuideStep[] = getVisualSearchGuideSteps('gaze');

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
 * - 'gaze'  — hold 1.5 s to confirm; the test ends on the last target
 * - 'hold'  — press and hold each number for 1.5 s to confirm
 * - 'click' — single click instantly confirms
 */
export type VisualSearchConfirmMode = 'gaze' | 'hold' | 'click';
export const DEFAULT_CONFIRM_MODE: VisualSearchConfirmMode = 'gaze';

/** Resolves config.confirmMode the same way every caller needs to, same pattern as antiSaccade's resolveDimRectOpacity. */
export function resolveVisualSearchConfirmMode(config: Record<string, unknown> | undefined): VisualSearchConfirmMode {
  const v = config?.confirmMode;
  return v === 'gaze' || v === 'hold' || v === 'click' ? v : DEFAULT_CONFIRM_MODE;
}
/** Minimum press duration (ms) before release counts as a pointer confirmation (hold mode, 0 = any tap). */
export const DEFAULT_CLICK_HOLD_DURATION_MS = 300;
/** Gaze dwell duration (ms) on a number before it is visually confirmed (turns green). */
export const DWELL_CONFIRM_MS = 1500;
