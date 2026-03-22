/**
 * Một số pipeline lưu gaze gần (0,0) hoặc [0,1] — map sang pixel viewport để vẽ đúng.
 */
export type GazeCoordMode = 'pixels' | 'normalized01' | 'percent100';

export function detectAndMapGazeToViewport<T extends { x: number; y: number }>(
  pts: T[],
  vw: number,
  vh: number
): { pts: T[]; mode: GazeCoordMode } {
  if (pts.length === 0 || vw < 50 || vh < 50) {
    return { pts, mode: 'pixels' };
  }
  let maxX = -Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let minY = Infinity;
  for (const p of pts) {
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
  }

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  /**
   * Toàn bộ mẫu ≈ (0,0) — không phải chuẩn hoá [0,1] hợp lệ mà là giá trị mặc định khi pipeline chưa có tọa độ gaze (vd. regressor chưa train).
   */
  const allPlaceholderZeros =
    spanX <= 1e-9 &&
    spanY <= 1e-9 &&
    maxX <= 1e-6 &&
    maxY <= 1e-6 &&
    minX >= -1e-6 &&
    minY >= -1e-6;
  if (allPlaceholderZeros) {
    return { pts, mode: 'pixels' };
  }

  const inUnitSquare = maxX <= 1.0001 && maxY <= 1.0001 && minX >= -0.0001 && minY >= -0.0001;
  if (inUnitSquare) {
    return {
      pts: pts.map((p) => ({ ...p, x: p.x * vw, y: p.y * vh })),
      mode: 'normalized01',
    };
  }

  const maybePercent =
    maxX <= 100.1 &&
    maxY <= 100.1 &&
    minX >= 0 &&
    minY >= 0 &&
    maxX > 1.5 &&
    maxY > 1.5;
  if (maybePercent) {
    return {
      pts: pts.map((p) => ({ ...p, x: (p.x / 100) * vw, y: (p.y / 100) * vh })),
      mode: 'percent100',
    };
  }

  return { pts, mode: 'pixels' };
}

export function applyGazeModeToFixations(
  fixations: Array<{ number: number; timestamp: number; gazeX: number; gazeY: number }>,
  mode: GazeCoordMode,
  vw: number,
  vh: number
): Array<{ number: number; timestamp: number; gazeX: number; gazeY: number }> {
  if (mode === 'pixels') return fixations;
  if (mode === 'normalized01') {
    return fixations.map((f) => ({ ...f, gazeX: f.gazeX * vw, gazeY: f.gazeY * vh }));
  }
  return fixations.map((f) => ({
    ...f,
    gazeX: (f.gazeX / 100) * vw,
    gazeY: (f.gazeY / 100) * vh,
  }));
}
