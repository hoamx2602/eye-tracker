/**
 * A higher-resolution copy of an analysed eye, for the visualisations only.
 *
 * Features are measured on the normalised crop (iris radius 50 px), the
 * scale the paper works at. Drawn at that size, thin vessels blur away. So
 * the tiles are rendered from the original photo at up to 3x that scale:
 * the geometry is scaled exactly, and the sclera and reddish-pixel masks are
 * rebuilt pixel by pixel with the same rules. The Chan-Vese region is
 * upsampled smoothly rather than re-run.
 */
import { isReddish } from '../features';
import { cropResample } from '../imageOps';
import { LID_EROSION, scleraMask } from '../pipeline';
import type { Circle, EyeAnalysis, LidEvidence, Point, RgbImage } from '../types';
import { resizeMask } from './regions';

/** Upper bound on the display magnification over the normalised crop. */
export const MAX_DISPLAY_FACTOR = 3;

export interface DisplayEye {
  /** The analysis the numbers come from (measurement scale). */
  eye: EyeAnalysis;
  /** Display pixels per measurement pixel. */
  factor: number;
  roi: RgbImage;
  iris: Circle;
  pupil: Circle;
  eyelid: Point[];
  scleraMask: Uint8Array;
  /** Opening minus iris, before the canthal trim and glare removal. */
  openingOutsideIris: Uint8Array;
  redMask: Uint8Array;
  contourMask: Uint8Array;
  lidEvidence?: LidEvidence;
}

const scalePoint = (p: Point, f: number): Point => ({ x: p.x * f, y: p.y * f });
const scaleCircle = (c: Circle, f: number): Circle => ({ cx: c.cx * f, cy: c.cy * f, r: c.r * f });

/**
 * @param src The full-resolution photo the eye was analysed from.
 */
export function displayEye(src: RgbImage, eye: EyeAnalysis): DisplayEye {
  // Native resolution, if the photo has more detail than the normalised crop.
  const factor = Math.min(MAX_DISPLAY_FACTOR, Math.max(1, 1 / eye.roiScale));
  const width = Math.round(eye.roi.width * factor);
  const height = Math.round(eye.roi.height * factor);
  const roi = cropResample(src, eye.roiOrigin.x, eye.roiOrigin.y, eye.roiScale * factor, width, height);
  const iris = scaleCircle(eye.iris, factor);
  const eyelid = eye.eyelid.map((p) => scalePoint(p, factor));
  const { eye: opening, sclera } = scleraMask(roi, eyelid, iris, LID_EROSION * factor);

  const redMask = new Uint8Array(width * height);
  const openingOutsideIris = new Uint8Array(width * height);
  for (let i = 0; i < sclera.length; i++) {
    if (sclera[i] && isReddish(roi.data[i * 3], roi.data[i * 3 + 1], roi.data[i * 3 + 2])) redMask[i] = 1;
    const x = (i % width) + 0.5;
    const y = Math.floor(i / width) + 0.5;
    if (opening[i] && Math.hypot(x - iris.cx, y - iris.cy) > iris.r + factor) openingOutsideIris[i] = 1;
  }
  const contourMask = resizeMask(eye.contourMask, eye.roi.width, eye.roi.height, width, height);
  for (let i = 0; i < contourMask.length; i++) contourMask[i] &= sclera[i];

  const evidence = eye.lidEvidence;
  return {
    eye,
    factor,
    roi,
    iris,
    pupil: scaleCircle(eye.pupil, factor),
    eyelid,
    scleraMask: sclera,
    openingOutsideIris,
    redMask,
    contourMask,
    lidEvidence: evidence && {
      edges: evidence.edges.map((p) => scalePoint(p, factor)),
      inliers: evidence.inliers.map((p) => scalePoint(p, factor)),
      upperLid: scaleCircle(evidence.upperLid, factor),
      lowerLid: scaleCircle(evidence.lowerLid, factor),
    },
  };
}
