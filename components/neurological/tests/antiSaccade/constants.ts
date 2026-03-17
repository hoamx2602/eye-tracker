import type { GuideStep } from '../../types';

/** Guide steps for Test 4: Opposite Direction Gaze Control (Anti-Saccade) — PDF. */
export const ANTI_SACCADE_GUIDE_STEPS: GuideStep[] = [
  {
    id: '1',
    title: 'Anti-Saccade',
    body: 'Two rectangles will appear: one bright and one dim. They will move in opposite directions. Your task is to look at the dim rectangle, not the bright one.',
  },
  {
    id: '2',
    body: 'Keep your gaze on the dim (faint) rectangle as it moves. Try not to follow the bright one — that is the opposite direction we want you to look.',
  },
  {
    id: '3',
    title: 'Trials',
    body: 'You will see several trials. Each time the direction changes at random. Look at the dim rectangle as quickly and accurately as you can.',
  },
];

export type AntiSaccadeDirection = 'left' | 'right' | 'up' | 'down';

export const DIRECTIONS: AntiSaccadeDirection[] = ['left', 'right', 'up', 'down'];

export const OPPOSITE_DIRECTION: Record<AntiSaccadeDirection, AntiSaccadeDirection> = {
  left: 'right',
  right: 'left',
  up: 'down',
  down: 'up',
};

/** Number of trials in the main test. */
export const DEFAULT_TRIAL_COUNT = 12;
/** Duration (ms) each rectangle moves per trial (fallback when speed not set). */
export const DEFAULT_MOVEMENT_DURATION_MS = 1500;
/** Tốc độ di chuyển (px/s) — dùng để tính duration theo quãng đường, đồng nhất mọi hướng. */
export const DEFAULT_MOVEMENT_SPEED_PX_PER_SEC = 120;
/** Pause (ms) between trials. */
export const DEFAULT_INTERVAL_BETWEEN_TRIALS_MS = 800;
/** Practice: number of trials. */
export const PRACTICE_TRIALS = 3;
/** Rectangle half-width / half-height in px (so full size 2*RECT_HALF). */
export const RECT_HALF_PX = 40;
/** Distance (px) each rect moves from center during movement. */
export const TRAVEL_DISTANCE_PX = 180;
/** AOI radius (px): gaze within this distance of dim rect center counts as "correct". */
export const AOI_RADIUS_PX = 70;
/** Gaze sample interval (ms) during trial. */
export const GAZE_SAMPLE_INTERVAL_MS = 20;

/** Loại vật thể kích thích: hình chữ nhật, tròn, tam giác, bóng, bàn, ghế. */
export type AntiSaccadeStimulusShape =
  | 'rectangle'
  | 'circle'
  | 'triangle'
  | 'ball'
  | 'table'
  | 'chair';

export const STIMULUS_SHAPE_OPTIONS: { value: AntiSaccadeStimulusShape; label: string }[] = [
  { value: 'rectangle', label: 'Hình chữ nhật' },
  { value: 'circle', label: 'Hình tròn' },
  { value: 'triangle', label: 'Tam giác' },
  { value: 'ball', label: 'Quả bóng' },
  { value: 'table', label: 'Bàn' },
  { value: 'chair', label: 'Ghế' },
];
