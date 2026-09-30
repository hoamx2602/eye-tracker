/**
 * Eyelid model of the paper (Fig. 6): each lid is an arc of a circle. Fits
 * those circles robustly to noisy edge points and turns them into an outline
 * whose ends are the eye corners, where the two lid circles meet.
 */
import type { Circle, Point } from './types';

const MIN_INLIERS = 8;
const RANSAC_ITERATIONS = 300;

/** Kasa algebraic fit: minimises sum (x^2 + y^2 + Dx + Ey + F)^2. */
function kasa(points: Point[]): Circle | null {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sz = 0, sxz = 0, syz = 0;
  for (const { x, y } of points) {
    const z = x * x + y * y;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sz += z; sxz += x * z; syz += y * z;
  }
  const m = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, points.length]];
  const v = [-sxz, -syz, -sz];
  const det = (a: number[][]) =>
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const d = det(m);
  if (Math.abs(d) < 1e-9) return null;
  const solve = (col: number) => det(m.map((row, i) => row.map((value, j) => (j === col ? v[i] : value)))) / d;
  const [D, E, F] = [solve(0), solve(1), solve(2)];
  const cx = -D / 2;
  const cy = -E / 2;
  const r2 = cx * cx + cy * cy - F;
  return r2 > 0 ? { cx, cy, r: Math.sqrt(r2) } : null;
}

/** Small deterministic PRNG so a given photo always gives the same outline. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const residual = (c: Circle, p: Point) => Math.abs(Math.hypot(p.x - c.cx, p.y - c.cy) - c.r);

function acceptable(circle: Circle | null, opts: LidFitOptions, sampleY: number): circle is Circle {
  return (
    !!circle &&
    circle.r >= opts.rMin &&
    circle.r <= opts.rMax &&
    (circle.cy > sampleY) === opts.centreBelow &&
    Math.abs(circle.cx - opts.centreX) <= opts.maxCentreOffset
  );
}

export interface LidFitOptions {
  /** true for the upper lid: its circle's centre lies below the lid. */
  centreBelow: boolean;
  rMin: number;
  rMax: number;
  /** Inlier distance, px. */
  tolerance: number;
  /** The lid's apex sits near the iris: the circle centre may be at most this far from `centreX` horizontally. */
  centreX: number;
  maxCentreOffset: number;
}

/**
 * RANSAC circle fit: the circle through three sampled points that most edge
 * points agree with, refined by least squares on its inliers. Lashes, vessels
 * and skin beyond the corners become outliers.
 */
export function fitLidCircle(points: Point[], opts: LidFitOptions): { circle: Circle; inliers: Point[] } | null {
  if (points.length < MIN_INLIERS) return null;
  const random = rng(points.length * 7919);
  let best: Point[] = [];
  let bestCircle: Circle | null = null;
  for (let it = 0; it < RANSAC_ITERATIONS; it++) {
    const sample = [0, 1, 2].map(() => points[Math.floor(random() * points.length)]);
    const circle = kasa(sample);
    if (!acceptable(circle, opts, (sample[0].y + sample[1].y + sample[2].y) / 3)) continue;
    const inliers = points.filter((p) => Math.abs(Math.hypot(p.x - circle.cx, p.y - circle.cy) - circle.r) <= opts.tolerance);
    if (inliers.length > best.length) { best = inliers; bestCircle = circle; }
  }
  if (!bestCircle || best.length < MIN_INLIERS) return null;
  // Least-squares refinement on the inliers, kept only if it still obeys the
  // same radius and orientation limits as the samples did.
  const refined = kasa(best);
  const meanY = best.reduce((sum, p) => sum + p.y, 0) / best.length;
  return { circle: acceptable(refined, opts, meanY) ? refined : bestCircle, inliers: best };
}

/**
 * Fits the lid near the iris first, where edge points are most reliable,
 * then extends it outward point by point on each side while the points stay
 * on the curve. A run of `stopAfter` misses ends a side: past the eye corner
 * the "edges" are skin or brow, and they are never admitted.
 * @param seedReach How far from the iris centre (`opts.centreX`) the seed points go.
 */
export function fitLidGrowing(
  points: Point[],
  seedReach: number,
  opts: LidFitOptions & { stopAfter: number },
): { circle: Circle; inliers: Point[] } | null {
  const { centreX } = opts;
  const near = points.filter((p) => Math.abs(p.x - centreX) <= seedReach);
  const seed = fitLidCircle(near.length >= MIN_INLIERS ? near : points, opts);
  if (!seed) return null;
  let circle = seed.circle;
  const accepted = [...seed.inliers];
  const meanY = () => accepted.reduce((sum, p) => sum + p.y, 0) / accepted.length;
  for (const side of [-1, 1]) {
    const far = points
      .filter((p) => side * (p.x - centreX) > seedReach)
      .sort((a, b) => Math.abs(a.x - centreX) - Math.abs(b.x - centreX));
    let misses = 0;
    for (const p of far) {
      if (residual(circle, p) > opts.tolerance) {
        if (++misses >= opts.stopAfter) break;
        continue;
      }
      misses = 0;
      accepted.push(p);
      const refit = kasa(accepted);
      if (acceptable(refit, opts, meanY())) circle = refit;
    }
  }
  return { circle, inliers: accepted };
}

/** y on `circle` at `x`, on its upper (-1) or lower (+1) half. */
export function arcY(circle: Circle, x: number, half: 1 | -1): number {
  const dx = Math.min(Math.abs(x - circle.cx), circle.r);
  return circle.cy + half * Math.sqrt(circle.r * circle.r - dx * dx);
}

/** Height of the eye opening at `x`: lower lid minus upper lid (negative where they cross). */
function openingAt(upper: Circle, lower: Circle, x: number): number {
  // The upper lid's circle has its centre below the lid, so the lid is the
  // circle's top half (-1); the lower lid is its circle's bottom half (+1).
  return arcY(lower, x, 1) - arcY(upper, x, -1);
}

/** Where the two lid arcs meet, scanning `from`..`to` in 1 px steps. */
function arcCrossings(upper: Circle, lower: Circle, from: number, to: number): number[] {
  const crossings: number[] = [];
  let previous = openingAt(upper, lower, from);
  for (let x = from + 1; x <= to; x++) {
    const current = openingAt(upper, lower, x);
    if ((previous > 0) !== (current > 0)) crossings.push(x);
    previous = current;
  }
  return crossings;
}

/**
 * Closed outline between the eye corners, taken as the lid crossings nearest
 * the iris on either side (or the ends of `span` if the arcs do not meet).
 * @param span Horizontal range to look for the corners in; its middle must be inside the eye.
 */
export function lidOutline(upper: Circle, lower: Circle, span: [number, number], samples = 32): Point[] | null {
  const middle = (span[0] + span[1]) / 2;
  if (openingAt(upper, lower, middle) <= 0) return null;
  const crossings = arcCrossings(upper, lower, span[0], span[1]);
  const left = Math.max(span[0], ...crossings.filter((x) => x < middle));
  const right = Math.min(span[1], ...crossings.filter((x) => x > middle));
  const top: Point[] = [];
  const bottom: Point[] = [];
  for (let k = 0; k <= samples; k++) {
    const x = left + ((right - left) * k) / samples;
    top.push({ x, y: arcY(upper, x, -1) });
    bottom.push({ x, y: arcY(lower, x, 1) });
  }
  return [...top, ...bottom.reverse()];
}
