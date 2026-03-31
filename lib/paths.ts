/**
 * Path constants and helpers for the main flow.
 * Use these so each screen has a stable URL for testing and deep-linking.
 */

export const PATHS = {
  /** Entry: idle, head positioning, calibration */
  HOME: '/',
  /** Consent screen */
  CONSENT: '/consent',
  /** Demographics screen */
  DEMOGRAPHICS: '/demographics',
  /** Actual calibration flow */
  CALIBRATION: '/calibration',
  /** Setup guide: camera permission → lighting → posture */
  SETUP: '/setup',
  /** Post-calibration: choose Real-time vs Neurological */
  CHOICE: '/choice',
  /** Real-time eye tracking */
  TRACKING: '/tracking',
  /** Neuro pre-test (symptom assessment) */
  NEURO_PRE: '/neuro/pre',
  /** Neuro test by id (e.g. /neuro/test/head_orientation) */
  NEURO_TEST: (testId: string) => `/neuro/test/${testId}`,
  /** Neuro post-test (symptom assessment) */
  NEURO_POST: '/neuro/post',
  /** Neuro run complete */
  NEURO_DONE: '/neuro/done',
} as const;

const NEURO_TEST_IDS = [
  'head_orientation',
  'visual_search',
  'memory_cards',
  'anti_saccade',
  'saccadic',
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
  const normalized = pathname.replace(/\/$/, '') || '/';
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
