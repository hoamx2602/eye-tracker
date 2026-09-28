/**
 * One eye in, five features out - the paper's Sections 4.1-4.2 end to end:
 *   crop and normalise -> refine iris circle -> remove highlights -> pupil
 *   circle -> sclera = eyelid opening minus iris -> MRL, RAP -> active
 *   contour -> contour ratios.
 */
import { chanVese } from './chanVese';
import { findDarkCircle, removeHighlights } from './circleSearch';
import { contourRatios, measureRedness } from './features';
import { channel, cropResample, erode, gaussianBlur, largestComponent, polygonMask, toGray } from './imageOps';
import { assessQuality } from './quality';
import type { Circle, EyeAnalysis, EyeGeometry, GrayImage, Point, RgbImage } from './types';

/** Iris radius, in ROI pixels, every eye is rescaled to. The paper fixes the eye crop height at 150 px. */
export const NORMALISED_IRIS_RADIUS = 50;

/** Specular pixels (near-white, unsaturated) are left out of the sclera. */
const GLARE_MIN_VALUE = 245;

/**
 * Share of the corner-to-corner length cut from each end of the opening. The
 * canthi hold the caruncle and lid margin, which are pink in every eye and
 * would otherwise dominate RAP. The paper does not say how it handled them.
 */
const CANTHUS_TRIM = 0.1;

/** Erosion of the lid outline, in ROI pixels, to keep lashes and lid margin out. */
const LID_EROSION = 2;

/** Normalised crops larger than this mean the geometry is implausible (e.g. an iris click on its own centre). */
const MAX_ROI_SIDE = 1200;
const MIN_IRIS_RADIUS_PX = 3;

interface Roi {
  image: RgbImage;
  origin: Point;
  scale: number;
}

function cropEye(src: RgbImage, geometry: EyeGeometry): Roi {
  const { iris, eyelid } = geometry;
  const xs = [...eyelid.map((p) => p.x), iris.cx - iris.r, iris.cx + iris.r];
  const ys = [...eyelid.map((p) => p.y), iris.cy - iris.r, iris.cy + iris.r];
  const margin = iris.r * 0.4;
  const x0 = Math.min(...xs) - margin;
  const y0 = Math.min(...ys) - margin;
  const scale = NORMALISED_IRIS_RADIUS / iris.r;
  const w = Math.round((Math.max(...xs) + margin - x0) * scale);
  const h = Math.round((Math.max(...ys) + margin - y0) * scale);
  if (iris.r < MIN_IRIS_RADIUS_PX || w > MAX_ROI_SIDE || h > MAX_ROI_SIDE) {
    throw new Error('The eye outline is too large for the iris (or the iris is under 3 px). Check the iris centre and edge points.');
  }
  return { image: cropResample(src, x0, y0, scale, w, h), origin: { x: x0, y: y0 }, scale };
}

function toRoi(p: Point, roi: Roi): Point {
  return { x: (p.x - roi.origin.x) * roi.scale, y: (p.y - roi.origin.y) * roi.scale };
}

/** Refines the landmark iris circle on the red layer, using only the lateral arcs the lids rarely cover. */
function refineIris(red: GrayImage, initial: Circle): { circle: Circle; ok: boolean } {
  const found = findDarkCircle(red, {
    cx: initial.cx,
    cy: initial.cy,
    centreRadius: initial.r * 0.15,
    rMin: initial.r * 0.8,
    rMax: initial.r * 1.25,
    arcs: [[-40, 40], [140, 220]],
  });
  return found.contrast > 8 ? { circle: found.circle, ok: true } : { circle: initial, ok: false };
}

/** Pupil: darkest concentric-ish disc inside the iris after highlight removal (Fig. 3). */
function findPupil(red: GrayImage, iris: Circle): { circle: Circle; contrast: number } {
  const found = findDarkCircle(removeHighlights(red), {
    cx: iris.cx,
    cy: iris.cy,
    centreRadius: iris.r * 0.2,
    rMin: iris.r * 0.12,
    rMax: iris.r * 0.8,
    arcs: [[0, 360]],
    samplesPerArc: 48,
  });
  return { circle: found.circle, contrast: found.contrast };
}

function scleraMask(roi: RgbImage, eyelid: Point[], iris: Circle): { eye: Uint8Array; sclera: Uint8Array } {
  const { width: w, height: h, data } = roi;
  const eye = erode(polygonMask(eyelid, w, h), w, h, LID_EROSION);
  const cornerA = eyelid.reduce((a, p) => (p.x < a.x ? p : a));
  const cornerB = eyelid.reduce((a, p) => (p.x > a.x ? p : a));
  const axisX = cornerB.x - cornerA.x;
  const axisY = cornerB.y - cornerA.y;
  const axisLengthSq = axisX * axisX + axisY * axisY || 1;
  const sclera = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!eye[i] || Math.hypot(x + 0.5 - iris.cx, y + 0.5 - iris.cy) <= iris.r + 1) continue;
      const along = ((x + 0.5 - cornerA.x) * axisX + (y + 0.5 - cornerA.y) * axisY) / axisLengthSq;
      if (along < CANTHUS_TRIM || along > 1 - CANTHUS_TRIM) continue;
      const glare = Math.min(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]) >= GLARE_MIN_VALUE;
      if (!glare) sclera[i] = 1;
    }
  }
  return { eye, sclera };
}

/**
 * Runs the full per-eye pipeline on a source image.
 * @param src Full-resolution RGB image.
 * @param geometry Eye location in source pixels (landmarks or manual clicks).
 */
export function analyzeEye(src: RgbImage, geometry: EyeGeometry): EyeAnalysis {
  const roi = cropEye(src, geometry);
  const { width: w } = roi.image;
  const red = gaussianBlur(channel(roi.image, 0), 1);
  const eyelid = geometry.eyelid.map((p) => toRoi(p, roi));
  const centre = toRoi({ x: geometry.iris.cx, y: geometry.iris.cy }, roi);
  const refined = refineIris(red, { cx: centre.x, cy: centre.y, r: NORMALISED_IRIS_RADIUS });
  const iris = refined.circle;
  const pupil = findPupil(red, iris);

  const { eye, sclera } = scleraMask(roi.image, eyelid, iris);
  const redness = measureRedness(roi.image, sclera);
  const contour = largestComponent(chanVese(toGray(roi.image), sclera, eye), w, roi.image.height);
  const ratios = contourRatios(contour, sclera, w);

  return {
    side: geometry.side,
    source: geometry.source,
    features: { pupilIrisRatio: pupil.circle.r / iris.r, rap: redness.rap, mrl: redness.mrl, ...ratios },
    roi: roi.image,
    roiOrigin: roi.origin,
    roiScale: roi.scale,
    iris,
    pupil: pupil.circle,
    eyelid,
    scleraMask: sclera,
    redMask: redness.redMask,
    contourMask: contour,
    pupilContrast: pupil.contrast,
    scleraPixelCount: redness.scleraPixelCount,
    flags: assessQuality({ geometry, iris, eyelid, eye, sclera, pupilContrast: pupil.contrast, irisRefined: refined.ok, width: w }),
  };
}
