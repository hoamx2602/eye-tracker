/**
 * Generate random positions for numbers 1..count so they don't overlap.
 * Returns positions in percentage (0–100) of viewport width/height.
 */
export function generateNumberPositions(
  count: number,
  minSpacingPct: number = 12,
  edgePaddingPx = 0,
  viewportWidth = 0,
  viewportHeight = 0
): Array<{ number: number; x: number; y: number }> {
  const positions: Array<{ number: number; x: number; y: number }> = [];
  // Convert edgePaddingPx to a percentage margin, taking the max of the default 10% and px-derived values
  const mxFromPx = (edgePaddingPx > 0 && viewportWidth > 0) ? (edgePaddingPx / viewportWidth) * 100 : 0;
  const myFromPx = (edgePaddingPx > 0 && viewportHeight > 0) ? (edgePaddingPx / viewportHeight) * 100 : 0;
  const margin = Math.min(40, Math.max(10, mxFromPx, myFromPx)); // keep away from edges (%)

  for (let n = 1; n <= count; n++) {
    let attempts = 0;
    const maxAttempts = 200;
    while (attempts < maxAttempts) {
      const x = margin + Math.random() * (100 - 2 * margin);
      const y = margin + Math.random() * (100 - 2 * margin);
      const tooClose = positions.some(
        (p) =>
          Math.hypot(p.x - x, p.y - y) < minSpacingPct
      );
      if (!tooClose) {
        positions.push({ number: n, x, y });
        break;
      }
      attempts++;
    }
    if (positions.length !== n) {
      // fallback: place on a grid
      const cols = Math.ceil(Math.sqrt(count));
      const i = n - 1;
      const x = margin + ((i % cols) / Math.max(cols - 1, 1)) * (100 - 2 * margin);
      const y = margin + (Math.floor(i / cols) / Math.max(Math.ceil(count / cols) - 1, 1)) * (100 - 2 * margin);
      positions.push({ number: n, x, y });
    }
  }
  return positions;
}
