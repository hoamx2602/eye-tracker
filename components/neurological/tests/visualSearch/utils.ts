/**
 * Generate positions for numbers 1..count so they don't overlap and, just as
 * importantly, don't cluster.
 *
 * Pure rejection sampling (throw a random point, retry if too close to an
 * existing one) was the original approach here, and it does stop numbers
 * landing on top of each other — but nothing about it stops five numbers
 * landing in one corner while the rest of the screen sits empty, which is
 * exactly what a participant would see on an unlucky draw. A visual search
 * task that "searches" a quarter of the screen measures something different
 * from one that searches all of it.
 *
 * This uses stratified (jittered-grid) sampling instead: the area is divided
 * into at least `count` roughly equal cells, `count` of them are chosen at
 * random, and each number is placed at a random point inside its own cell.
 * That guarantees spread across the whole area — including the corners —
 * while the jitter inside each cell keeps individual placements looking
 * organic rather than snapped to a visible grid. It's the standard technique
 * for exactly this problem in visual-search paradigms generally.
 */
export function generateNumberPositions(
  count: number,
  minSpacingPct: number = 12,
  edgePaddingPx = 0,
  viewportWidth = 0,
  viewportHeight = 0
): Array<{ number: number; x: number; y: number }> {
  if (count <= 0) return [];

  // How close the outermost numbers can sit to the true edge of the screen.
  // Only needs to clear half the target's own size (56px → 28px radius) plus
  // a little breathing room, not the generous margin a purely random layout
  // needed to keep points away from each other near a corner. This is a
  // floor, not where the outer points typically land — see edgeInset below
  // for why they sit much closer to it than the interior spacing would
  // suggest.
  const mxFromPx = edgePaddingPx > 0 && viewportWidth > 0 ? (edgePaddingPx / viewportWidth) * 100 : 0;
  const myFromPx = edgePaddingPx > 0 && viewportHeight > 0 ? (edgePaddingPx / viewportHeight) * 100 : 0;
  const margin = Math.min(25, Math.max(3, mxFromPx, myFromPx));
  const span = 100 - 2 * margin;

  // Aim for a grid at least as fine as the number of targets, biased to the
  // screen's own aspect ratio so cells are roughly square in real pixels
  // rather than in percent (a 16:9 viewport turned into a square percent
  // grid would make "cells" visually wide and short).
  const aspect = viewportWidth > 0 && viewportHeight > 0 ? viewportWidth / viewportHeight : 16 / 9;
  let cols = Math.max(1, Math.round(Math.sqrt(count * aspect)));
  let rows = Math.max(1, Math.ceil(count / cols));
  while (cols * rows < count) {
    // Widen before heightening — matches the bias above.
    if (cols <= rows * aspect) cols++;
    else rows++;
  }

  const cellIndices = Array.from({ length: cols * rows }, (_, i) => i);
  // Fisher–Yates: which `count` of the cols*rows cells get a number, and in
  // what order — both need to be random, not just the jitter inside each one.
  for (let i = cellIndices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cellIndices[i], cellIndices[j]] = [cellIndices[j], cellIndices[i]];
  }
  const chosenCells = cellIndices.slice(0, count);

  const cellW = span / cols;
  const cellH = span / rows;
  // Inset from each of a cell's four sides, as a fraction of that cell's own
  // width/height. INNER keeps jitter from ever pushing a point flush against
  // a neighbouring cell. EDGE is much smaller and only applies to the sides
  // of a cell that face the true screen edge (col 0's left side, the last
  // column's right side, and the same for top/bottom row) — that's what lets
  // the outermost numbers actually reach near the edge margin computed
  // above, rather than sitting a full interior gap short of it the way a
  // uniform inset would.
  const INNER_INSET = 0.16;
  const EDGE_INSET = 0.04;

  const positions: Array<{ number: number; x: number; y: number }> = [];
  for (let n = 1; n <= count; n++) {
    const cell = chosenCells[n - 1];
    const col = cell % cols;
    const row = Math.floor(cell / cols);
    const cellX0 = margin + col * cellW;
    const cellY0 = margin + row * cellH;

    const insetLeft = col === 0 ? EDGE_INSET : INNER_INSET;
    const insetRight = col === cols - 1 ? EDGE_INSET : INNER_INSET;
    const insetTop = row === 0 ? EDGE_INSET : INNER_INSET;
    const insetBottom = row === rows - 1 ? EDGE_INSET : INNER_INSET;

    let x = 0;
    let y = 0;
    let attempts = 0;
    const maxAttempts = 30;
    do {
      x = cellX0 + (insetLeft + Math.random() * (1 - insetLeft - insetRight)) * cellW;
      y = cellY0 + (insetTop + Math.random() * (1 - insetTop - insetBottom)) * cellH;
      attempts++;
    } while (
      attempts < maxAttempts &&
      positions.some((p) => Math.hypot(p.x - x, p.y - y) < minSpacingPct)
    );
    positions.push({ number: n, x, y });
  }
  return positions;
}
