import type { GuideStep } from '../../types';

/** Guide steps for Test 7: Peripheral Vision Detection — PDF. */
export const PERIPHERAL_VISION_GUIDE_STEPS: GuideStep[] = [
  {
    id: '1',
    title: 'Peripheral Vision',
    body: 'Keep your gaze on the center dot. A small stimulus will flash at a random position near the edge of the screen. Press SPACE as soon as you detect it.',
  },
  {
    id: '2',
    body: 'Do not look at the stimulus — keep looking at the center. You are testing your peripheral (side) vision.',
  },
  {
    id: '3',
    title: 'Response',
    body: 'Press SPACE when you see the flash. We measure how quickly and accurately you respond.',
  },
];

/** Legacy: bốn hướng cố định (run cũ). Stimulus mới dùng stimulusX/Y. */
export type PeripheralZone = 'top' | 'bottom' | 'left' | 'right';

/** Khoảng cách tối thiểu từ mép viewport tới tâm stimulus (tỉ lệ 0–0.5). */
export const PERIPHERAL_STIMULUS_MARGIN_FRAC = 0.12;

/** Number of trials in the main test. */
export const DEFAULT_TRIAL_COUNT = 16;
/** How long (ms) the stimulus is visible. */
export const DEFAULT_STIMULUS_DURATION_MS = 300;
/** Min delay (ms) before stimulus appears. */
export const DEFAULT_MIN_DELAY_MS = 800;
/** Max delay (ms) before stimulus appears. */
export const DEFAULT_MAX_DELAY_MS = 2000;
/** Extra window (ms) after stimulus offset in which SPACE still counts as hit. */
export const RESPONSE_WINDOW_MS = 500;
/** Practice: number of trials. */
export const PRACTICE_TRIALS = 4;
/** Gaze sample interval (ms) per trial. */
export const GAZE_SAMPLE_INTERVAL_MS = 100;

/** Zone positions as fraction of viewport (x, y). Peripheral = near edges. */
export const ZONE_POSITIONS: Record<PeripheralZone, { x: number; y: number }> = {
  top: { x: 0.5, y: 0.18 },
  bottom: { x: 0.5, y: 0.82 },
  left: { x: 0.18, y: 0.5 },
  right: { x: 0.82, y: 0.5 },
};
