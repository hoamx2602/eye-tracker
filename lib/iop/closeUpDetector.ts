/**
 * Finds the eye in a close-up photo where no face is visible, so MediaPipe
 * has nothing to lock onto. Follows the paper's order (Section 4.1): iris
 * circle first, then the eyelids from the sclera around it.
 *
 *   1. Iris: whole-image search for a dark disc with bright sclera on both
 *      lateral sides (irisSearch.ts), on a downscaled, white-balanced
 *      min-channel image.
 *   2. Lid edges: per column beside the iris, walk out of the sclera to the
 *      lid margin (lidEdges.ts).
 *   3. Eyelids: a RANSAC circle through each set of edges - the paper's two
 *      eyelid circles - meeting at the eye corners (lidFit.ts).
 *   Checks between steps: a dark pupil inside the iris, sclera that is the
 *   brightest thing around it, and an opening of plausible width.
 *
 * Any unconvincing step returns a reason instead of geometry; the caller
 * then asks for manual points rather than measuring the wrong thing.
 */
import { findPupil } from './circleSearch';
import { channel, cropResample, gaussianBlur } from './imageOps';
import { preferIrisOverPupil, refineIris, searchIris } from './irisSearch';
import { findLidEdges, minChannel, whiteBalance } from './lidEdges';
import { fitLidGrowing, lidOutline } from './lidFit';
import type { Circle, EyeGeometry, LidEvidence, Point, RgbImage } from './types';

/** The iris search runs on a copy this size (longest side). */
const SEARCH_SIDE = 240;
/** Iris radius as a share of the shorter image side. */
const MIN_IRIS_SHARE = 0.03;
const MAX_IRIS_SHARE = 0.45;
/** Weaker lateral edge (0..255) an iris must have, before and after refinement. */
const MIN_IRIS_SCORE = 10;
/** How far past the outermost fitted edge point a corner may sit, in iris radii. */
const CORNER_OVERSHOOT = 0.5;
/** Narrowest plausible eye opening, in iris radii. */
const MIN_WIDTH_RADII = 3;
/** Furthest an eye corner may be from the iris centre, in iris radii. */
const MAX_CORNER_REACH = 3.5;
/**
 * A real eye has a dark pupil inside the iris. Without one, a dark disc
 * beside a bright band (a striped background, a button) is not an eye.
 * True eyes in the evaluation set: 24-38; a flag photo that fooled the
 * earlier checks: 5.
 */
const MIN_PUPIL_CONTRAST = 12;
/** Working scale: iris radius in the normalised crop. */
const CROP_IRIS_RADIUS = 50;

export interface CloseUpResult {
  geometry: EyeGeometry | null;
  /** Why detection gave up, for the UI and for debugging. */
  reason?: string;
  /** Iris circle found before giving up (source pixels), for debugging. */
  irisCandidate?: Circle;
}

/** Normalised crop around a coarse iris: iris radius 50 px, room for the lids and corners. */
function cropAroundIris(src: RgbImage, iris: Circle) {
  const scale = CROP_IRIS_RADIUS / iris.r;
  const x0 = iris.cx - iris.r * 5;
  const y0 = iris.cy - iris.r * 3;
  const size = CROP_IRIS_RADIUS * 2;
  return { image: cropResample(src, x0, y0, scale, size * 5, size * 3), x0, y0, scale };
}

/** Lid circles through the edge points, and the outline between the corners where they meet. */
function lidsFromEdges(crop: RgbImage, iris: Circle): { eyelid: Point[] | null; reason?: string; evidence?: LidEvidence } {
  const edges = findLidEdges(crop, iris);
  if (!edges.sides.left && !edges.sides.right) return { eyelid: null, reason: 'No sclera visible beside the iris.' };
  if (!edges.scleraConvincing) return { eyelid: null, reason: 'The region beside the iris does not look like sclera.' };
  // Lid circles in the paper's Fig. 6 are a few iris radii across; a small
  // circle would just hug one cluster of points.
  const common = {
    rMin: iris.r * 1.8, rMax: iris.r * 10, tolerance: 3, stopAfter: 3, centreX: iris.cx, maxCentreOffset: iris.r * 1.5,
  };
  const upper = fitLidGrowing(edges.upper, iris.r * 2, { ...common, centreBelow: true });
  const lower = fitLidGrowing(edges.lower, iris.r * 2, { ...common, centreBelow: false });
  if (!upper || !lower) return { eyelid: null, reason: 'Could not fit the eyelids.' };
  // Corners: where the lid circles meet, looked for just beyond the
  // outermost edge points that fit, never past 3.5 iris radii (an eye is at
  // most ~3 iris diameters wide), and only where both circles exist.
  const xs = [...upper.inliers, ...lower.inliers].map((p) => p.x);
  const u = upper.circle;
  const l = lower.circle;
  const span: [number, number] = [
    Math.max(Math.min(...xs) - iris.r * CORNER_OVERSHOOT, u.cx - u.r, l.cx - l.r, iris.cx - iris.r * MAX_CORNER_REACH),
    Math.min(Math.max(...xs) + iris.r * CORNER_OVERSHOOT, u.cx + u.r, l.cx + l.r, iris.cx + iris.r * MAX_CORNER_REACH),
  ];
  const eyelid = span[1] > span[0] ? lidOutline(u, l, span) : null;
  if (!eyelid) return { eyelid: null, reason: 'The fitted eyelids do not enclose the iris.' };
  const evidence = { edges: [...edges.upper, ...edges.lower], inliers: [...upper.inliers, ...lower.inliers], upperLid: u, lowerLid: l };
  return { eyelid, evidence };
}

