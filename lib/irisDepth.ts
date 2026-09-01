/**
 * MediaPipe Depth-from-Iris primitives.
 *
 * A projected iris has an almost population-invariant physical diameter, so a
 * calibrated pinhole camera can estimate eye-to-camera distance from
 *
 *     distance = focalLength · irisDiameter / irisDiameterInImage
 *
 * MediaPipe reports <10% relative error for this method. In this application we
 * do one better than the population prior after the setup measurement: `irisK`
 * is learned for the current participant at the same instant as the face-scale
 * anchor. That removes between-person iris-size bias while retaining the iris'
 * useful independence from the outer-eye-corner distance signal.
 */

export const POPULATION_IRIS_DIAMETER_CM = 1.17;

type Point2D = { x: number; y: number };

const LEFT_IRIS_CONTOUR = [469, 470, 471, 472] as const;
const RIGHT_IRIS_CONTOUR = [474, 475, 476, 477] as const;

function frameWidthDistance(a: Point2D, b: Point2D, frameAspect: number): number {
  const aspect = frameAspect > 0 && Number.isFinite(frameAspect) ? frameAspect : 16 / 9;
  return Math.hypot(a.x - b.x, (a.y - b.y) / aspect);
}

/**
 * Diameter of one iris in fractions of frame width.
 *
 * The four MediaPipe contour points sit at cardinal points on the iris. Taking
 * the largest pairwise chord approximates the major axis of the projected
 * circle and is less sensitive to gaze-induced foreshortening than assuming a
 * particular pair is horizontal. Y is converted from frame-height units before
 * it is mixed with X.
 */
function contourDiameter(
  landmarks: readonly Point2D[],
  indices: readonly number[],
  frameAspect: number,
): number {
  const points = indices.map((i) => landmarks[i]).filter(Boolean);
  if (points.length !== indices.length) return NaN;
  let diameter = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      diameter = Math.max(diameter, frameWidthDistance(points[i], points[j], frameAspect));
    }
  }
  return diameter > 0 && diameter < 0.1 ? diameter : NaN;
}

/** Robust two-eye iris diameter in fractions of frame width. */
export function irisDiameterNorm(
  landmarks: readonly Point2D[],
  frameAspect: number,
): number {
  if (!landmarks || landmarks.length < 478) return NaN;
  const values = [
    contourDiameter(landmarks, LEFT_IRIS_CONTOUR, frameAspect),
    contourDiameter(landmarks, RIGHT_IRIS_CONTOUR, frameAspect),
  ].filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!values.length) return NaN;
  return values.length === 1 ? values[0] : (values[0] + values[1]) / 2;
}

/** Subject-specific iris constant captured at one known distance. */
export function irisKFromCalibration(distanceCm: number, diameterNorm: number): number {
  if (!(distanceCm > 0) || !(diameterNorm > 0)) return NaN;
  return distanceCm * diameterNorm;
}

/** Population-prior iris constant when only camera focal length is known. */
export function irisKFromFocal(focalFrameWidths: number): number {
  if (!(focalFrameWidths > 0)) return NaN;
  return focalFrameWidths * POPULATION_IRIS_DIAMETER_CM;
}

export function distanceFromIris(irisK: number, diameterNorm: number): number {
  if (!(irisK > 0) || !(diameterNorm > 0)) return NaN;
  return irisK / diameterNorm;
}

export type DistanceFusionSource = 'face' | 'iris' | 'face+iris';

export interface FusedDistance {
  distanceCm: number;
  source: DistanceFusionSource;
  /** Symmetric fractional disagreement; 0.2 means roughly 20%. */
  disagreement: number;
}

/**
 * Fuse independent face-span and iris-diameter estimates.
 *
 * Both estimates are multiplicative, so their geometric mean is the natural
 * midpoint. A gross disagreement means the small iris contour is occluded or
 * mistracked; in that case the larger, rigid face segment remains the safe
 * fallback. Digital zoom fools both equally, which is why opaque macOS framing
 * is handled by per-session calibration rather than by this function.
 */
export function fuseViewingDistance(faceCm: number, irisCm: number): FusedDistance {
  const faceOk = Number.isFinite(faceCm) && faceCm > 0;
  const irisOk = Number.isFinite(irisCm) && irisCm > 0;
  if (!faceOk && !irisOk) return { distanceCm: NaN, source: 'face', disagreement: NaN };
  if (!irisOk) return { distanceCm: faceCm, source: 'face', disagreement: NaN };
  if (!faceOk) return { distanceCm: irisCm, source: 'iris', disagreement: NaN };

  const disagreement = Math.abs(Math.log(irisCm / faceCm));
  // exp(0.22) ≈ 1.25. Beyond that, averaging a likely iris outlier into the
  // answer is worse than keeping the well-resolved face anchor.
  if (disagreement > 0.22) return { distanceCm: faceCm, source: 'face', disagreement };
  return {
    distanceCm: Math.sqrt(faceCm * irisCm),
    source: 'face+iris',
    disagreement,
  };
}
