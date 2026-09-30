/**
 * Region masks for the visualisations, derived from one EyeAnalysis:
 * pupil, visible iris, sclera and everything else, in ROI pixels.
 */
import { erode, polygonMask } from '../imageOps';
import type { EyeAnalysis, Point } from '../types';

export interface RegionMasks {
  width: number;
  height: number;
  /** Palpebral opening (inside the lid outline). */
  opening: Uint8Array;
  pupil: Uint8Array;
  /** Iris ring visible between the lids, pupil excluded. */
  iris: Uint8Array;
  sclera: Uint8Array;
}

function disc(cx: number, cy: number, r: number, x: number, y: number): boolean {
  return Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r;
}

export function regionMasks(eye: EyeAnalysis): RegionMasks {
  const { width, height } = eye.roi;
  const opening = polygonMask(eye.eyelid, width, height);
  const pupil = new Uint8Array(width * height);
  const iris = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!opening[i]) continue;
      if (disc(eye.pupil.cx, eye.pupil.cy, eye.pupil.r, x, y)) pupil[i] = 1;
      else if (disc(eye.iris.cx, eye.iris.cy, eye.iris.r, x, y)) iris[i] = 1;
    }
  }
  return { width, height, opening, pupil, iris, sclera: eye.scleraMask };
}

/**
 * Where to put a region's label: the pixel deepest inside the mask (last to
 * survive repeated erosion). A centroid would land inside the iris for the
 * crescent-shaped sclera. Null if the mask is empty.
 */
export function labelAnchor(mask: Uint8Array, width: number, height: number): Point | null {
  let current = mask;
  let last: Uint8Array | null = null;
  for (let pass = 0; pass < 200 && countOnes(current) > 0; pass++) {
    last = current;
    current = erode(current, width, height, 1);
  }
  if (!last) return null;
  const i = last.indexOf(1);
  return { x: (i % width) + 0.5, y: Math.floor(i / width) + 0.5 };
}

/** Centre of mass of a mask; null if empty. */
export function centroid(mask: Uint8Array, width: number): Point | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    sx += i % width;
    sy += Math.floor(i / width);
    n++;
  }
  return n ? { x: sx / n, y: sy / n } : null;
}

/** Mask pixels with at least one 4-neighbour outside the mask. */
export function boundary(mask: Uint8Array, width: number, height: number): Uint8Array {
  const edge = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      const outside = x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
        !mask[i - 1] || !mask[i + 1] || !mask[i - width] || !mask[i + width];
      if (outside) edge[i] = 1;
    }
  }
  return edge;
}

/** A 2 px boundary (outer ring plus the ring just inside it), legible at tile size. */
export function thickBoundary(mask: Uint8Array, width: number, height: number): Uint8Array {
  const outer = boundary(mask, width, height);
  const inner = boundary(erode(mask, width, height, 1), width, height);
  for (let i = 0; i < outer.length; i++) outer[i] |= inner[i];
  return outer;
}

export function countOnes(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i];
  return n;
}
