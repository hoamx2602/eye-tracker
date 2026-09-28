/**
 * Circle localisation for the iris and pupil.
 *
 * The paper finds both with a circular Hough transform on Canny edges. On
 * arbitrary uploads that needs per-image tuning (Table 3), so this uses
 * Daugman's integro-differential operator instead: over candidate centres and
 * radii, find where the mean intensity along the circle jumps most from dark
 * (inside) to bright (outside). It answers the same question - "where is the
 * dark disc?" - without edge thresholds, and restricting the arc to chosen
 * angles keeps eyelids out of the iris fit.
 */
import { sampleGray } from './imageOps';
import type { Circle, GrayImage } from './types';

export interface CircleSearchOptions {
  /** Centre of the search window and its half-size, in pixels. */
  cx: number;
  cy: number;
  centreRadius: number;
  rMin: number;
  rMax: number;
  /** Arcs to integrate over, [from, to] in degrees; 0 = +x, 90 = +y (down). */
  arcs: [number, number][];
  samplesPerArc?: number;
}

export interface CircleSearchResult {
  circle: Circle;
  /** Mean intensity just outside minus just inside the circle, 0..255. */
  contrast: number;
}

function arcAngles(arcs: [number, number][], perArc: number): { cos: Float32Array; sin: Float32Array } {
  const angles: number[] = [];
  for (const [from, to] of arcs) {
    for (let k = 0; k < perArc; k++) angles.push(((from + ((to - from) * (k + 0.5)) / perArc) * Math.PI) / 180);
  }
  return { cos: Float32Array.from(angles, Math.cos), sin: Float32Array.from(angles, Math.sin) };
}

function ringMean(img: GrayImage, cx: number, cy: number, r: number, cos: Float32Array, sin: Float32Array): number {
  let sum = 0;
  for (let k = 0; k < cos.length; k++) sum += sampleGray(img, cx + r * cos[k], cy + r * sin[k]);
  return sum / cos.length;
}

/**
 * Finds the circle maximising the smoothed radial derivative of the arc mean.
 * @param img Blurred single-channel image; the target disc must be darker than its surround.
 */
export function findDarkCircle(img: GrayImage, opts: CircleSearchOptions): CircleSearchResult {
  const { cos, sin } = arcAngles(opts.arcs, opts.samplesPerArc ?? 24);
  const rMin = Math.max(2, Math.floor(opts.rMin));
  const rMax = Math.ceil(opts.rMax);
  const profile = new Float32Array(rMax + 3);
  let best: CircleSearchResult = { circle: { cx: opts.cx, cy: opts.cy, r: rMin }, contrast: -Infinity };
  const span = Math.ceil(opts.centreRadius);
  for (let dy = -span; dy <= span; dy++) {
    for (let dx = -span; dx <= span; dx++) {
      if (dx * dx + dy * dy > span * span) continue;
      const cx = opts.cx + dx;
      const cy = opts.cy + dy;
      for (let r = rMin - 2; r <= rMax + 2; r++) profile[r] = ringMean(img, cx, cy, r, cos, sin);
      for (let r = rMin; r <= rMax; r++) {
        // Outside minus inside over a 2 px step on each side: a smoothed derivative.
        const jump = (profile[r + 1] + profile[r + 2] - profile[r - 1] - profile[r - 2]) / 2;
        if (jump > best.contrast) best = { circle: { cx, cy, r }, contrast: jump };
      }
    }
  }
  return best;
}

/**
 * Removes specular highlights the way the paper does (complement, fill holes,
 * complement): every bright region not connected to the image border is
 * lowered to the level of the darker ring around it. Implemented as grayscale
 * reconstruction by erosion with the usual two-pass raster scan.
 */
export function removeHighlights(img: GrayImage): GrayImage {
  const { width: w, height: h } = img;
  const inv = img.data.map((v) => 255 - v);
  const marker = new Float32Array(w * h).fill(255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) marker[y * w + x] = inv[y * w + x];
    }
  }
  for (let changed = true, pass = 0; changed && pass < 50; pass++) {
    changed = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) changed = relax(marker, inv, w, x, y, x > 0 ? -1 : 0, y > 0 ? -w : 0) || changed;
    }
    for (let y = h - 1; y >= 0; y--) {
      for (let x = w - 1; x >= 0; x--) changed = relax(marker, inv, w, x, y, x < w - 1 ? 1 : 0, y < h - 1 ? w : 0) || changed;
    }
  }
  return { width: w, height: h, data: marker.map((v) => 255 - v) };
}

/** marker[p] = max(min(marker[p], neighbours), inv[p]); true if it dropped. */
function relax(marker: Float32Array, inv: Float32Array, w: number, x: number, y: number, dx: number, dy: number): boolean {
  const p = y * w + x;
  const value = Math.max(Math.min(marker[p], marker[p + dx], marker[p + dy]), inv[p]);
  if (value < marker[p]) {
    marker[p] = value;
    return true;
  }
  return false;
}
