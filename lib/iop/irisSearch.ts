/**
 * Whole-image iris search for close-ups (no landmarks to start from).
 *
 * An iris is a dark disc with bright sclera beside it, usually on both
 * lateral sides. Each side's edge is measured separately and the score is
 * weaker + half the stronger: two strong sides win, but an eye whose lid
 * hides the sclera on one side can still be found. Lash clusters and glare
 * rims rarely have even one clean circular edge.
 */
import { sampleGray } from './imageOps';
import type { Circle, GrayImage } from './types';

export interface IrisCandidate {
  circle: Circle;
  /** min(left, right edge jump) + max(left, right) / 2, on a 0..255 scale. */
  score: number;
}

const ARC_HALF_WIDTH = 45;
const SAMPLES_PER_ARC = 12;

const angles = (centre: number) =>
  Array.from({ length: SAMPLES_PER_ARC }, (_, k) => ((centre - ARC_HALF_WIDTH + ((2 * ARC_HALF_WIDTH) * (k + 0.5)) / SAMPLES_PER_ARC) * Math.PI) / 180);
const RIGHT = angles(0);
const LEFT = angles(180);

function arcMean(img: GrayImage, cx: number, cy: number, r: number, arc: number[]): number {
  let sum = 0;
  for (const t of arc) sum += sampleGray(img, cx + r * Math.cos(t), cy + r * Math.sin(t));
  return sum / arc.length;
}

/** Best balanced-edge circle centred at (cx, cy) with radius in [rMin, rMax]. */
function bestAt(img: GrayImage, cx: number, cy: number, rMin: number, rMax: number): IrisCandidate {
  const lo = Math.max(2, Math.floor(rMin) - 2);
  const hi = Math.ceil(rMax) + 2;
  const left = new Float32Array(hi + 1);
  const right = new Float32Array(hi + 1);
  for (let r = lo; r <= hi; r++) {
    left[r] = arcMean(img, cx, cy, r, LEFT);
    right[r] = arcMean(img, cx, cy, r, RIGHT);
  }
  let best: IrisCandidate = { circle: { cx, cy, r: rMin }, score: -Infinity };
  for (let r = lo + 2; r <= hi - 2; r++) {
    const jumpLeft = (left[r + 1] + left[r + 2] - left[r - 1] - left[r - 2]) / 2;
    const jumpRight = (right[r + 1] + right[r + 2] - right[r - 1] - right[r - 2]) / 2;
    const score = Math.min(jumpLeft, jumpRight) + Math.max(jumpLeft, jumpRight) / 2;
    if (score > best.score) best = { circle: { cx, cy, r }, score };
  }
  return best;
}

/**
 * Grid search over centres darker than the 40th percentile (a pupil or iris
 * centre is dark), step 2 px.
 */
export function searchIris(img: GrayImage, rMin: number, rMax: number): IrisCandidate | null {
  const sorted = Float32Array.from(img.data).sort();
  const darkLimit = sorted[Math.floor(sorted.length * 0.4)];
  let best: IrisCandidate | null = null;
  const margin = Math.ceil(rMin);
  for (let y = margin; y < img.height - margin; y += 2) {
    for (let x = margin; x < img.width - margin; x += 2) {
      if (img.data[y * img.width + x] > darkLimit) continue;
      const found = bestAt(img, x, y, rMin, rMax);
      if (!best || found.score > best.score) best = found;
    }
  }
  return best;
}

/**
 * The pupil also has two bright lateral sides (the iris). If a concentric
 * circle 1.6-5x larger scores nearly as well, `inner` was the pupil and the
 * larger one is the iris.
 */
export function preferIrisOverPupil(img: GrayImage, inner: IrisCandidate, rMax: number): IrisCandidate {
  const { cx, cy, r } = inner.circle;
  if (r * 1.6 > rMax) return inner;
  let best: IrisCandidate | null = null;
  const span = Math.max(2, Math.round(r * 0.3));
  for (let dy = -span; dy <= span; dy++) {
    for (let dx = -span; dx <= span; dx++) {
      const found = bestAt(img, cx + dx, cy + dy, r * 1.6, Math.min(r * 5, rMax));
      if (!best || found.score > best.score) best = found;
    }
  }
  return best && best.score >= inner.score * 0.45 ? best : inner;
}

/** Refines a circle near its current position; same balanced score. */
export function refineIris(img: GrayImage, initial: Circle, centreSpan: number, rMin: number, rMax: number): IrisCandidate {
  let best: IrisCandidate | null = null;
  for (let dy = -centreSpan; dy <= centreSpan; dy++) {
    for (let dx = -centreSpan; dx <= centreSpan; dx++) {
      const found = bestAt(img, initial.cx + dx, initial.cy + dy, rMin, rMax);
      if (!best || found.score > best.score) best = found;
    }
  }
  return best as IrisCandidate;
}
