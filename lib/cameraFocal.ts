/**
 * Camera focal length, separated out of K so it can be measured once per device
 * instead of once per participant.
 *
 * The blind-spot task is the expensive part of setup: it asks for sustained
 * monocular fixation while judging the disappearance of a peripheral target,
 * takes a minute, and is the step participants fail. It exists because a single
 * uncalibrated camera cannot recover absolute scale on its own — with a card and
 * a face both at distance d,
 *
 *     w_card = F · W_card / d
 *     w_face = F · W_face / d
 *
 * are two equations in three unknowns. Dividing them cancels F and d *together*:
 * the physical face width comes out, the distance never does. That is the
 * monocular scale ambiguity, and no amount of extra image processing gets around
 * it. Something has to supply one absolute length or one absolute angle — a tape
 * measure, or the eye's own optic disc.
 *
 * What it does get around is having to supply it *every time*. The existing
 * constant is
 *
 *     K = d · s          (s = face width as a fraction of frame width)
 *
 * and substituting s = F · W_face / d gives
 *
 *     K = F · W_face
 *
 * so the one number splits cleanly into two that belong to different things:
 *
 *     F         the camera. Fixed for a given device and framing.
 *     W_face    the participant. Measured with a card held against the cheek.
 *
 * Measure F once — bootstrapped from a tape measure or one blind-spot run — and
 * every participant afterwards only needs the ten-second card step, because
 * K = F · W_face reconstructs their constant without another absolute
 * measurement.
 *
 * F is expressed in frame widths rather than pixels deliberately: f_px scales
 * with resolution, so f_px/frameWidth_px is invariant to the camera negotiating
 * 720p instead of 1080p. It is *not* invariant to a different sensor crop, which
 * is why the cache key carries the aspect ratio as well as the device.
 */

import type { DistanceCalibration } from './viewingDistance';

// v2 fixes two unsafe assumptions in v1:
//
//   * a single localStorage slot could only remember one optical profile;
//   * the cache key ignored an exposed zoom/crop setting, so changing framing
//     could silently reuse a focal length measured with different optics.
//
// Deliberately do not migrate v1. A stale focal length looks valid while making
// every distance wrong by one constant factor, so measuring once more is safer
// than guessing which framing produced the old value.
const STORAGE_KEY = 'eyetracker.cameraFocal.v2';

/**
 * Plausible range for F, in frame widths.
 *
 * F relates to horizontal field of view by FOV = 2·atan(1/(2F)), so the common
 * webcam range of 54–78° is F ≈ 0.64–0.98. The band below is deliberately wider
 * than that: it is a guard against a corrupted or mis-keyed cache entry, not a
 * judgement about what optics are reasonable.
 */
export const MIN_FOCAL = 0.35;
export const MAX_FOCAL = 2.5;

export interface CameraFocal {
  /** F = f_px / frameWidth_px. */
  f: number;
  /** Which device and framing this was measured on. */
  cameraKey: string;
  /** How the bootstrap distance was obtained — recorded, never re-derived. */
  method: 'blind-spot' | 'manual';
  /** The absolute distance the bootstrap rested on, cm. */
  bootstrapDistanceCm: number;
  /** The face width that separated F from K, cm. */
  faceWidthCm: number;
  measuredAt: string;
}

export interface CameraFramingSettings {
  /** WebRTC PTZ zoom, when the browser/driver exposes it. */
  zoom?: number;
  /** Whether the driver crops or scales frames to satisfy the requested size. */
  resizeMode?: string;
}

/**
 * Identity of the camera and framing this F belongs to.
 *
 * `deviceId` alone is not enough: the same sensor delivering 16:9 and 4:3 crops
 * different fractions of its field of view, and F changes with it. Resolution is
 * deliberately *not* in the key — F is in frame widths precisely so that 720p
 * and 1080p of the same crop share a value.
 */
export function cameraKey(
  deviceId: string | undefined,
  width?: number,
  height?: number,
  framing: CameraFramingSettings = {},
): string {
  const id = deviceId && deviceId.length ? deviceId.slice(0, 16) : 'default';
  const aspect = width && height ? (width / height).toFixed(2) : 'unknown';
  const zoom = Number.isFinite(framing.zoom) ? Number(framing.zoom).toFixed(3) : 'hidden';
  const resizeMode = framing.resizeMode?.trim() || 'unknown';
  return `${id}@${aspect}:z${zoom}:r${resizeMode}`;
}