/**
 * An eye is about 2.5 iris diameters wide; even with a corner hidden the
 * opening spans 3+ iris radii. A narrower outline means the "iris" was
 * really the pupil. It must also be at least ~0.9 iris radii tall at the iris.
 */
function plausibleOpening(eyelid: Point[], iris: Circle): boolean {
  const xs = eyelid.map((p) => p.x);
  const width = Math.max(...xs) - Math.min(...xs);
  const half = eyelid.length / 2;
  const nearest = (points: Point[]) => points.reduce((a, p) => (Math.abs(p.x - iris.cx) < Math.abs(a.x - iris.cx) ? p : a));
  const opening = nearest(eyelid.slice(half)).y - nearest(eyelid.slice(0, half)).y;
  return width >= iris.r * MIN_WIDTH_RADII && opening >= iris.r * 0.9;
}

/** Locates the eye in a close-up with no detectable face. */
export function detectCloseUpEye(src: RgbImage): CloseUpResult {
  const shrink = Math.min(1, SEARCH_SIDE / Math.max(src.width, src.height));
  const small = cropResample(src, 0, 0, shrink, Math.round(src.width * shrink), Math.round(src.height * shrink));
  // Min channel after white balance: the sclera is bright in every channel,
  // an iris of any colour is dark in at least one (blue in R, brown in B).
  const searchImage = gaussianBlur(minChannel(whiteBalance(small)), 1.5);
  const minSide = Math.min(small.width, small.height);
  const rMax = minSide * MAX_IRIS_SHARE;
  const first = searchIris(searchImage, Math.max(4, minSide * MIN_IRIS_SHARE), rMax);
  if (!first || first.score < MIN_IRIS_SCORE) return { geometry: null, reason: 'No iris-like disc found.' };
  const coarse = preferIrisOverPupil(searchImage, first, rMax).circle;
  const irisCandidate = { cx: coarse.cx / shrink, cy: coarse.cy / shrink, r: coarse.r / shrink };

  const crop = cropAroundIris(src, irisCandidate);
  const cropCentre = { cx: 5 * CROP_IRIS_RADIUS, cy: 3 * CROP_IRIS_RADIUS, r: CROP_IRIS_RADIUS };
  const refined = refineIris(gaussianBlur(minChannel(whiteBalance(crop.image)), 1), cropCentre, 8, CROP_IRIS_RADIUS * 0.8, CROP_IRIS_RADIUS * 1.25);
  if (refined.score < MIN_IRIS_SCORE) return { geometry: null, reason: 'The iris edge is not clear on both sides.', irisCandidate };
  const iris = refined.circle;

  const pupil = findPupil(gaussianBlur(channel(crop.image, 0), 1), iris);
  if (pupil.contrast < MIN_PUPIL_CONTRAST) return { geometry: null, reason: 'No dark pupil inside the iris candidate.', irisCandidate };

  const lids = lidsFromEdges(crop.image, iris);
  const eyelid = lids.eyelid;
  if (!eyelid) return { geometry: null, reason: lids.reason, irisCandidate };
  if (!plausibleOpening(eyelid, iris)) return { geometry: null, reason: 'The eye opening found is implausible.', irisCandidate };

  const toSource = (p: Point): Point => ({ x: crop.x0 + p.x / crop.scale, y: crop.y0 + p.y / crop.scale });
  const circleToSource = (c: Circle): Circle => {
    const centre = toSource({ x: c.cx, y: c.cy });
    return { cx: centre.x, cy: centre.y, r: c.r / crop.scale };
  };
  const irisCentre = toSource({ x: iris.cx, y: iris.cy });
  const evidence = lids.evidence;
  return {
    geometry: {
      side: 'unknown',
      iris: { cx: irisCentre.x, cy: irisCentre.y, r: iris.r / crop.scale },
      eyelid: eyelid.map(toSource),
      source: 'auto',
      lidEvidence: evidence && {
        edges: evidence.edges.map(toSource),
        inliers: evidence.inliers.map(toSource),
        upperLid: circleToSource(evidence.upperLid),
        lowerLid: circleToSource(evidence.lowerLid),
      },
    },
  };
}
