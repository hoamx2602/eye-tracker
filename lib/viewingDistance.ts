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

import { distanceFromIris, fuseViewingDistance, irisKFromCalibration } from './irisDepth';

/**
 * Angular eccentricity of the blind spot, temporal side. 13.5° is the value the
 * virtual-chinrest paper assumes and validates against; individual optic discs
 * sit between roughly 12° and 15°, which is the dominant term in that method's
 * 3.25 cm error.
 */
export const BLIND_SPOT_ECCENTRICITY_DEG = 13.5;

/** Distances the setup flow supports, matching the admin config slider. */
export const SUPPORTED_TARGET_DISTANCES_CM = [20, 25, 30, 35, 40, 45, 50, 55, 60] as const;

/**
 * Nearest target the config will accept.
 *
 * This is a *policy* floor, not a physical one. Whether a given machine can
 * actually deliver it is a separate question with a real answer — see
 * `nearestFittingDistanceCm` — because the binding constraint is not optics but
 * framing: the head has to stay inside a 16:9 frame. At 20 cm a 65° webcam sees
 * 14 cm of height against a ~22 cm head, so the chin and crown leave the frame
 * and `calculateGeometricHeadPose` loses the landmarks it derives pitch from.
 *
 * Deliberately kept as a floor on the *setting* rather than a hard clamp on
 * behaviour: an operator with a 90° camera can genuinely work at 20 cm, and a
 * hard-coded 30 denied them that. What replaced the clamp is a check against
 * what this camera can actually do, which fails loudly and says the number.
 */
export const MIN_TARGET_DISTANCE_CM = 20;
export const MAX_TARGET_DISTANCE_CM = 90;

/** Reject a blind-spot result outside the range any of those targets could give. */
const MIN_PLAUSIBLE_CM = 15;
const MAX_PLAUSIBLE_CM = 120;

// v2: K is now anchored on the outer-eye-corner span rather than the face
// silhouette, so a value stored by an older build is wrong by the ratio between
// the two — about 1.6×. Bumping the key discards it instead of restoring it
// confidently after a page reload.
const STORAGE_KEY = 'eyetracker.distanceCalibration.v3';

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

/**
 * Trials that must survive the plausibility filter before the result is used.
 *
 * Three is not a statistical nicety, it is a defence against a specific
 * failure: the median absolute deviation of a *single* value is exactly zero, so
 * a run where four of five trials were thrown away reports `spreadCm: 0` — the
 * most confident-looking number the system can produce, from the least evidence.
 */
export const MIN_BLIND_SPOT_TRIALS = 3;

/**
 * How much the trials are allowed to disagree before the run is rejected.
 *
 * Deliberately *not* derived from the method's ±11.5% eccentricity uncertainty.
 * That term is between-subject: an optic disc at 15° rather than 13.5° shifts
 * every trial by the same factor and shows up as a wrong distance, never as
 * disagreement. What disagreement actually measures is fixation breaks, late
 * presses and guesses — so the limit is set to catch a participant who was not
 * doing the task, not to second-guess one who was. 12% at 40 cm is ±4.8 cm,
 * where good runs land around 1–2 cm.
 */
export function blindSpotSpreadLimitCm(distanceCm: number): number {
  return Math.max(2, distanceCm * 0.12);
}

export interface BlindSpotQuality {
  ok: boolean;
  /** Why it was rejected, phrased for the participant. Empty when ok. */
  reason: string;
}

/**
 * Is this result worth anchoring K to?
 *
 * K is measured once and then multiplies every distance the session reports, so
 * a bad blind-spot run is not a bad reading — it is a bad reading applied
 * silently to everything downstream. Cheaper to repeat a 60-second task than to
 * discover afterwards that a session cannot be pooled with the others.
 */
