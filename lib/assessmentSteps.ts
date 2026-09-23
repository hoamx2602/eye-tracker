/**
 * What each step of the assessment asks of the participant.
 *
 * The overview screen renders this, and `lib/voice/scripts.ts` builds the
 * spoken version of each step from the very same strings — so the voice can
 * never describe something different from what is on screen.
 *
 * Every claim here has been checked against the implementation: the durations
 * against the animation and config defaults, the instructions against what the
 * test actually measures. Keep it that way — a participant who is told to hold
 * their head still during a head-movement test produces unusable data, and
 * nothing in the results would reveal why.
 */

export type AssessmentSection = 'calibration' | 'neuro';

export interface AssessmentStep {
  id: string;
  label: string;
  /** Human-readable duration shown on screen. */
  duration: string;
  /** Seconds, for the "~N min total" estimate. */
  durationSec: number;
  section: AssessmentSection;
  /** One-line summary. */
  tagline: string;
  /** The full explanation. */
  description: string;
}

/**
 * Set 1 — the calibration grid plus the six eye-movement exercises.
 *
 * Durations are measured from EyeMovementLayer: each exercise is a 2-second
 * countdown followed by a path travelled at 25 screen-percent per second, with
 * one-second pauses at the turning points.
 */
export const CALIBRATION_STEPS: AssessmentStep[] = [
  {
    id: 'calibration',
    label: 'Calibration',
    duration: '~45 sec',
    durationSec: 45,
    section: 'calibration',
    tagline: 'Follow a series of dots to calibrate the eye tracker to your gaze.',
    description:
      'The eye tracker needs to learn your unique gaze patterns before any testing begins. A series of dots will appear at different positions on the screen — simply look directly at each dot as it appears. Keep your head still and relaxed throughout. The more accurately you follow the dots, the better the tracker will perform during all tests.',
  },
  {
    id: 'wiggling',
    label: 'Wiggling',
    // Lissajous path, arc-length parameterised: 14.3s + 2s countdown.
    duration: '15-20 sec',
    durationSec: 17,
    section: 'calibration',
    tagline: 'Follow a target as it traces a smooth looping path.',
    description:
      'A small target will trace one continuous looping figure across the screen. Follow it as smoothly and precisely as you can, moving only your eyes. This single sweep covers many gaze directions at once, and teaches the tracker how your eyes behave during smooth pursuit.',
  },
  {
    id: 'horizontal',
    label: 'Horizontal',
    // 4 crossings + 5 one-second pauses + countdown = 19.2s.
    duration: '~20 sec',
    durationSec: 19,
    section: 'calibration',
    tagline: 'Track a target sweeping from side to side.',
    description:
      'A target will move steadily from one side of the screen to the other and back, twice over, pausing for a moment at each edge. Follow it with a smooth, continuous eye movement. This calibrates the tracker across the full horizontal range of your screen.',
  },
  {
    id: 'vertical',
    label: 'Vertical',
    duration: '~20 sec',
    durationSec: 19,
    section: 'calibration',
    tagline: 'Track a target sweeping from top to bottom.',
    description:
      'The same as the horizontal step, turned on its side: the target moves from the top of the screen to the bottom and back, twice over, pausing at each end. Follow it with smooth vertical eye movement and keep your chin level. This calibrates the tracker across the full vertical range.',
  },
  {
    id: 'forward_backward',
    label: 'Forward-Backward',
    // Fixed 7s animation + 2s countdown.
    duration: '~10 sec',
    durationSec: 9,
    section: 'calibration',
    tagline: 'Focus on a target as it appears to move towards and away from you.',
    description:
      'A target in the centre of the screen will grow and shrink, as though moving towards you and then away again. It does not travel anywhere — keep your eyes on its centre throughout. This helps the tracker account for changes in perceived gaze depth and for small shifts in head position during natural viewing.',
  },
  {
    id: 'diagonal',
    label: 'Diagonal',
    // Five legs across the screen plus six pauses + countdown = 28.2s.
    duration: '~30 sec',
    durationSec: 28,
    section: 'calibration',
    tagline: 'Track a target jumping between the corners of the screen.',
    description:
      'The target moves between the corners of the screen, pausing at each one before setting off again. Follow it into every corner. These paths combine horizontal and vertical motion, which makes sure the tracker is calibrated for gaze in every direction, not just along the two axes.',
  },
  {
    id: 'h_pattern',
    label: 'H-Pattern',
    // Five legs plus six pauses + countdown = 20.2s.
    duration: '~20 sec',
    durationSec: 20,
    section: 'calibration',
    tagline: 'Follow a target tracing the shape of the letter H.',
    description:
      'The target traces the outline of a letter H — down one side, across the middle, then up the other — pausing at each turning point. This structured pattern makes sure the tracker is accurate at the edges and corners of the screen, where accuracy is hardest to maintain.',
  },
];

