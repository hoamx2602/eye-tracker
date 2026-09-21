/**
 * Switches for things participants should not normally see.
 *
 * Both default to off: during data collection the flow should show a
 * participant only what the session asks of them. Turn them on locally while
 * tuning or debugging.
 *
 * `NEXT_PUBLIC_` is required — these are read in the browser, and Next only
 * inlines variables with that prefix into client code.
 */

/** Accepts 1 / true / yes / on, in any case. Anything else is off. */
function envFlag(raw: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((raw ?? '').trim().toLowerCase());
}

/**
 * The diagnostics overlay on the calibration and tracking screens: face width,
 * feature vector, LOOCV error. For tuning, meaningless to a participant.
 */
export const DIAGNOSTICS_ENABLED =
  typeof process !== 'undefined' && envFlag(process.env.NEXT_PUBLIC_SHOW_DIAGNOSTICS);

/**
 * The "Real-time Eye Tracking" link on the end-of-session page.
 *
 * It leads back into a live tracking mode, which is useful for testing and
 * confusing for someone who has just been told their session is finished.
 */
export const REALTIME_TRACKING_LINK_ENABLED =
  typeof process !== 'undefined' && envFlag(process.env.NEXT_PUBLIC_SHOW_REALTIME_TRACKING);
