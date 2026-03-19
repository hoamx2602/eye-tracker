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

export const VALIDATION_POINTS: CalibrationPoint[] = [
  { id: 1001, x: 25, y: 25, completed: false },
  { id: 1002, x: 75, y: 75, completed: false },
  { id: 1003, x: 25, y: 75, completed: false },
  { id: 1004, x: 75, y: 25, completed: false },
  { id: 1005, x: 50, y: 50, completed: false },
];

export const generateCalibrationPoints = (count: number): CalibrationPoint[] => {
  const points: CalibrationPoint[] = [];
  let rows = Math.round(Math.sqrt(count));
  let cols = Math.ceil(count / rows);
  while (rows * cols < count) cols++;

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