export function assessBlindSpot(r: BlindSpotResult): BlindSpotQuality {
  if (!Number.isFinite(r.distanceCm)) {
    return { ok: false, reason: 'None of the measurements gave a plausible distance.' };
  }
  if (r.n < MIN_BLIND_SPOT_TRIALS) {
    return {
      ok: false,
      reason: `Only ${r.n} of ${r.n + r.nRejected} measurements were usable.`,
    };
  }
  const limit = blindSpotSpreadLimitCm(r.distanceCm);
  if (Number.isFinite(r.spreadCm) && r.spreadCm > limit) {
    return {
      ok: false,
      reason:
        `The measurements disagreed by ±${r.spreadCm.toFixed(1)} cm ` +
        `(more than the ±${limit.toFixed(1)} cm allowed at ${r.distanceCm.toFixed(0)} cm).`,
    };
  }
  return { ok: true, reason: '' };
}

function median(sortedAsc: number[]): number {
  const n = sortedAsc.length;
  if (!n) return NaN;
  const mid = n >> 1;
  return n % 2 ? sortedAsc[mid] : (sortedAsc[mid - 1] + sortedAsc[mid]) / 2;
}

// ─── Face scale ──────────────────────────────────────────────────────────────

/**
 * Face size as a fraction of frame width. Uncorrected, deliberately.
 *
 * This used to divide by cos(yaw) to undo the foreshortening of a turned head,
 * on the reasoning that otherwise a participant who merely looks sideways is
 * told they have moved away. The reasoning is sound; the correction was not,
 * because the yaw it leaned on is a heuristic that over-reads by a factor of
 * three or more. Telemetry from a real session: a head turn that foreshortened
 * the eye-corner span by 4.8% — about 18° — was reported as 63.6° of yaw, and
 * dividing by cos of that (clamped at 45°) inflated the apparent face size by
 * 41%. The participant was told to move back ten centimetres for turning their
 * head.
 *
 * Compare the two errors directly, against the ±8% depth band:
 *
 *   real turn   uncorrected error   corrected error
 *        10°               1.5%              20.2%
 *        15°               3.4%              36.6%
 *        20°               6.0%              32.9%
 *
 * Doing nothing is better at every angle, and stays inside the band out to 20°
 * — further than the rotation gate allows anyway. A correction is only worth
 * applying when it is more accurate than the thing it corrects, and this one
 * never was.
 *
 * What replaces it is ordering: checkAnchor now judges rotation *before* depth,
 * so a head that has genuinely turned is reported as turned rather than as
 * mis-placed. That needs no scale factor to be right.
 */
export function faceScale(faceWidthNorm: number): number {
  return faceWidthNorm;
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
   * Subject-specific Depth-from-Iris constant (`distance × iris diameter in
   * frame widths`). Present when the 478-landmark iris contour was visible at
   * the absolute anchor.
   */
  irisK?: number;
  /** Iris diameter observed at the anchor, in fractions of frame width. */
  irisScale?: number;
  /** Camera + observable framing profile that produced this calibration. */
  cameraKey?: string;
  /**
   * How the absolute distance was obtained.
   *
   * 'assumed' means the participant was declared to be at the configured target
   * where they happened to be sitting. That makes the absolute figure a guess —
   * but it is still worth anchoring, because K is fixed against the face size
   * observed at that instant, so every *change* from that pose is measured
   * exactly. Only the label is assumed, never the drift.
   *
   * 'camera-focal' means K was reconstructed as F · W_face from a focal length
   * already measured on this camera and a face width measured with the card —
   * see lib/cameraFocal.ts. It is as good as whatever bootstrapped F, and is
   * labelled separately so that is never forgotten.
   */
  method: 'blind-spot' | 'manual' | 'assumed' | 'camera-focal';
  /** Trial disagreement for blind-spot calibrations, cm. */
  spreadCm?: number;
  /**
   * Physical face width from the card-at-cheek step, when it ran.
   *
   * Carried on the calibration rather than held beside it so it survives the
   * round trip through storage: a page reload used to lose it, after which the
   * position anchor silently fell back to a nominal 15 cm face and reported
   * drift in centimetres it had not measured.
   */
  faceWidthCm?: number;
  /** False when pxPerCm is the CSS reference fallback rather than a measurement. */
  screenScaleMeasured?: boolean;
  pxPerCm: number;
  measuredAt: string;
}

