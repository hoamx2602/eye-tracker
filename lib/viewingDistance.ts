/**
 * Measured viewing distance — replacing the assumption that the participant is
 * wherever the config says they are.
 *
 * The old check (`eyeTrackingService.validateHeadPosition`) gated a normalised
 * face width into a hand-tuned band and then *assumed* the configured distance.
 * That band has two unknowns baked into it: the camera's field of view (54–78°
 * across common webcams — a 25% distance error on its own) and the participant's
 * actual face width (bizygomatic 125–155 mm). Someone passing the "40 cm" gate
 * could genuinely be at 30 or 52 cm. Every angular quantity inherits that:
 * saccade amplitude and velocity scale with distance, BCEA with its square.
 *
 * The fix is two measurements and one derived constant:
 *
 *   1. Blind spot → absolute distance `d₀`, in centimetres, using only screen
 *      geometry. The optic disc sits nasally on the retina, so it shows up
 *      ~13.5° into the *temporal* visual field: fixate with one eye, sweep a dot
 *      outward, and the offset at which it vanishes gives the distance directly.
 *      Needs the screen scale from screenScale.ts and nothing about the camera.
 *
 *   2. Face scale `s₀` from the camera at that same moment.
 *
 *   3. `K = d₀ · s₀`. Thereafter `d = K / s` continuously.
 *
 * `K` folds the camera's focal length and this person's face size into one
 * number, and never needs them separated — the product is all the model uses.
 * It is therefore specific to one person on one camera, and is re-measured each
 * session, unlike the screen scale which belongs to the display.
 *
 * Method: Li, Joo, Yeatman & Reinecke (2020), Scientific Reports.
 * https://www.nature.com/articles/s41598-019-57204-1  (mean error 3.25 cm)
 *
 * On that error: because the blind spot is used *once* to fix K rather than per
 * frame, its error becomes a constant scale factor, not noise. Within-subject
 * comparisons — the pre/post design this system exists for — are unaffected by a
 * common factor; only comparisons against published norms are shifted.
 */

/**
 * Angular eccentricity of the blind spot, temporal side. 13.5° is the value the
 * virtual-chinrest paper assumes and validates against; individual optic discs
 * sit between roughly 12° and 15°, which is the dominant term in that method's
 * 3.25 cm error.
 */
export const BLIND_SPOT_ECCENTRICITY_DEG = 13.5;

/** Distances the setup flow supports, matching the admin config slider. */
export const SUPPORTED_TARGET_DISTANCES_CM = [30, 35, 40, 45, 50, 55, 60] as const;

/** Reject a blind-spot result outside the range any of those targets could give. */
const MIN_PLAUSIBLE_CM = 15;
const MAX_PLAUSIBLE_CM = 120;

const STORAGE_KEY = 'eyetracker.distanceCalibration.v1';

// ─── Blind spot → distance ───────────────────────────────────────────────────

/**
 * Viewing distance from one blind-spot observation.
 *
 * `offsetPx` is the horizontal distance, in CSS pixels, between the fixation
 * mark and the dot at the moment it vanished. Converting to cm with the screen
 * scale and dividing by tan(eccentricity) gives the distance to the screen —
 * simple right-triangle geometry, with no camera involved at all.
 */
export function distanceFromBlindSpot(
  offsetPx: number,
  pxPerCm: number,
  eccentricityDeg: number = BLIND_SPOT_ECCENTRICITY_DEG,
): number {
  const offsetCm = Math.abs(offsetPx) / pxPerCm;
  return offsetCm / Math.tan((eccentricityDeg * Math.PI) / 180);
}

export interface BlindSpotResult {
  distanceCm: number;
  /** Half the interquartile-ish spread across trials — how much they disagreed. */
  spreadCm: number;
  /** Trials kept after rejecting implausible ones. */
  n: number;
  /** Trials discarded as outside the plausible range. */
  nRejected: number;
  perTrialCm: number[];
}

/**
 * Combine repeated blind-spot trials into one distance.
 *
 * The median rather than the mean: a participant who blinks, loses fixation or
 * presses late produces an outlier that a mean would carry into every subsequent
 * measurement, and repeated trials are exactly the cheap way to defend against
 * that. `spreadCm` is reported so the caller can insist on a retry when the
 * trials disagree rather than quietly averaging noise.
 */
export function aggregateBlindSpotTrials(
  offsetsPx: number[],
  pxPerCm: number,
  eccentricityDeg: number = BLIND_SPOT_ECCENTRICITY_DEG,
): BlindSpotResult {
  const all = offsetsPx.map((o) => distanceFromBlindSpot(o, pxPerCm, eccentricityDeg));
  const kept = all.filter((d) => d >= MIN_PLAUSIBLE_CM && d <= MAX_PLAUSIBLE_CM);
  const result: BlindSpotResult = {
    distanceCm: NaN,
    spreadCm: NaN,
    n: kept.length,
    nRejected: all.length - kept.length,
    perTrialCm: all,
  };
  if (!kept.length) return result;

  const sorted = [...kept].sort((a, b) => a - b);
  result.distanceCm = median(sorted);
  // Median absolute deviation, scaled to be comparable with a standard
  // deviation for well-behaved data but unmoved by a single bad trial.
  const mad = median([...sorted.map((d) => Math.abs(d - result.distanceCm))].sort((a, b) => a - b));
  result.spreadCm = 1.4826 * mad;
  return result;
}

