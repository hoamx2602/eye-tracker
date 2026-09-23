/**
 * One-point drift check before each neurological test (EyeLink-style).
 *
 * The calibration is fitted once; at home the participant shifts, leans and
 * slouches over the following minutes, and the mapping drifts with them
 * without anyone knowing. Just before each real test the countdown shows a
 * dot at the exact screen centre (RealTestIntro); the median raw gaze while
 * it is fixated is the current offset of the mapping.
 *
 * The offset is subtracted from the live gaze (App.tsx predictGaze) only when
 * the check is trustworthy — enough usable frames, a tight fixation, and an
 * offset small enough to be drift rather than someone looking elsewhere.
 * Otherwise the previous offset stays. Either way the check is reported with
 * the test result, so the analysis can see how far the mapping had moved.
 *
 * The per-frame stream (lib/gazeFrameStream) stores the uncorrected gaze; the
 * saccade metrics are offset-invariant and do not need the correction.
 */
import { GazeFrameQuality, type GazeFrame } from '@/lib/gazeFrameStream';

export interface DriftCheck {
  /** Median raw gaze minus screen centre, px. */
  measuredOffset: { x: number; y: number } | null;
  /** Offset subtracted from the live gaze during the test that follows, px. */
  appliedOffset: { x: number; y: number };
  applied: boolean;
  /** Why the measurement was not applied, when it was not. */
  reason?: 'skipped' | 'too_few_frames' | 'unstable' | 'too_large';
  /** Median distance of the frames from their own median, px. */
  spreadPx: number | null;
  validFrames: number;
  frames: number;
}

/** Fixation spread above this (median radius, px) is not a steady look at the dot. */
const MAX_SPREAD_PX = 60;
/** Offsets beyond this fraction of the short screen side are not drift. */
const MAX_OFFSET_FRAC = 0.2;
const MIN_VALID_FRAMES = 8;

let offset = { x: 0, y: 0 };
let lastCheck: DriftCheck | null = null;

export function getDriftOffset(): { x: number; y: number } {
  return offset;
}

/** A new calibration starts from a clean mapping. */
export function resetDriftOffset(): void {
  offset = { x: 0, y: 0 };
  lastCheck = null;
}

/** The check made just before the current test, once — the test runner takes it into the result. */
export function takeLastDriftCheck(): DriftCheck | null {
  const c = lastCheck;
  lastCheck = null;
  return c;
}

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function evaluateDriftCheck(
  frames: readonly GazeFrame[],
  center: { x: number; y: number },
  viewport: { w: number; h: number },
): DriftCheck {
  const ok = frames.filter((f) => f.q === GazeFrameQuality.OK && Number.isFinite(f.x) && Number.isFinite(f.y));
  const base = { appliedOffset: offset, applied: false, validFrames: ok.length, frames: frames.length };
  if (ok.length < MIN_VALID_FRAMES) return { ...base, measuredOffset: null, spreadPx: null, reason: 'too_few_frames' };
  const mx = median(ok.map((f) => f.x));
  const my = median(ok.map((f) => f.y));
  const spreadPx = Math.round(median(ok.map((f) => Math.hypot(f.x - mx, f.y - my))) * 10) / 10;
  const measuredOffset = { x: Math.round(mx - center.x), y: Math.round(my - center.y) };
  if (spreadPx > MAX_SPREAD_PX) return { ...base, measuredOffset, spreadPx, reason: 'unstable' };
  if (Math.hypot(measuredOffset.x, measuredOffset.y) > MAX_OFFSET_FRAC * Math.min(viewport.w, viewport.h)) {
    return { ...base, measuredOffset, spreadPx, reason: 'too_large' };
  }
  return { ...base, measuredOffset, spreadPx, appliedOffset: measuredOffset, applied: true };
}

/** Record a check and, when it is trustworthy, make its offset the live correction. */
export function commitDriftCheck(check: DriftCheck): void {
  if (check.applied) offset = check.appliedOffset;
  lastCheck = check;
}

export function recordSkippedDriftCheck(): void {
  lastCheck = { measuredOffset: null, appliedOffset: offset, applied: false, reason: 'skipped', spreadPx: null, validFrames: 0, frames: 0 };
}
