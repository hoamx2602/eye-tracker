/**
 * Eyelid edge points for close-ups with no face landmarks.
 *
 * Per column beside the iris, start on the brightest sclera pixel near the
 * iris-centre row and walk up (and down) while pixels stay sclera-like:
 * within half the way from that column's sclera to the iris in brightness
 * and in whiteness (neutral, not pink or skin-toned). That is
 * the first dark boundary met from inside - the lid margin - never the lash
 * line or skin further out. The reference is per column, so a sclera that
 * darkens towards the corners does not end the walk early; short dark runs
 * (vessels, 2-3 px) are crossed.
 *
 * Absolute whiteness is useless across photos: under warm light the sclera
 * can read more orange than the skin, and a red eye is red. So everything
 * here is relative to the same crop: white-balanced first, and the sclera
 * only has to be brighter than the iris beside it.
 */
import { gaussianBlur, sampleGray, toGray } from './imageOps';
import type { Circle, GrayImage, Point, RgbImage } from './types';

/** Longest dark run (px at iris radius 50) a walk crosses: a vessel, not the lid margin. */
const MAX_GAP = 4;
/** Sclera must be this much brighter than the iris to count as present on a side. */
const MIN_SCLERA_OVER_IRIS = 15;
/**
 * The sclera is the brightest structure around a frontal iris: its brighter
 * side must beat the median of the surrounding annulus (1.1-3 iris radii) by
 * this factor, and the iris must be at most this fraction of it. Measured on
 * the test set: true eyes 1.25-1.67 and 0.22-0.49; pupil-as-iris 1.08-1.15
 * and up to 0.71.
 */
const MIN_SCLERA_OVER_SURROUND = 1.2;
const MAX_IRIS_OVER_SCLERA = 0.6;
/** Smallest allowed gap below a reference, in brightness and whiteness. */
const LUM_TOLERANCE = 15;
const WHITE_TOLERANCE = 20;
/** Consecutive columns without sclera that end a side (the eye corner has been passed). */
const MAX_EMPTY_COLUMNS = 4;

/** White-patch balance: scale each channel so its 97th percentile maps to 240. */
export function whiteBalance(img: RgbImage): RgbImage {
  const gains = [0, 1, 2].map((c) => {
    const values = new Uint8Array(img.width * img.height);
    for (let i = 0; i < values.length; i++) values[i] = img.data[i * 3 + c];
    values.sort();
    return 240 / Math.max(1, values[Math.floor(values.length * 0.97)]);
  });
  const data = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < data.length; i++) data[i] = img.data[i] * gains[i % 3];
  return { width: img.width, height: img.height, data };
}

/** Median over an annulus sector; `skipBlack` ignores the black padding beyond the photo. */
function sectorMedian(img: GrayImage, c: Circle, r0: number, r1: number, from: number, to: number, skipBlack = false): number {
  const values: number[] = [];
  for (let a = from; a <= to; a += 3) {
    const t = (a * Math.PI) / 180;
    for (let r = r0; r <= r1; r += 1) {
      const value = sampleGray(img, c.cx + r * Math.cos(t), c.cy + r * Math.sin(t));
      if (!skipBlack || value > 0) values.push(value);
    }
  }
  values.sort((p, q) => p - q);
  return values[Math.floor(values.length / 2)] ?? 0;
}

/** Per-pixel min(R, G, B). */
export function minChannel(img: RgbImage): GrayImage {
  const data = new Float32Array(img.width * img.height);
  for (let i = 0; i < data.length; i++) data[i] = Math.min(img.data[i * 3], img.data[i * 3 + 1], img.data[i * 3 + 2]);
  return { width: img.width, height: img.height, data };
}

/** min - (max - min): high for bright neutral pixels (sclera), low for skin, lid margin, iris. */
function whiteness(img: RgbImage): GrayImage {
  const data = new Float32Array(img.width * img.height);
  for (let i = 0; i < data.length; i++) {
    const lo = Math.min(img.data[i * 3], img.data[i * 3 + 1], img.data[i * 3 + 2]);
    data[i] = 2 * lo - Math.max(img.data[i * 3], img.data[i * 3 + 1], img.data[i * 3 + 2]);
  }
  return { width: img.width, height: img.height, data };
}

/** Lower bounds a pixel must clear to count as sclera, relative to a sclera reference. */
function scleraBounds(refLum: number, refWhite: number, irisLum: number, irisWhite: number): { minLum: number; minWhite: number } {
  // Half way towards the iris, but never closer to the reference than a
  // fixed tolerance: a grey-blue iris can be as neutral as shadowed sclera.
  return {
    minLum: refLum - Math.max(LUM_TOLERANCE, (refLum - irisLum) / 2),
    minWhite: refWhite - Math.max(WHITE_TOLERANCE, (refWhite - irisWhite) / 2),
  };
}

