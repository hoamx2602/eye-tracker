/**
 * Path constants and helpers for the main flow.
 * Use these so each screen has a stable URL for testing and deep-linking.
 */

/** Every screen of the eye-tracking flow lives under this prefix. */
export const EYE_TRACKING_BASE = '/eye-tracking';

/** Top-level module entry points (see app/page.tsx). */
export const MODULE_PATHS = {
  HUB: '/',
  EYE_TRACKING: EYE_TRACKING_BASE,
  FACIAL_DROOP: '/facial-droop',
  IOP: '/iop',
} as const;

export const PATHS = {
  /** Entry: eye-tracking home */
  HOME: EYE_TRACKING_BASE,
  /** Consent screen */
  CONSENT: `${EYE_TRACKING_BASE}/consent`,
  /** Demographics screen */
  DEMOGRAPHICS: `${EYE_TRACKING_BASE}/demographics`,
  /** Actual calibration flow */
  CALIBRATION: `${EYE_TRACKING_BASE}/calibration`,
  /** Setup guide: camera permission → lighting → posture */
  SETUP: `${EYE_TRACKING_BASE}/setup`,
  /** Post-calibration: choose Real-time vs Neurological */
  CHOICE: `${EYE_TRACKING_BASE}/choice`,
  /** Real-time eye tracking */
  TRACKING: `${EYE_TRACKING_BASE}/tracking`,
  /** Neuro pre-test (symptom assessment) */
  NEURO_PRE: `${EYE_TRACKING_BASE}/neuro/pre`,
  /** Neuro test by id (e.g. /eye-tracking/neuro/test/head_orientation) */
  NEURO_TEST: (testId: string) => `${EYE_TRACKING_BASE}/neuro/test/${testId}`,
  /** Neuro post-test (symptom assessment) */
  NEURO_POST: `${EYE_TRACKING_BASE}/neuro/post`,
  /** Neuro run complete */
  NEURO_DONE: `${EYE_TRACKING_BASE}/neuro/done`,
} as const;

const NEURO_TEST_IDS = [
  'head_orientation',
  'visual_search',
  'memory_cards',
  'anti_saccade',
  'saccadic',
  'smooth_pursuit',
  'fixation_stability',
  'peripheral_vision',
] as const;

export type ParsedPath =
  | { screen: 'home' }
  | { screen: 'consent' }
  | { screen: 'demographics' }
  | { screen: 'calibration' }
  | { screen: 'setup' }
  | { screen: 'choice' }
  | { screen: 'tracking' }
  | { screen: 'neuro_pre' }
  | { screen: 'neuro_test'; testId: string }
  | { screen: 'neuro_post' }
  | { screen: 'neuro_done' };

/**
 * Parse pathname into a known screen. Use for syncing URL → state.
 */
export function parsePathname(pathname: string): ParsedPath {
  // Screens are matched relative to the eye-tracking prefix. Anything outside
  // it (e.g. /experiments, which also mounts App) starts on the home screen.
  const trimmed = pathname.replace(/\/$/, '');
  const insideBase = trimmed === EYE_TRACKING_BASE || trimmed.startsWith(`${EYE_TRACKING_BASE}/`);
  const relative = insideBase ? trimmed.slice(EYE_TRACKING_BASE.length) : '';
  const normalized = relative || '/';
  if (normalized === '/') return { screen: 'home' };
  if (normalized === '/consent') return { screen: 'consent' };
  if (normalized === '/demographics') return { screen: 'demographics' };
  if (normalized === '/calibration') return { screen: 'calibration' };
  if (normalized === '/setup') return { screen: 'setup' };
  if (normalized === '/choice') return { screen: 'choice' };
  if (normalized === '/tracking') return { screen: 'tracking' };
  if (normalized === '/neuro/pre') return { screen: 'neuro_pre' };
  if (normalized === '/neuro/post') return { screen: 'neuro_post' };
  if (normalized === '/neuro/done') return { screen: 'neuro_done' };
  const testMatch = /^\/neuro\/test\/([^/]+)$/.exec(normalized);
  if (testMatch && NEURO_TEST_IDS.includes(testMatch[1] as (typeof NEURO_TEST_IDS)[number])) {
    return { screen: 'neuro_test', testId: testMatch[1] };
  }
  return { screen: 'home' };
}

export function isNeuroTestId(id: string): id is (typeof NEURO_TEST_IDS)[number] {
  return (NEURO_TEST_IDS as readonly string[]).includes(id);
}
