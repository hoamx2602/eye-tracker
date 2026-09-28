/**
 * Builds EyeGeometry either from MediaPipe Face Landmarker output or from six
 * points a researcher clicks on an eye close-up (where no face is detectable).
 */
import type { Circle, EyeGeometry, EyeSide, Point } from './types';

/** MediaPipe face-mesh eye outlines, upper lid then lower lid, subject's right then left. */
const EYE_OUTLINES: Record<EyeSide, number[]> = {
  right: [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7],
  left: [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249],
};

/** Iris centre followed by its four boundary points. */
const IRIS_SETS = [
  [468, 469, 470, 471, 472],
  [473, 474, 475, 476, 477],
];

interface NormalizedPoint {
  x: number;
  y: number;
}

function insidePolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < a.x + ((p.y - a.y) / (b.y - a.y)) * (b.x - a.x)) inside = !inside;
  }
  return inside;
}

/**
 * Converts one face's 478 normalised landmarks into two eye geometries.
 * The iris set is assigned to whichever outline contains its centre, so this
 * does not depend on MediaPipe's left/right naming.
 */
export function geometryFromLandmarks(landmarks: NormalizedPoint[], width: number, height: number): EyeGeometry[] {
  if (landmarks.length < 478) return [];
  const toPx = (i: number): Point => ({ x: landmarks[i].x * width, y: landmarks[i].y * height });
  const irises: Circle[] = IRIS_SETS.map(([centre, ...edge]) => {
    const c = toPx(centre);
    const r = edge.reduce((sum, i) => sum + Math.hypot(toPx(i).x - c.x, toPx(i).y - c.y), 0) / edge.length;
    return { cx: c.x, cy: c.y, r };
  });
  const result: EyeGeometry[] = [];
  for (const side of ['right', 'left'] as EyeSide[]) {
    const eyelid = EYE_OUTLINES[side].map(toPx);
    const iris = irises.find((c) => insidePolygon({ x: c.cx, y: c.cy }, eyelid));
    if (iris) result.push({ side, iris, eyelid, source: 'mediapipe' });
  }
  return result;
}

/** Points a researcher clicks, in this order, on an eye image. */
export interface ManualEyePoints {
  irisCentre: Point;
  irisEdge: Point;
  cornerA: Point;
  cornerB: Point;
  upperLid: Point;
  lowerLid: Point;
}

export const MANUAL_POINT_ORDER: { key: keyof ManualEyePoints; label: string }[] = [
  { key: 'irisCentre', label: 'Iris centre' },
  { key: 'irisEdge', label: 'Iris edge (left or right side)' },
  { key: 'cornerA', label: 'Eye corner (one side)' },
  { key: 'cornerB', label: 'Eye corner (other side)' },
  { key: 'upperLid', label: 'Upper lid, highest point' },
  { key: 'lowerLid', label: 'Lower lid, lowest point' },
];

/** Circle through three points, or null when they are (nearly) collinear. */
function circleThrough(a: Point, b: Point, c: Point): Circle | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-6) return null;
  const sq = (p: Point) => p.x * p.x + p.y * p.y;
  const cx = (sq(a) * (b.y - c.y) + sq(b) * (c.y - a.y) + sq(c) * (a.y - b.y)) / d;
  const cy = (sq(a) * (c.x - b.x) + sq(b) * (a.x - c.x) + sq(c) * (b.x - a.x)) / d;
  return { cx, cy, r: Math.hypot(a.x - cx, a.y - cy) };
}

/** Samples the arc of the circle through from -> via -> to (the side containing `via`). */
function arc(from: Point, via: Point, to: Point, samples: number): Point[] {
  const circle = circleThrough(from, via, to);
  if (!circle) return Array.from({ length: samples + 1 }, (_, k) => lerp(from, to, k / samples));
  const angle = (p: Point) => Math.atan2(p.y - circle.cy, p.x - circle.cx);
  const a0 = angle(from);
  let sweep = angle(to) - a0;
  let viaSweep = angle(via) - a0;
  const wrap = (t: number) => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  sweep = wrap(sweep);
  viaSweep = wrap(viaSweep);
  if (viaSweep > sweep) sweep -= 2 * Math.PI;
  return Array.from({ length: samples + 1 }, (_, k) => {
    const t = a0 + (sweep * k) / samples;
    return { x: circle.cx + circle.r * Math.cos(t), y: circle.cy + circle.r * Math.sin(t) };
  });
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * The paper models each eyelid as a circle (Fig. 6); with three clicked
 * points per lid (two corners plus the lid's extreme) that circle is exact.
 */
export function geometryFromManualPoints(points: ManualEyePoints, side: EyeSide): EyeGeometry {
  const { irisCentre, irisEdge, cornerA, cornerB, upperLid, lowerLid } = points;
  const [left, right] = cornerA.x <= cornerB.x ? [cornerA, cornerB] : [cornerB, cornerA];
  const upper = arc(left, upperLid, right, 24);
  const lower = arc(right, lowerLid, left, 24).slice(1, -1);
  return {
    side,
    iris: { cx: irisCentre.x, cy: irisCentre.y, r: Math.hypot(irisEdge.x - irisCentre.x, irisEdge.y - irisCentre.y) },
    eyelid: [...upper, ...lower],
    source: 'manual',
  };
}
