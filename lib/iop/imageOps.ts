/**
 * Small image primitives for the IOP pipeline. Pure TypeScript, no canvas, so
 * they run unchanged in Node tests.
 */
import type { GrayImage, Point, RgbImage } from './types';

/**
 * Crops `[x0, x0 + w/scale) x [y0, y0 + h/scale)` of `src` into a `w x h` image.
 * Downscaling averages every source pixel under the destination footprint
 * (no aliasing of thin vessels); upscaling is bilinear.
 */
export function cropResample(src: RgbImage, x0: number, y0: number, scale: number, w: number, h: number): RgbImage {
  const out = new Uint8ClampedArray(w * h * 3);
  const step = 1 / scale;
  const acc = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3;
      if (step > 1) {
        boxAverage(src, x0 + x * step, y0 + y * step, step, acc);
      } else {
        bilinear(src, x0 + (x + 0.5) * step - 0.5, y0 + (y + 0.5) * step - 0.5, acc);
      }
      out[o] = acc[0];
      out[o + 1] = acc[1];
      out[o + 2] = acc[2];
    }
  }
  return { width: w, height: h, data: out };
}

function boxAverage(src: RgbImage, sx: number, sy: number, step: number, acc: number[]): void {
  const xa = Math.max(0, Math.floor(sx));
  const ya = Math.max(0, Math.floor(sy));
  const xb = Math.min(src.width, Math.ceil(sx + step));
  const yb = Math.min(src.height, Math.ceil(sy + step));
  acc[0] = acc[1] = acc[2] = 0;
  let n = 0;
  for (let y = ya; y < yb; y++) {
    for (let x = xa; x < xb; x++) {
      const i = (y * src.width + x) * 3;
      acc[0] += src.data[i];
      acc[1] += src.data[i + 1];
      acc[2] += src.data[i + 2];
      n++;
    }
  }
  if (n > 0) for (let c = 0; c < 3; c++) acc[c] /= n;
}

function bilinear(src: RgbImage, fx: number, fy: number, acc: number[]): void {
  const x = Math.min(Math.max(fx, 0), src.width - 1);
  const y = Math.min(Math.max(fy, 0), src.height - 1);
  const xa = Math.floor(x);
  const ya = Math.floor(y);
  const xb = Math.min(xa + 1, src.width - 1);
  const yb = Math.min(ya + 1, src.height - 1);
  const tx = x - xa;
  const ty = y - ya;
  for (let c = 0; c < 3; c++) {
    const p = (yy: number, xx: number) => src.data[(yy * src.width + xx) * 3 + c];
    const top = p(ya, xa) * (1 - tx) + p(ya, xb) * tx;
    const bottom = p(yb, xa) * (1 - tx) + p(yb, xb) * tx;
    acc[c] = top * (1 - ty) + bottom * ty;
  }
}

/** One channel (0 = R, 1 = G, 2 = B) as floats. */
export function channel(img: RgbImage, c: 0 | 1 | 2): GrayImage {
  const data = new Float32Array(img.width * img.height);
  for (let i = 0; i < data.length; i++) data[i] = img.data[i * 3 + c];
  return { width: img.width, height: img.height, data };
}

/** ITU-R BT.601 luma, the weights MATLAB's rgb2gray uses. */
export function toGray(img: RgbImage): GrayImage {
  const data = new Float32Array(img.width * img.height);
  for (let i = 0; i < data.length; i++) {
    data[i] = 0.2989 * img.data[i * 3] + 0.587 * img.data[i * 3 + 1] + 0.114 * img.data[i * 3 + 2];
  }
  return { width: img.width, height: img.height, data };
}

/** Separable Gaussian blur with edge clamping. */
export function gaussianBlur(img: GrayImage, sigma: number): GrayImage {
  if (sigma <= 0) return img;
  const radius = Math.ceil(sigma * 3);
  const kernel = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let k = -radius; k <= radius; k++) sum += kernel[k + radius] = Math.exp(-(k * k) / (2 * sigma * sigma));
  for (let k = 0; k < kernel.length; k++) kernel[k] /= sum;
  const { width: w, height: h } = img;
  const pass = (input: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = 0;
        for (let k = -radius; k <= radius; k++) {
          const xx = horizontal ? Math.min(Math.max(x + k, 0), w - 1) : x;
          const yy = horizontal ? y : Math.min(Math.max(y + k, 0), h - 1);
          v += input[yy * w + xx] * kernel[k + radius];
        }
        out[y * w + x] = v;
      }
    }
    return out;
  };
  return { width: w, height: h, data: pass(pass(img.data, true), false) };
}

/** Bilinear sample of a gray image; outside samples clamp to the edge. */
export function sampleGray(img: GrayImage, fx: number, fy: number): number {
  const x = Math.min(Math.max(fx, 0), img.width - 1);
  const y = Math.min(Math.max(fy, 0), img.height - 1);
  const xa = Math.floor(x);
  const ya = Math.floor(y);
  const xb = Math.min(xa + 1, img.width - 1);
  const yb = Math.min(ya + 1, img.height - 1);
  const tx = x - xa;
  const ty = y - ya;
  const d = img.data;
  const w = img.width;
  return (d[ya * w + xa] * (1 - tx) + d[ya * w + xb] * tx) * (1 - ty) + (d[yb * w + xa] * (1 - tx) + d[yb * w + xb] * tx) * ty;
}

/** Rasterises a closed polygon (even-odd rule, pixel centres). */
export function polygonMask(polygon: Point[], w: number, h: number): Uint8Array {
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const cy = y + 0.5;
    const xs: number[] = [];
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i];
      const b = polygon[j];
      if ((a.y > cy) !== (b.y > cy)) xs.push(a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5));
      const to = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = from; x <= to; x++) mask[y * w + x] = 1;
    }
  }
  return mask;
}

/** Binary erosion with a (2r+1)^2 square. */
export function erode(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let keep = 1;
      for (let dy = -r; dy <= r && keep; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h || !mask[yy * w + xx]) { keep = 0; break; }
        }
      }
      out[y * w + x] = keep;
    }
  }
  return out;
}

/** Keeps only the largest 4-connected component of a binary mask. */
export function largestComponent(mask: Uint8Array, w: number, h: number): Uint8Array {
  const label = new Int32Array(w * h);
  const stack: number[] = [];
  let best = 0;
  let bestSize = 0;
  let next = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || label[start]) continue;
    next++;
    let size = 0;
    stack.push(start);
    label[start] = next;
    while (stack.length) {
      const p = stack.pop() as number;
      size++;
      const x = p % w;
      const neighbours = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w];
      for (const q of neighbours) {
        if (q < 0 || q >= mask.length || !mask[q] || label[q]) continue;
        label[q] = next;
        stack.push(q);
      }
    }
    if (size > bestSize) { bestSize = size; best = next; }
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = label[i] === best && best > 0 ? 1 : 0;
  return out;
}
