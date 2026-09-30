import type { GuideStep } from '../../types';

/**
 * Smooth pursuit — the cornerstone of the VOMS concussion screen, and the
 * biomarker the battery was missing. A dot moves side to side on a sine; the
 * eye follows. What matters is how well the gaze keeps up (gain), how far it
 * trails (lag), and how often it has to jump to catch up (catch-up saccades).
 * All three come from the per-frame gaze relative to the target
 * (lib/oculomotorMetrics.analysePursuit), so a constant calibration offset
 * does not move them.
 *
 * Horizontal only: the tracker's vertical axis carries a fraction of the
 * horizontal signal.
 */
export const SMOOTH_PURSUIT_GUIDE_STEPS: GuideStep[] = [
  {
    id: '1',
    title: 'Smooth Pursuit',
    body: 'A dot will appear in the centre of the screen and then move smoothly from side to side.',
  },
  {
    id: '2',
    body: 'Follow the dot with your eyes as closely as you can, without moving your head. Try to keep your eyes on it the whole time.',
  },
  {
    id: '3',
    title: 'Duration',
    body: 'The dot moves back and forth several times. The test ends by itself.',
  },
];

/** Target frequency (Hz). 0.4 Hz is within the range VOMS-style pursuit uses and easy to follow. */
export const DEFAULT_FREQUENCY_HZ = 0.4;
/** Number of full left–right–left cycles. */
export const DEFAULT_CYCLES = 5;
/** Horizontal amplitude as a fraction of viewport width (centre to either end). */
export const DEFAULT_AMPLITUDE_FRAC = 0.3;
/** Static dot at the centre before it starts to move (ms). */
export const DEFAULT_START_FIXATION_MS = 1000;
/** The first half-cycle is left out of the analysis while the eye catches the dot up. */
export const ANALYSIS_SKIP_CYCLES = 0.5;
export const DEFAULT_DOT_SIZE_PX = 20;
export const DEFAULT_DOT_COLOR = '#f59e0b';
/** Gaze sample interval (ms) for the result preview. Metrics use every frame. */
export const GAZE_SAMPLE_INTERVAL_MS = 100;
export const PRACTICE_CYCLES = 2;