function median(sortedAsc: number[]): number {
  const n = sortedAsc.length;
  if (!n) return NaN;
  const mid = n >> 1;
  return n % 2 ? sortedAsc[mid] : (sortedAsc[mid - 1] + sortedAsc[mid]) / 2;
}

// ─── Face scale ──────────────────────────────────────────────────────────────

/**
 * Rotation-corrected face size, as a fraction of frame width.
 *
 * Raw face width foreshortens as cos(yaw) when the head turns, so the old check
 * reads a rotated head as a receded one and tells the participant to move
 * closer when they have not moved at all. Dividing it out restores a quantity
 * that depends on distance alone.
 *
 * The correction is clamped at 45°: beyond that the far cheekbone is occluded
 * and the measured width stops following cos(yaw), so amplifying it further
 * would turn a bad estimate into a wild one.
 */
export function faceScale(faceWidthNorm: number, yawRad = 0): number {
  const yaw = Math.min(Math.abs(yawRad), Math.PI / 4);
  return faceWidthNorm / Math.max(Math.cos(yaw), Math.SQRT1_2);
}

// ─── Calibration ─────────────────────────────────────────────────────────────

export interface DistanceCalibration {
  /** K = distanceCm × faceScale. */
  k: number;
  /** The absolute distance this was anchored at. */
  distanceCm: number;
  /** Face scale observed at that distance. */
  faceScale: number;
  /**
   * How the absolute distance was obtained.
   *
   * 'assumed' means the participant was declared to be at the configured target
   * where they happened to be sitting. That makes the absolute figure a guess —
   * but it is still worth anchoring, because K is fixed against the face size
   * observed at that instant, so every *change* from that pose is measured
   * exactly. Only the label is assumed, never the drift.
   */
  method: 'blind-spot' | 'manual' | 'assumed';
  /** Trial disagreement for blind-spot calibrations, cm. */
  spreadCm?: number;
  pxPerCm: number;
  measuredAt: string;
}

export function calibrate(params: {
  distanceCm: number;
  faceScale: number;
  pxPerCm: number;
  method: DistanceCalibration['method'];
  spreadCm?: number;
}): DistanceCalibration | null {
  const { distanceCm, faceScale: s, pxPerCm, method, spreadCm } = params;
  if (!(distanceCm > 0) || !(s > 0) || !Number.isFinite(distanceCm) || !Number.isFinite(s)) {
    return null;
  }
  return {
    k: distanceCm * s,
    distanceCm,
    faceScale: s,
    method,
    spreadCm,
    pxPerCm,
    measuredAt: new Date().toISOString(),
  };
}

/** Live distance in cm from the current face scale. */
export function distanceFromFace(cal: DistanceCalibration, scale: number): number {
  if (!(scale > 0)) return NaN;
  return cal.k / scale;
}

/** Face scale that corresponds to a target distance — for drawing setup guides. */
export function faceScaleAtDistance(cal: DistanceCalibration, distanceCm: number): number {
  return cal.k / distanceCm;
}

// ─── Distance gate ───────────────────────────────────────────────────────────

export type DistanceVerdict = 'ok' | 'too-close' | 'too-far' | 'unknown';

export interface DistanceCheck {
  verdict: DistanceVerdict;
  /** Measured distance, or NaN when uncalibrated. */
  distanceCm: number;
  targetCm: number;
  /** Half-width of the accepted band. */
  bandCm: number;
}

/**
 * Accepted band around the configured target.
 *
 * Relative rather than fixed, with a floor: ±10% is ±3 cm at a 30 cm target and
 * ±6 cm at 60 cm, which matches how the error actually behaves — the same
 * centimetre of misplacement costs twice as much angular error up close. The
 * floor keeps the band from becoming unachievably tight at the near end.
 */
export function distanceBandCm(targetCm: number, tolerance = 1): number {
  return Math.max(3, targetCm * 0.1) * Math.max(1, Math.min(3, tolerance));
}

export function checkDistance(
  cal: DistanceCalibration | null,
  scale: number,
  targetCm: number,
  tolerance = 1,
): DistanceCheck {
  const bandCm = distanceBandCm(targetCm, tolerance);
  if (!cal) return { verdict: 'unknown', distanceCm: NaN, targetCm, bandCm };
  const distanceCm = distanceFromFace(cal, scale);
  if (!Number.isFinite(distanceCm)) {
    return { verdict: 'unknown', distanceCm: NaN, targetCm, bandCm };
  }
  if (distanceCm < targetCm - bandCm) return { verdict: 'too-close', distanceCm, targetCm, bandCm };
  if (distanceCm > targetCm + bandCm) return { verdict: 'too-far', distanceCm, targetCm, bandCm };
  return { verdict: 'ok', distanceCm, targetCm, bandCm };
}

// ─── Persistence ─────────────────────────────────────────────────────────────
// Unlike the screen scale, K belongs to one person on one camera, so it is kept
// only for the current session — a stored value from the previous participant
// would be confidently, invisibly wrong.

export function loadCalibration(): DistanceCalibration | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DistanceCalibration;
    return parsed && parsed.k > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function saveCalibration(cal: DistanceCalibration): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cal));
  } catch {
    /* private mode / quota — the value still works for this session */
  }
}

export function clearCalibration(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