/**
 * Can a focal length safely survive closing and reopening the camera stream?
 *
 * macOS can apply Center Stage and Manual Framing after WebRTC capture. Those
 * controls change effective focal length while `deviceId`, resolution and even
 * `getSettings().zoom` may remain unchanged. The browser therefore has no
 * observable key with which to distinguish the two optical profiles. Reusing a
 * cached F on Apple platforms would be confident but uncheckable, so it is
 * intentionally session-only there.
 *
 * Other platforms keep the existing persistent behaviour. Their observable
 * zoom is now part of `cameraKey`; opaque vendor effects remain a reason to use
 * the in-flow "re-measure" action, but do not justify penalising every fixed UVC
 * webcam with a fresh measurement on every run.
 */
export function canPersistFocalForPlatform(platform: string | undefined): boolean {
  const value = platform ?? '';
  return !/(Mac|iPhone|iPad)/i.test(value);
}

/** Horizontal field of view in degrees, for display. F is otherwise unreadable. */
export function fovDegFromFocal(f: number): number {
  return (2 * Math.atan(1 / (2 * f)) * 180) / Math.PI;
}

export function isPlausibleFocal(f: number): boolean {
  return Number.isFinite(f) && f >= MIN_FOCAL && f <= MAX_FOCAL;
}

/**
 * Stand-in focal length for a camera that has not been measured yet: a 65°
 * horizontal field of view, roughly the middle of the common webcam range.
 */
export const NOMINAL_FOCAL = 1 / (2 * Math.tan((65 * Math.PI) / 180 / 2));

/**
 * A distance good enough to walk someone to their seat, before anything has been
 * measured precisely.
 *
 * With the face width already measured from the card, the only unknown left is
 * the camera, and across the common 54–78° range that is about ±22%. Useless as
 * a gate, entirely adequate for "you are at roughly sixty, come forward" — and
 * that is the job. It exists because the absolute measurement that follows has
 * to be taken *near the target distance*, for two reasons:
 *
 *   The blind-spot layout is computed for the target. Its 1.35× headroom runs
 *   out around 54 cm, so a participant sitting at 65 cm doing a 40 cm-target
 *   task may never be able to reach their blind spot at all — which from their
 *   side is indistinguishable from the task being broken.
 *
 *   The camera sits above the screen rather than in it, so d = K/s is not
 *   exactly linear and K quietly inherits the distance it was measured at. About
 *   2% across the working range — small, but it is baked into the cached focal
 *   length and passed to every later participant.
 *
 * Returns NaN when the face width is unknown, which is honest: without it there
 * is nothing to base even a rough guess on.
 */
export function approximateDistanceCm(faceWidthCm: number | null, faceScale: number): number {
  if (faceWidthCm == null || !(faceWidthCm > 0) || !(faceScale > 0)) return NaN;
  return (NOMINAL_FOCAL * faceWidthCm) / faceScale;
}

/**
 * How far off the target the approach step tolerates.
 *
 * Deliberately looser than the estimate's own ±22% uncertainty would suggest is
 * meaningful — it is there to catch someone a foot and a half out of place, not
 * to hold them to anything. Holding happens later, against a real measurement.
 */
export const APPROACH_TOLERANCE = 0.3;

/**
 * Split a measured K into the camera's half.
 *
 * K = F · W_face, so F = K / W_face. This is the whole point of the module: the
 * participant-specific factor divides out and what is left belongs to the
 * hardware.
 */
export function focalFromCalibration(k: number, faceWidthCm: number): number {
  if (!(k > 0) || !(faceWidthCm > 0)) return NaN;
  return k / faceWidthCm;
}

/** And back the other way, for a new participant on a known camera. */
export function kFromFocal(f: number, faceWidthCm: number): number {
  if (!(f > 0) || !(faceWidthCm > 0)) return NaN;
  return f * faceWidthCm;
}

