/**
 * The paper's sclera features (Section 4.2), computed over a sclera mask.
 */
import type { RgbImage } from './types';

/**
 * "Reddish pixel" rule. The paper only says red must exceed green and blue and
 * green-blue must not differ too much (to exclude yellow and violet); it gives
 * no numbers, so these are ours. Red has to lead both other channels by
 * RED_DOMINANCE (relative), and |G - B| must stay under MAX_GB_SPREAD * R.
 * A white or ivory sclera (e.g. 157/147/135) is not red; a pink one is.
 */
export const RED_DOMINANCE = 0.12;
export const MAX_GB_SPREAD = 0.3;

export function isReddish(r: number, g: number, b: number): boolean {
  const lead = r * (1 - RED_DOMINANCE);
  return r > 0 && g < lead && b < lead && Math.abs(g - b) < MAX_GB_SPREAD * r;
}

export interface RednessResult {
  /** Eq. 6: (3 M(R) - M(G) - M(B)) / (3 * 255) over all sclera pixels. */
  mrl: number;
  /** Eq. 7: reddish pixels / sclera pixels. */
  rap: number;
  redMask: Uint8Array;
  scleraPixelCount: number;
}

/** MRL and RAP over the sclera. The denominator of both is the sclera pixel count, as in the paper. */
export function measureRedness(img: RgbImage, sclera: Uint8Array): RednessResult {
  const redMask = new Uint8Array(sclera.length);
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;
  let red = 0;
  for (let i = 0; i < sclera.length; i++) {
    if (!sclera[i]) continue;
    const r = img.data[i * 3];
    const g = img.data[i * 3 + 1];
    const b = img.data[i * 3 + 2];
    sumR += r;
    sumG += g;
    sumB += b;
    count++;
    if (isReddish(r, g, b)) {
      redMask[i] = 1;
      red++;
    }
  }
  if (count === 0) return { mrl: NaN, rap: NaN, redMask, scleraPixelCount: 0 };
  const mrl = (3 * (sumR / count) - sumG / count - sumB / count) / (3 * 255);
  return { mrl, rap: red / count, redMask, scleraPixelCount: count };
}

interface Extent {
  area: number;
  top: number;
  bottom: number;
}

function extent(mask: Uint8Array, w: number): Extent {
  let area = 0;
  let top = Infinity;
  let bottom = -Infinity;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    area++;
    const y = Math.floor(i / w);
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
  return { area, top, bottom };
}

/**
 * Section 4.2: area of the active-contour region over the mask area, and its
 * height (lower extreme minus upper extreme, as regionprops gives it) over the
 * mask height.
 */
export function contourRatios(contour: Uint8Array, mask: Uint8Array, w: number): { contourArea: number; contourHeight: number } {
  const c = extent(contour, w);
  const m = extent(mask, w);
  if (m.area === 0 || c.area === 0) return { contourArea: 0, contourHeight: 0 };
  return {
    contourArea: c.area / m.area,
    contourHeight: (c.bottom - c.top + 1) / (m.bottom - m.top + 1),
  };
}