interface ScleraTest {
  lum: GrayImage;
  white: GrayImage;
  minLum: number;
  minWhite: number;
}

const isSclera = (t: ScleraTest, i: number) => t.lum.data[i] >= t.minLum && t.white.data[i] >= t.minWhite;

/** Walks column `x` from row `start` in direction `dir` while sclera-like; returns the last sclera row. */
function walkColumn(t: ScleraTest, x: number, start: number, dir: 1 | -1, limit: number): number {
  let last = start;
  let gap = 0;
  const { width, height } = t.lum;
  for (let y = start; y >= 0 && y < height && Math.abs(y - start) <= limit; y += dir) {
    if (isSclera(t, y * width + x)) {
      last = y;
      gap = 0;
    } else if (++gap > MAX_GAP) {
      break;
    }
  }
  return last;
}

/** Brightest row of column `x` within `span` rows of `cy`: the walk's start, off any vessel. */
function brightestNear(lum: GrayImage, x: number, cy: number, span: number): number {
  let best = cy;
  for (let y = Math.max(0, cy - span); y <= Math.min(lum.height - 1, cy + span); y++) {
    if (lum.data[y * lum.width + x] > lum.data[best * lum.width + x]) best = y;
  }
  return best;
}

export interface LidEdgePoints {
  upper: Point[];
  lower: Point[];
  /** Which sides of the iris show sclera. */
  sides: { left: boolean; right: boolean };
  /**
   * False when the "sclera" is not the brightest thing around the iris, or
   * the "iris" is barely darker than it: the signature of a pupil mistaken
   * for the iris, with the coloured iris playing the sclera.
   */
  scleraConvincing: boolean;
}

/**
 * Upper and lower lid edge candidates beside the iris, in crop pixels.
 * @param crop Normalised crop (iris radius about 50 px).
 */
export function findLidEdges(crop: RgbImage, iris: Circle): LidEdgePoints {
  const balanced = whiteBalance(crop);
  const lum = gaussianBlur(toGray(balanced), 2);
  const white = gaussianBlur(whiteness(balanced), 2);
  const irisWhite = sectorMedian(white, iris, iris.r * 0.5, iris.r * 0.9, 0, 357);
  const irisLevel = sectorMedian(lum, iris, iris.r * 0.5, iris.r * 0.9, 0, 357);
  // Sclera reference per side: the ring just beside the iris, where a
  // frontal eye always shows sclera.
  const reference = (angle: number) => ({
    lum: sectorMedian(lum, iris, iris.r * 1.1, iris.r * 1.5, angle - 20, angle + 20),
    white: sectorMedian(white, iris, iris.r * 1.1, iris.r * 1.5, angle - 20, angle + 20),
  });
  const refs = { left: reference(180), right: reference(0) };
  const present = (ref: { lum: number; white: number }) => ref.lum - irisLevel >= MIN_SCLERA_OVER_IRIS;
  const sides = { left: present(refs.left), right: present(refs.right) };
  const brightestSide = Math.max(refs.left.lum, refs.right.lum);
  const surround = sectorMedian(lum, iris, iris.r * 1.1, iris.r * 3, 0, 357, true);
  const scleraConvincing = brightestSide >= surround * MIN_SCLERA_OVER_SURROUND && irisLevel <= brightestSide * MAX_IRIS_OVER_SCLERA;
  const upper: Point[] = [];
  const lower: Point[] = [];
  const cy = Math.round(iris.cy);
  for (const dir of [-1, 1] as const) {
    const ref = dir === -1 ? refs.left : refs.right;
    if (!(dir === -1 ? sides.left : sides.right)) continue;
    // A column belongs to the sclera if its start is close to this side's
    // reference in brightness and in whiteness. Skin past the corner can be
    // as bright, but is rarely as neutral.
    const startTest = { lum, white, ...scleraBounds(ref.lum, ref.white, irisLevel, irisWhite) };
    let empty = 0;
    for (let dx = iris.r * 1.08; dx <= iris.r * 4 && empty < MAX_EMPTY_COLUMNS; dx += 2) {
      const x = Math.round(iris.cx + dir * dx);
      if (x < 0 || x >= lum.width) break;
      const start = brightestNear(lum, x, cy, Math.round(iris.r * 0.25));
      if (!isSclera(startTest, start * lum.width + x)) { empty++; continue; }
      empty = 0;
      // Walk while close to this column's own sclera: the lid margin is darker
      // or pinker than the sclera beside it.
      const i = start * lum.width + x;
      const test = { lum, white, ...scleraBounds(lum.data[i], white.data[i], irisLevel, irisWhite) };
      upper.push({ x, y: walkColumn(test, x, start, -1, iris.r * 2.2) });
      lower.push({ x, y: walkColumn(test, x, start, 1, iris.r * 2.2) });
    }
  }
  return { upper, lower, sides, scleraConvincing };
}
