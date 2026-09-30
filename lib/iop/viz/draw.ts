/**
 * Vector overlays for the visualisation tiles. Coordinates are ROI pixels;
 * `scale` is the tile's display magnification, so lines stay crisp.
 */
import type { Circle, Point } from '../types';
import type { RgbaImage } from './raster';

export type Overlay = (ctx: CanvasRenderingContext2D, scale: number) => void;

/** One visualisation panel: a raster rendering plus optional vector overlay. */
export interface VizTile {
  id: string;
  title: string;
  caption: string;
  image: () => RgbaImage;
  overlay?: Overlay;
}

export function drawCircle(ctx: CanvasRenderingContext2D, scale: number, c: Circle, colour: string, width = 1.5) {
  ctx.strokeStyle = colour;
  ctx.lineWidth = width * scale;
  ctx.beginPath();
  ctx.arc(c.cx * scale, c.cy * scale, c.r * scale, 0, Math.PI * 2);
  ctx.stroke();
}

export function drawOutline(ctx: CanvasRenderingContext2D, scale: number, points: Point[], colour: string, width = 1.5, closed = true) {
  if (points.length < 2) return;
  ctx.strokeStyle = colour;
  ctx.lineWidth = width * scale;
  ctx.beginPath();
  points.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x * scale, p.y * scale) : ctx.lineTo(p.x * scale, p.y * scale)));
  if (closed) ctx.closePath();
  ctx.stroke();
}

export function drawDots(ctx: CanvasRenderingContext2D, scale: number, points: Point[], colour: string, radius = 1.2) {
  ctx.fillStyle = colour;
  for (const p of points) {
    ctx.beginPath();
    ctx.arc(p.x * scale, p.y * scale, radius * scale, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Text with a dark halo so it reads on any part of a photo. */
export function drawLabel(ctx: CanvasRenderingContext2D, scale: number, text: string, at: Point, size = 9) {
  ctx.font = `600 ${size * scale}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3 * scale;
  ctx.strokeStyle = 'rgba(2, 6, 23, 0.85)';
  ctx.strokeText(text, at.x * scale, at.y * scale);
  ctx.fillStyle = '#f8fafc';
  ctx.fillText(text, at.x * scale, at.y * scale);
}