export function calibrate(params: {
  distanceCm: number;
  faceScale: number;
  irisScale?: number;
  cameraKey?: string;
  pxPerCm: number;
  screenScaleMeasured?: boolean;
  method: DistanceCalibration['method'];
  spreadCm?: number;
  faceWidthCm?: number;
}): DistanceCalibration | null {
  const {
    distanceCm,
    faceScale: s,
    irisScale,
    cameraKey,
    pxPerCm,
    screenScaleMeasured,
    method,
    spreadCm,
    faceWidthCm,
  } = params;
  if (!(distanceCm > 0) || !(s > 0) || !Number.isFinite(distanceCm) || !Number.isFinite(s)) {
    return null;
  }
  const irisK = irisScale != null ? irisKFromCalibration(distanceCm, irisScale) : NaN;
  return {
    k: distanceCm * s,
    distanceCm,
    faceScale: s,
    ...(Number.isFinite(irisK) ? { irisK, irisScale } : {}),
    ...(cameraKey ? { cameraKey } : {}),
    method,
    spreadCm,
    ...(faceWidthCm != null ? { faceWidthCm } : {}),
    ...(screenScaleMeasured != null ? { screenScaleMeasured } : {}),
    pxPerCm,
    measuredAt: new Date().toISOString(),
  };
}

/**
 * Live distance in cm, fusing face span with calibrated Depth-from-Iris when
 * the current iris contour is available. The face-only call remains backwards
 * compatible for reports and stored sessions that predate iris calibration.
 */
export function distanceFromFace(
  cal: DistanceCalibration,
  scale: number,
  irisScale?: number,
): number {
  const faceCm = scale > 0 ? cal.k / scale : NaN;
  const irisCm = cal.irisK != null && irisScale != null
    ? distanceFromIris(cal.irisK, irisScale)
    : NaN;
  return fuseViewingDistance(faceCm, irisCm).distanceCm;
}

/** Face scale that corresponds to a target distance — for drawing setup guides. */
export function faceScaleAtDistance(cal: DistanceCalibration, distanceCm: number): number {
  return cal.k / distanceCm;
}

// ─── Framing limit ───────────────────────────────────────────────────────────

/**
 * How much of the frame the face must keep clear of every edge.
 *
 * Small, because this is a hard-failure check rather than a comfort margin: the
 * anchor already polices movement, and what this catches is landmarks actually
 * leaving the image. Two percent is about a centimetre at 40 cm — enough that a
 * breath does not trip it, tight enough that it only fires when the participant
 * genuinely will not fit.
 */
export const FRAME_EDGE_MARGIN = 0.02;

export interface FaceBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Smallest gap between the face and any frame edge, in frame fractions. */
export function frameFitMargin(b: FaceBounds): number {
  return Math.min(b.minX, 1 - b.maxX, b.minY, 1 - b.maxY);
}

export function faceFitsInFrame(b: FaceBounds, margin = FRAME_EDGE_MARGIN): boolean {
  return frameFitMargin(b) >= margin;
}

/**
 * Closest distance at which this participant still fits in this camera's frame.
 *
 * Everything scales as 1/d, so the observed span at a known distance predicts
 * the span at any other. Given the face currently occupies `spanFraction` of the
 * tighter frame axis at `atDistanceCm`, the distance at which it would exactly
 * fill the usable part of the frame is
 *
 *     d_min = atDistanceCm · spanFraction / (1 - 2·margin)
 *
 * Measured rather than assumed: no anthropometric table, no field-of-view spec,
 * just this person in front of this camera. Returns NaN when there is nothing to
 * extrapolate from.
 *
 * This is what turns "Move Back" repeating forever into "this camera can do
 * 27 cm, not the 20 cm you configured".
 */
