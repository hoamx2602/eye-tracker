import type { VizTile } from '@/lib/iop/viz/draw';
import type { RgbaImage } from '@/lib/iop/viz/raster';
import type { ReportBlock } from '@/lib/iop/viz/reportBlocks';

/**
 * Tiles are drawn so their canvas is about this wide; the browser then
 * scales it down to the card, which keeps overlay lines and text sharp.
 */
const TARGET_TILE_WIDTH = 720;

/** Magnification for an image, never below 1 (tiles are never drawn smaller than the raster). */
export function tileScale(image: { width: number }): number {
  return Math.max(1, TARGET_TILE_WIDTH / image.width);
}

function rasterCanvas(image: RgbaImage): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  context?.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  return canvas;
}

/** Draws `tile` into `ctx` at (x, y), magnified by `scale`. */
export function drawTile(ctx: CanvasRenderingContext2D, tile: VizTile, x: number, y: number, scale: number): { width: number; height: number } {
  const image = tile.image();
  ctx.save();
  ctx.translate(x, y);
  // Overlays (e.g. the fitted lid circles) may reach past the image; keep them inside it.
  ctx.beginPath();
  ctx.rect(0, 0, image.width * scale, image.height * scale);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(rasterCanvas(image), 0, 0, image.width * scale, image.height * scale);
  tile.overlay?.(ctx, scale);
  ctx.restore();
  return { width: image.width * scale, height: image.height * scale };
}

/** Renders one tile into its own canvas element. */
export function renderTile(canvas: HTMLCanvasElement, tile: VizTile) {
  const image = tile.image();
  const scale = tileScale(image);
  canvas.width = image.width * scale;
  canvas.height = image.height * scale;
  const context = canvas.getContext('2d');
  if (context) drawTile(context, tile, 0, 0, scale);
}

export function downloadCanvas(canvas: HTMLCanvasElement, filename: string) {
  const link = document.createElement('a');
  link.href = canvas.toDataURL('image/png');
  link.download = filename;
  link.click();
}

const REPORT_WIDTH = 1800;
const PAD = 28;
const FIGURE_GAP = 20;
/** One figure alone is capped at this width, so it does not fill the page. */
const SINGLE_FIGURE_WIDTH = 900;
const LINE = 26;

/**
 * Lays the notebook blocks out as one tall PNG: each block's heading, its
 * figures in a row, and its printed values. Charts are left out (they are
 * interactive SVG on the page).
 */
export function downloadReport(blocks: ReportBlock[], heading: string, filename: string) {
  const layout = blocks.map((block) => {
    const count = block.figures.length;
    const cellWidth = count === 1 ? SINGLE_FIGURE_WIDTH : (REPORT_WIDTH - 2 * PAD - FIGURE_GAP * (count - 1)) / Math.max(1, count);
    const images = block.figures.map((tile) => tile.image());
    const figureHeight = count ? Math.max(...images.map((img) => (img.height * cellWidth) / img.width)) : 0;
    const height = 44 + (count ? figureHeight + 36 : 0) + block.outputs.length * LINE + 24;
    return { block, cellWidth, figureHeight, height };
  });
  const canvas = document.createElement('canvas');
  canvas.width = REPORT_WIDTH;
  canvas.height = PAD * 2 + 50 + layout.reduce((sum, item) => sum + item.height + PAD, 0);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#f8fafc';
  ctx.font = '700 30px Inter, system-ui, sans-serif';
  ctx.fillText(heading, PAD, PAD);
  let y = PAD + 50;
  layout.forEach(({ block, cellWidth, figureHeight, height }, index) => {
    ctx.fillStyle = '#60a5fa';
    ctx.font = '600 22px ui-monospace, monospace';
    ctx.fillText(`[${index + 1}]`, PAD, y);
    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 24px Inter, system-ui, sans-serif';
    ctx.fillText(block.title, PAD + 60, y);
    let cursor = y + 44;
    block.figures.forEach((tile, k) => {
      const image = tile.image();
      const scale = cellWidth / image.width;
      const x = PAD + k * (cellWidth + FIGURE_GAP);
      drawTile(ctx, tile, x, cursor, scale);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '500 16px Inter, system-ui, sans-serif';
      const label = block.figures.length > 1 ? `${index + 1}${String.fromCharCode(97 + k)}` : `${index + 1}`;
      ctx.fillText(`Fig. ${label} · ${tile.title}`, x, cursor + figureHeight + 8);
    });
    if (block.figures.length) cursor += figureHeight + 36;
    ctx.font = '500 18px ui-monospace, monospace';
    block.outputs.forEach((line, k) => {
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(`${line.label}:`, PAD, cursor + k * LINE);
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(line.value, PAD + ctx.measureText(`${line.label}: `).width, cursor + k * LINE);
    });
    y += height + PAD;
  });
  downloadCanvas(canvas, filename);
}
