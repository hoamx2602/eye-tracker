/**
 * Conjunctival vessel map, for display only (not one of the paper's features).
 *
 * Vessels are thin dark lines on the sclera, darkest in the green channel.
 * A grey-level closing (max filter then min filter) paints over anything
 * thinner than the structuring element, so closing minus the image - the
 * black top-hat - lights up exactly the thin dark lines. Thresholded inside
 * the sclera, that is the vessel network the reddish-pixel count responds to.
 */
import { gaussianBlur } from '../imageOps';
import type { GrayImage, RgbImage } from '../types';

/** 1-D running max or min of `radius` along rows or columns. */
function runFilter(src: Float32Array, w: number, h: number, radius: number, horizontal: boolean, pick: (a: number, b: number) => number): Float32Array {
  const out = new Float32Array(src.length);
  const lines = horizontal ? h : w;
  const length = horizontal ? w : h;
  for (let line = 0; line < lines; line++) {
    for (let k = 0; k < length; k++) {
      let value = src[horizontal ? line * w + k : k * w + line];
      for (let d = Math.max(0, k - radius); d <= Math.min(length - 1, k + radius); d++) {
        value = pick(value, src[horizontal ? line * w + d : d * w + line]);
      }
      out[horizontal ? line * w + k : k * w + line] = value;
    }
  }
  return out;
}

/** Grey-level closing with a (2r+1)^2 square: dilation (max) then erosion (min). */
function closing(img: GrayImage, radius: number): Float32Array {
  const { width: w, height: h } = img;
  const dilated = runFilter(runFilter(img.data, w, h, radius, true, Math.max), w, h, radius, false, Math.max);
  return runFilter(runFilter(dilated, w, h, radius, true, Math.min), w, h, radius, false, Math.min);
}

export interface VesselMap {
  mask: Uint8Array;
  /** Share of sclera pixels on a vessel. */
  coverage: number;
}

/**
 * @param roi Display-resolution crop.
 * @param sclera Sclera mask at the same resolution.
 * @param factor Display pixels per normalised pixel; scales the vessel width.
 */
export function vesselMap(roi: RgbImage, sclera: Uint8Array, factor: number): VesselMap {
  const { width: w, height: h } = roi;
  const green = new Float32Array(w * h);
  for (let i = 0; i < green.length; i++) green[i] = roi.data[i * 3 + 1];
  const smooth = gaussianBlur({ width: w, height: h, data: green }, 0.6 * factor);
  // Vessels up to ~3 normalised px wide; wider dark areas (shadows) are left alone.
  const closed = closing(smooth, Math.max(2, Math.round(2 * factor)));
  const strength = new Float32Array(w * h);
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let i = 0; i < strength.length; i++) {
    if (!sclera[i]) continue;
    strength[i] = closed[i] - smooth.data[i];
    sum += strength[i];
    sumSq += strength[i] ** 2;
    n++;
  }
  const mean = n ? sum / n : 0;
  const std = n ? Math.sqrt(Math.max(0, sumSq / n - mean * mean)) : 0;
  // Adaptive: clearly above this sclera's own texture, and never below 6 grey levels.
  const threshold = Math.max(6, mean + 1.5 * std);
  const mask = new Uint8Array(w * h);
  let hits = 0;
  for (let i = 0; i < mask.length; i++) {
    if (sclera[i] && strength[i] > threshold) {
      mask[i] = 1;
      hits++;
    }
  }
  return { mask, coverage: n ? hits / n : 0 };
}
