import type { GuideStep } from '../../types';

/** Guide steps for Test 1: Head Orientation and Neck Mobility (PDF). */
export const HEAD_ORIENTATION_GUIDE_STEPS: GuideStep[] = [
  {
    id: '1',
    body: 'You will slowly move your head in different directions.',
  },
  {
    id: '2',
    body: 'Move your head only within a comfortable range.',
  },
  {
    id: '3',
    title: 'Directions',
    body: 'Follow the sequence: Left → Right → Up → Down.\n\nYou will see on-screen instructions for each direction. Hold each position for the indicated time.',
  },
];

export const DEFAULT_HEAD_ORIENTATION_ORDER = ['left', 'right', 'up', 'down'] as const;
export const DEFAULT_DURATION_PER_DIRECTION_SEC = 4;

export type HeadOrientationDirection = 'left' | 'right' | 'up' | 'down';

export const DIRECTION_LABELS: Record<HeadOrientationDirection, string> = {
  left: 'Turn head LEFT',
  right: 'Turn head RIGHT',
  up: 'Look UP',
  down: 'Look DOWN',
};