export function nearestFittingDistanceCm(
  spanFraction: number,
  atDistanceCm: number,
  margin = FRAME_EDGE_MARGIN,
): number {
  if (!(spanFraction > 0) || !(atDistanceCm > 0)) return NaN;
  const usable = 1 - 2 * margin;
  if (!(usable > 0)) return NaN;
  return (atDistanceCm * spanFraction) / usable;
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
 * Fractional distance error the reported science can absorb.
 *
 * Every angular quantity scales with distance, and some scale with its square:
 *
 *   saccade amplitude, peak velocity     ∝ d
 *   BCEA (fixation stability)            ∝ d²
 *
 * So 5% of distance is 5% on amplitude and 10% on BCEA. Against a BCEA norm
 * around 2.4 deg², 10% is the most that can be spent on posture before it starts
 * competing with the effect being measured.
 *
 * There is a second, larger reason to keep this tight, and it is specific to the
 * pre/post design this system exists for. The neurological stimuli are placed at
 * fixed *viewport fractions* — the saccadic targets sit at 0.25 and 0.75 of the
 * width — so the amplitude the participant actually performs, in degrees, is set
 * by where they sit. On a 34.5 cm panel that is 30.2° at 32 cm and 20.4° at
 * 48 cm. The distance band therefore does not merely bound the error on a
 * measurement; it bounds how much the *task itself* is allowed to change between
 * one session and the next.
 */
export const ANGULAR_TOLERANCE = 0.05;

/**
 * Physical floor on every position tolerance, in centimetres.
 *
 * A person's ability to hold still is a fixed physical quantity. It does not
 * shrink because they were asked to sit closer. Seated head sway over a minute
 * runs 1.0–1.5 cm RMS in young adults with peak excursions of 2–3 cm, and is
 * 30–60% larger in older people — peaks of 3–4 cm.
 *
 * A purely proportional band forgets this. At a 55 cm target, ±5% is ±2.8 cm and
 * most people can hold it. At 30 cm it becomes ±1.5 cm, which is *smaller than
 * the natural sway of an elderly participant*: the gate can never go green, and
 * the failure looks like the participant doing it wrong rather than the test
 * being physiologically impossible. Moving the flow closer to the camera to gain
 * accuracy silently halved this band, which is exactly the population it then
 * excluded.
 *
 * Three centimetres, matching the lateral drift allowance (0.31 outer-canthal
 * widths ≈ 2.84 cm), so the three axes ask for the same physical steadiness
 * rather than three different amounts.
 *
 * This costs angular accuracy at close range, knowingly: ±3 cm at 30 cm is 10%,
 * not 5%. That is the trade, and it is the right way round. A band nobody can
 * satisfy yields no data at all, and a test that excludes the old is worse than
 * one that measures them slightly less precisely.
 */
export const POSTURAL_FLOOR_CM = 3;

/**
 * Accepted band around the configured target.
 *
 * Fractional rather than fixed, because the cost of a centimetre is fractional:
 * the same misplacement costs twice as much angular error at 30 cm as at 60.
 *
 * The floor is for measurement noise, not for comfort. Per-frame face-width
 * jitter is a few tenths of a percent, and the position is held for two seconds
 * before anything is locked, so half a centimetre is comfortably above the noise
 * and never the binding constraint.
 *
 * This used to be `max(3, target·0.1) · tolerance` with a default tolerance of
 * 2 — ±8 cm at a 40 cm target. That band was sized by how badly the *old*
 * face-width heuristic mismeasured distance, in an era before the measurement
 * was real. Carrying it forward meant the flow proved the participant was at
 * 40 cm and then accepted anywhere from 32 to 48.
 *
 * On absolute versus relative accuracy: the bootstrap carries ±11.5% of its own
 * from the blind spot's eccentricity assumption, which no band can fix. But that
 * error is a constant scale factor for a given person on a given machine, so
 * holding them to ±5% still delivers what pre/post comparison actually needs —
 * the same geometry twice.
 */
export function distanceBandCm(targetCm: number, tolerance = 1): number {
  return (
    Math.max(POSTURAL_FLOOR_CM, targetCm * ANGULAR_TOLERANCE) *
    Math.max(1, Math.min(3, tolerance))
  );
}

export function checkDistance(
  cal: DistanceCalibration | null,
  scale: number,
  targetCm: number,
  tolerance = 1,
  irisScale?: number,
): DistanceCheck {
  const bandCm = distanceBandCm(targetCm, tolerance);
  if (!cal) return { verdict: 'unknown', distanceCm: NaN, targetCm, bandCm };
  const distanceCm = distanceFromFace(cal, scale, irisScale);
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

export function loadCalibration(expectedCameraKey?: string): DistanceCalibration | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DistanceCalibration;
    if (!parsed || !(parsed.k > 0)) return null;
    if (expectedCameraKey && parsed.cameraKey !== expectedCameraKey) return null;
    return parsed;
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
