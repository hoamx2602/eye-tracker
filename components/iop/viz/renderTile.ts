import type { VizTile } from '@/lib/iop/viz/draw';
import type { RgbaImage } from '@/lib/iop/viz/raster';

/** Display magnification: tiles are drawn at 2x so overlay lines stay sharp. */
export const TILE_SCALE = 2;

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
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(rasterCanvas(image), 0, 0, image.width * scale, image.height * scale);
  tile.overlay?.(ctx, scale);
  ctx.restore();
  return { width: image.width * scale, height: image.height * scale };
}

/** Renders one tile into its own canvas element. */
export function renderTile(canvas: HTMLCanvasElement, tile: VizTile, scale = TILE_SCALE) {
  const image = tile.image();
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

const FIGURE_PADDING = 24;
const TITLE_HEIGHT = 30;

/**
 * Lays the tiles out as one paper-style figure - panels (a), (b), ... with
 * their titles - and downloads it as PNG.
 */
export function downloadFigure(tiles: VizTile[], heading: string, filename: string, columns = 4) {
  const sizes = tiles.map((tile) => tile.image());
  const cellWidth = Math.max(...sizes.map((s) => s.width)) * TILE_SCALE;
  const cellHeight = Math.max(...sizes.map((s) => s.height)) * TILE_SCALE + TITLE_HEIGHT;
  const rows = Math.ceil(tiles.length / columns);
  const canvas = document.createElement('canvas');
  canvas.width = FIGURE_PADDING * (columns + 1) + cellWidth * columns;
  canvas.height = FIGURE_PADDING * (rows + 2) + cellHeight * rows + TITLE_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#f8fafc';
  ctx.font = '700 22px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(heading, FIGURE_PADDING, FIGURE_PADDING);
  tiles.forEach((tile, k) => {
    const x = FIGURE_PADDING + (k % columns) * (cellWidth + FIGURE_PADDING);
    const y = FIGURE_PADDING * 2 + TITLE_HEIGHT + Math.floor(k / columns) * (cellHeight + FIGURE_PADDING);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '600 16px Inter, system-ui, sans-serif';
    ctx.fillText(`(${String.fromCharCode(97 + k)}) ${tile.title}`, x, y);
    drawTile(ctx, tile, x, y + TITLE_HEIGHT, TILE_SCALE);
  });
  downloadCanvas(canvas, filename);
}
