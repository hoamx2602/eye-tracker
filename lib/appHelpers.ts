import type { CalibrationPoint } from '@/types';

const EDGE_PAD = 4;

export interface GazeRecord {
  timestamp: number;
  x: number;
  y: number;
}

export interface CapturedImage {
  url: string;
  timestamp: string;
}

/**
 * Held-out validation dots: corners, edge midpoints and center of the same
 * 12–88% field the exercises cover. The old set (four dots at 25/75% plus the
 * center) only probed the easy middle of the screen, where every mapping does
 * well; edge and corner error is what limits the tests and it went unmeasured.
 * Presented in random order (see lib/fixationSampling.shuffled).
 */
export const VALIDATION_POINTS: CalibrationPoint[] = [
  { id: 1001, x: 12, y: 12, completed: false },
  { id: 1002, x: 50, y: 12, completed: false },
  { id: 1003, x: 88, y: 12, completed: false },
  { id: 1004, x: 12, y: 50, completed: false },
  { id: 1005, x: 50, y: 50, completed: false },
  { id: 1006, x: 88, y: 50, completed: false },
  { id: 1007, x: 12, y: 88, completed: false },
  { id: 1008, x: 50, y: 88, completed: false },
  { id: 1009, x: 88, y: 88, completed: false },
];

/**
 * Effective calibration point count.
 *
 * Prescription glasses introduce a *systematic* (not random) shift of the apparent
 * pupil position that varies with gaze angle — see docs/EXPERT_ACCURACY_ASSESSMENT.md §2.
 * A denser grid lets the per-subject regression absorb that lens distortion across the
 * whole field, so glasses wearers get at least a 4×4 (16-point) grid. Non-glasses runs
 * keep the configured count unchanged.
 */
export const GLASSES_MIN_CALIBRATION_POINTS = 16;
export const effectiveCalibrationPointCount = (
  configuredCount: number,
  wearsGlasses: boolean,
): number =>
  wearsGlasses ? Math.max(configuredCount, GLASSES_MIN_CALIBRATION_POINTS) : configuredCount;

/**
 * Quick-mode calibration grid size (NEXT_PUBLIC_NEURO_QUICK_MODE). This is the
 * backend's minimum for a degree-2 mapping fit (backend/app/calibration.py
 * _MIN_DOTS = 6) plus the validation dots for the offline accuracy A/B — the
 * smallest run that still lets the offline reprocess both fit AND validate.
 * Trades accuracy for speed; smoke-testing the pipeline only, never a real run.
 */
export const QUICK_CALIBRATION_POINTS = 6;

/**
 * Rows and columns for a dot count.
 *
 * Prefers a factorisation that uses every dot, so the grid stays a full
 * rectangle with all four corners: the corner dots are what pin the mapping at
 * the edges, and dropping the outer ring costs ~80 px of validation error
 * (measured over the stored sessions). A plain round(sqrt(n)) leaves holes —
 * 24 dots became a 5×5 grid missing its bottom-right corner.
 *
 * Among exact factorisations it takes the one closest to `targetAspect`, so the
 * angular spacing between dots is about the same horizontally and vertically on
 * a typical laptop screen. Counts with no usable factorisation (primes) fall
 * back to the old near-square raster and lose the last few positions.
 */
export function calibrationGridShape(count: number, targetAspect = 1.5): { rows: number; cols: number } {
  let best: { rows: number; cols: number } | null = null;
  for (let rows = 2; rows <= count / 2; rows++) {
    if (count % rows !== 0) continue;
    const cols = count / rows;
    if (cols < 2) continue;
    if (!best || Math.abs(cols / rows - targetAspect) < Math.abs(best.cols / best.rows - targetAspect)) {
      best = { rows, cols };
    }
  }
  if (best) return best;
  const rows = Math.max(1, Math.round(Math.sqrt(count)));
  return { rows, cols: Math.ceil(count / rows) };
}

export const generateCalibrationPoints = (count: number): CalibrationPoint[] => {
  const points: CalibrationPoint[] = [];
  const { rows, cols } = calibrationGridShape(count);

  const xStep = (100 - 2 * EDGE_PAD) / (cols - 1 || 1);
  const yStep = (100 - 2 * EDGE_PAD) / (rows - 1 || 1);

  let generatedCount = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (generatedCount >= count) break;
      points.push({
        id: generatedCount + 1,
        x: EDGE_PAD + (c * xStep),
        y: EDGE_PAD + (r * yStep),
        completed: false,
      });
      generatedCount++;
    }
  }
  return points;
};

export function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