/**
 * Does a fresh absolute measurement still agree with the cached F?
 *
 * The failure this guards against is quiet: someone swaps the webcam, or docks
 * the laptop, and a cached F that no longer describes the optics keeps producing
 * confident distances that are all wrong by the same factor. Whenever a session
 * happens to measure d directly, it costs nothing to check.
 *
 * The tolerance is loose on purpose. The bootstrap itself carries the blind
 * spot's ±11.5% eccentricity uncertainty, so disagreement below that is expected
 * and says nothing; only a gross mismatch means the cache is describing
 * different hardware.
 */
export const FOCAL_DRIFT_TOLERANCE = 0.2;

export interface FocalCheck {
  ok: boolean;
  /** Signed relative disagreement, e.g. 0.08 = the cache reads 8% high. */
  drift: number;
  message: string;
}

export function checkFocalAgainst(
  cached: CameraFocal | null,
  measuredF: number,
): FocalCheck {
  if (!cached || !isPlausibleFocal(measuredF)) {
    return { ok: true, drift: NaN, message: '' };
  }
  const drift = (cached.f - measuredF) / measuredF;
  if (Math.abs(drift) <= FOCAL_DRIFT_TOLERANCE) {
    return { ok: true, drift, message: '' };
  }
  return {
    ok: false,
    drift,
    message:
      `The saved camera calibration disagrees with this measurement by ` +
      `${Math.abs(drift * 100).toFixed(0)}%. It was taken on ` +
      `${new Date(cached.measuredAt).toLocaleDateString()}; if the camera has ` +
      `changed since, it needs re-measuring.`,
  };
}

/**
 * A distance calibration for a participant whose camera is already known.
 *
 * Produces exactly the same shape as a directly measured one, tagged so that
 * nothing downstream mistakes a reconstructed K for a freshly measured one.
 */
export function calibrateFromFocal(params: {
  f: number;
  faceWidthCm: number;
  faceScale: number;
  irisScale?: number;
  cameraKey?: string;
  pxPerCm: number;
  /** False when pxPerCm is the CSS reference fallback rather than a measurement. */
  screenScaleMeasured?: boolean;
}): DistanceCalibration | null {
  const { f, faceWidthCm, faceScale, irisScale, cameraKey, pxPerCm, screenScaleMeasured } = params;
  const k = kFromFocal(f, faceWidthCm);
  if (!(k > 0) || !(faceScale > 0)) return null;
  const distanceCm = k / faceScale;
  const irisK = irisScale != null && irisScale > 0 ? distanceCm * irisScale : NaN;
  return {
    k,
    distanceCm,
    faceScale,
    ...(Number.isFinite(irisK) ? { irisK, irisScale } : {}),
    ...(cameraKey ? { cameraKey } : {}),
    method: 'camera-focal',
    faceWidthCm,
    // Carried explicitly, never left undefined: sessionGeometry reads a missing
    // flag as "measured", so silence here would let a CSS-reference fallback
    // present itself as a physically measured display scale.
    ...(screenScaleMeasured != null ? { screenScaleMeasured } : {}),
    pxPerCm,
    measuredAt: new Date().toISOString(),
  };
}

// ─── Persistence ─────────────────────────────────────────────────────────────
// F belongs to the hardware, so unlike K it is kept across sessions and across
// participants — that is the entire benefit. localStorage rather than
// sessionStorage for the same reason the screen scale uses it.

function loadFocalRecords(): Record<string, CameraFocal> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, CameraFocal>;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

export function loadFocal(key: string): CameraFocal | null {
  const parsed = loadFocalRecords();
  const record = parsed[key];
  if (!record || !isPlausibleFocal(record.f)) return null;
  // An F from different optics is worse than none: it looks valid and is
  // wrong by an unknown factor, on every session until someone notices.
  return record.cameraKey === key ? record : null;
}

export function saveFocal(focal: CameraFocal): boolean {
  if (!isPlausibleFocal(focal.f)) return false;
  try {
    const records = loadFocalRecords();
    records[focal.cameraKey] = focal;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    return true;
  } catch {
    return false;
  }
}

export function clearFocal(key?: string): void {
  try {
    if (!key) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const records = loadFocalRecords();
    delete records[key];
    if (Object.keys(records).length) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}
