/**
 * RGBA renderings of an analysed eye, one per visualisation tile. Pure
 * functions over the ROI and masks; the components only blit them.
 */
import type { GrayImage, RgbImage } from '../types';
import { REDNESS, REGION_COLOURS, type Rgb } from './palette';
import type { RegionMasks } from './regions';

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

function blank(width: number, height: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { width, height, data };
}

function put(out: RgbaImage, i: number, r: number, g: number, b: number) {
  out.data[i * 4] = r;
  out.data[i * 4 + 1] = g;
  out.data[i * 4 + 2] = b;
}

function blend(out: RgbaImage, i: number, [r, g, b]: Rgb, alpha: number) {
  const d = out.data;
  d[i * 4] = d[i * 4] * (1 - alpha) + r * alpha;
  d[i * 4 + 1] = d[i * 4 + 1] * (1 - alpha) + g * alpha;
  d[i * 4 + 2] = d[i * 4 + 2] * (1 - alpha) + b * alpha;
}

/** The normalised crop itself. */
export function photo(roi: RgbImage): RgbaImage {
  const out = blank(roi.width, roi.height);
  for (let i = 0; i < roi.width * roi.height; i++) put(out, i, roi.data[i * 3], roi.data[i * 3 + 1], roi.data[i * 3 + 2]);
  return out;
}

/** The photo inside `mask`, black elsewhere (the notebook's "segmented" views). */
export function maskedPhoto(roi: RgbImage, mask: Uint8Array): RgbaImage {
  const out = blank(roi.width, roi.height);
  for (let i = 0; i < mask.length; i++) if (mask[i]) put(out, i, roi.data[i * 3], roi.data[i * 3 + 1], roi.data[i * 3 + 2]);
  return out;
}

/** White where the mask is set, black elsewhere. */
export function binary(mask: Uint8Array, width: number, height: number): RgbaImage {
  const out = blank(width, height);
  for (let i = 0; i < mask.length; i++) if (mask[i]) put(out, i, 255, 255, 255);
  return out;
}

/** Single-channel image as greyscale, `lo`..`hi` stretched to 0..255. */
export function greyscale(img: GrayImage, lo = 0, hi = 255): RgbaImage {
  const out = blank(img.width, img.height);
  const span = hi - lo || 1;
  for (let i = 0; i < img.data.length; i++) {
    const v = Math.max(0, Math.min(255, ((img.data[i] - lo) / span) * 255));
    put(out, i, v, v, v);
  }
  return out;
}

/** Translucent region colours over the photo (the notebook's numbered overlay). */
export function regionOverlay(roi: RgbImage, regions: RegionMasks, alpha = 0.45): RgbaImage {
  const out = photo(roi);
  for (let i = 0; i < regions.opening.length; i++) {
    if (regions.pupil[i]) blend(out, i, REGION_COLOURS.pupil, alpha);
    else if (regions.iris[i]) blend(out, i, REGION_COLOURS.iris, alpha);
    else if (regions.sclera[i]) blend(out, i, REGION_COLOURS.sclera, alpha);
    else blend(out, i, REGION_COLOURS.other, alpha * 0.6);
  }
  return out;
}

/** Flat region colours on black (the notebook's combined label map). */
export function labelMap(regions: RegionMasks): RgbaImage {
  const out = blank(regions.width, regions.height);
  for (let i = 0; i < regions.opening.length; i++) {
    const colour = regions.pupil[i] ? REGION_COLOURS.pupil : regions.iris[i] ? REGION_COLOURS.iris : regions.sclera[i] ? REGION_COLOURS.sclera : null;
    if (colour) put(out, i, ...colour);
  }
  return out;
}

/** Per-pixel Eq. 6 redness, (3R - G - B) / (3 * 255). Its mean over the sclera is the MRL. */
export function pixelRedness(roi: RgbImage, i: number): number {
  return (3 * roi.data[i * 3] - roi.data[i * 3 + 1] - roi.data[i * 3 + 2]) / (3 * 255);
}

/** Redness of each sclera pixel as the strength of one warm hue over a dimmed greyscale photo. */
export function rednessHeatmap(roi: RgbImage, sclera: Uint8Array, maxRedness = 0.5): RgbaImage {
  const out = blank(roi.width, roi.height);
  for (let i = 0; i < sclera.length; i++) {
    const grey = (roi.data[i * 3] * 0.3 + roi.data[i * 3 + 1] * 0.59 + roi.data[i * 3 + 2] * 0.11) * 0.45;
    put(out, i, grey, grey, grey);
    if (!sclera[i]) continue;
    const strength = Math.max(0, Math.min(1, pixelRedness(roi, i) / maxRedness));
    blend(out, i, REDNESS, 0.15 + 0.85 * strength);
  }
  return out;
}

/** Sets `mask` pixels of an existing image to one colour (outlines, highlights). */
export function paint(img: RgbaImage, mask: Uint8Array, colour: Rgb): RgbaImage {
  for (let i = 0; i < mask.length; i++) if (mask[i]) put(img, i, ...colour);
  return img;
}