/**
 * Set 2 — the seven neurological tests.
 *
 * Durations come from the configured defaults in each test's constants file, so
 * they shift if an administrator changes the number of trials.
 */
export const NEURO_STEPS: AssessmentStep[] = [
  {
    id: 'head_orientation',
    label: 'Head Orientation',
    // Four directions × 4s each, plus the cue transitions.
    duration: '~20 sec',
    durationSec: 20,
    section: 'neuro',
    tagline: 'Turn your head slowly in four directions.',
    description:
      'On-screen cues will ask you to turn your head to the left, then to the right, then to look up and down. Move your head, not just your eyes, and only as far as is comfortable. Hold each position until the cue changes. This test measures the range and steadiness of your head movement in all four directions.',
  },
  {
    id: 'visual_search',
    label: 'Visual Search',
    duration: '~30 sec',
    durationSec: 30,
    section: 'neuro',
    tagline: 'Find numbered targets scattered across the screen, in order.',
    description:
      'Numbers will be scattered at random across the screen. Find them in order, starting at 1, and hold each one until it turns green. They only respond in the right order, so if one does nothing, it is not the next one yet. The test ends by itself once the last number is green. This measures how efficiently your eyes scan and search a visual scene.',
  },
  {
    id: 'memory_cards',
    label: 'Memory Cards',
    duration: '~1 min',
    durationSec: 60,
    section: 'neuro',
    tagline: 'Find matching pairs of cards using your gaze.',
    description:
      'A grid of face-down cards is shown, and every symbol appears on exactly two of them. Look at a card for a moment to turn it over, then find its match by looking at another. Matching pairs stay face up; the rest turn back over. The test ends by itself once every pair is found. This measures visual memory — how well you recall and use what you have already seen.',
  },
  {
    id: 'anti_saccade',
    label: 'Anti-Saccade',
    duration: '~45 sec',
    durationSec: 45,
    section: 'neuro',
    tagline: 'Look at the dim shape, not the bright one.',
    description:
      'A shape appears in the centre of the screen. After a moment, a bright shape jumps to one side and a dim shape to the other. Your task is to look at the dim one. This is intentionally difficult, because your reflex is to look at whatever is brightest and sudden. The test measures your ability to override that reflex and direct your gaze deliberately.',
  },
  {
    id: 'saccadic',
    label: 'Saccadic Eye Movement',
    // 18 targets × (1–2 s centre dot + 1 s target).
    duration: '~45 sec',
    durationSec: 45,
    section: 'neuro',
    tagline: 'React quickly to targets appearing at random on either side.',
    description:
      'Look at a small dot in the centre of the screen. After a moment, a target will appear on the left or the right — the side and the timing are random. Move your eyes to it as fast as you can the moment it appears, then back to the centre dot. Speed matters here. This test measures the raw speed and accuracy of reflexive eye movement.',
  },
  {
    id: 'fixation_stability',
    label: 'Fixation Stability',
    // DEFAULT_DURATION_SEC is 15; an administrator may set anything from 5 to 30.
    duration: '~15 sec',
    durationSec: 15,
    section: 'neuro',
    tagline: 'Hold your gaze perfectly still on a central dot.',
    description:
      'A small dot will appear at the centre of the screen. Your only task is to hold your gaze on it, as steadily as you can, for the full duration. The dot may blink — that is normal, and it helps you stay focused. Blink naturally when you need to, but try not to look away. This measures how stable your gaze is when you actively try to keep it fixed.',
  },
  {
    id: 'peripheral_vision',
    label: 'Peripheral Vision',
    duration: '~30 sec',
    durationSec: 30,
    section: 'neuro',
    tagline: 'Detect flashes at the edge of your vision.',
    description:
      'Keep your eyes fixed on the dot at the centre of the screen at all times. Every so often a small shape will flash briefly near the edge of the screen. Press the spacebar as soon as you notice one — but do not look at it, and do not move your eyes from the centre. This measures what you can detect in your peripheral vision, and how quickly you react to it.',
  },
];

export const ASSESSMENT_STEPS: AssessmentStep[] = [...CALIBRATION_STEPS, ...NEURO_STEPS];

/** The spoken form of a step: its summary, then the detail. */
export function stepSpokenText(id: string): string {
  const step = ASSESSMENT_STEPS.find((s) => s.id === id);
  if (!step) throw new Error(`Unknown assessment step: ${id}`);
  return `${step.tagline} ${step.description}`;
}
