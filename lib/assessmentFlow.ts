/**
 * Which assessment the participant picked on the home screen.
 *
 * Consent and demographics are shared by every flow, so the choice has to
 * survive the /consent -> /demographics hops before it is acted on. It is kept
 * in sessionStorage (same tab, cleared when the tab closes) rather than in a
 * query string, because the intermediate screens push plain paths.
 *
 * - 'full'   → the standard route: setup guide, calibration, neurological tests.
 * - 'facial' → skip calibration entirely and go straight to the facial drooping
 *              and motor-speech capture at /facial-speech. Nothing in that
 *              protocol uses gaze, so calibrating first would cost the subject
 *              several minutes and buy nothing.
 */

const FLOW_SESSION_KEY = 'eyeTracker.assessmentFlow';
const DEMOGRAPHICS_SESSION_KEY = 'eyeTracker.demographics';
const CONSENT_SESSION_KEY = 'eyeTracker.consentAcknowledgedAt';

export type AssessmentFlow = 'full' | 'facial';

export function setAssessmentFlow(flow: AssessmentFlow): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(FLOW_SESSION_KEY, flow);
  } catch {
    /* private mode / storage disabled — fall back to the default flow */
  }
}

export function getAssessmentFlow(): AssessmentFlow {
  if (typeof window === 'undefined') return 'full';
  try {
    // A ?flow=facial query param makes the facial route deep-linkable for
    // testing without having to click through the home screen first.
    const fromQuery = new URLSearchParams(window.location.search).get('flow');
    if (fromQuery === 'facial' || fromQuery === 'full') {
      window.sessionStorage.setItem(FLOW_SESSION_KEY, fromQuery);
      return fromQuery;
    }
    return window.sessionStorage.getItem(FLOW_SESSION_KEY) === 'facial' ? 'facial' : 'full';
  } catch {
    return 'full';
  }
}

/**
 * Hand the demographics answers to the next screen.
 *
 * The facial capture lives on its own Next route, so the in-memory ref the main
 * app keeps does not survive the navigation. Without this the personal details
 * the subject just typed would be collected and then dropped.
 */
export function storeFlowDemographics(data: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(DEMOGRAPHICS_SESSION_KEY, JSON.stringify(data));
  } catch {
    /* non-fatal: the capture still runs, just without subject details */
  }
}

/**
 * Timestamp of the participant-consent screen in the shared flow.
 *
 * A capture is only usable as study data if it carries a record of the consent
 * that was actually given, so the moment of agreement travels with the flow
 * rather than being asked for a second time on the capture screen.
 */
export function storeFlowConsent(acknowledgedAt: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(CONSENT_SESSION_KEY, acknowledgedAt);
  } catch {
    /* the capture screen then asks for consent itself */
  }
}

export function readFlowConsent(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(CONSENT_SESSION_KEY);
  } catch {
    return null;
  }
}

export function readFlowDemographics(): Record<string, unknown> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(DEMOGRAPHICS_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
