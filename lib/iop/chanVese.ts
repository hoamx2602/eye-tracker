/**
 * Chan-Vese active contour ("active contour without edges"), the model behind
 * MATLAB's activecontour(A, mask) default that the paper uses for its sclera
 * contour features.
 *
 * Level set phi > 0 is the foreground. Each step moves phi towards whichever
 * region mean (c1 inside, c2 outside) the pixel is closer to, only near the
 * contour (regularised delta), then smooths phi with a small Gaussian - a
 * cheap stand-in for the curvature term that keeps the contour from fraying.
 */
import { gaussianBlur } from './imageOps';
import type { GrayImage } from './types';

/**
 * Intensities are 0..1, so the squared-difference force is ~0.01-0.1; this
 * gain brings a step to ~0.1 phi units, letting the contour settle within the
 * default iteration budget.
 */
const FORCE_GAIN = 20;

export interface ChanVeseOptions {
  iterations?: number;
  /** Time step. */
  dt?: number;
  /** Width of the regularised Heaviside/delta, in phi units. */
  epsilon?: number;
  /** Gaussian sigma applied to phi each iteration (smoothness). */
  smoothSigma?: number;
}

/**
 * @param img Grayscale image, 0..255.
 * @param init Initial foreground mask (1 = inside).
 * @param domain Pixels allowed to take part; outside it phi is pinned negative.
 * @returns Final foreground mask.
 */
export function chanVese(img: GrayImage, init: Uint8Array, domain: Uint8Array, opts: ChanVeseOptions = {}): Uint8Array {
  const { iterations = 150, dt = 0.5, epsilon = 1.5, smoothSigma = 1 } = opts;
  const { width: w, height: h } = img;
  const n = w * h;
  const intensity = img.data.map((v) => v / 255);
  let phi: Float32Array = new Float32Array(n);
  for (let i = 0; i < n; i++) phi[i] = domain[i] ? (init[i] ? 2 : -2) : -2;

  for (let it = 0; it < iterations; it++) {
    const { inside, outside } = regionMeans(intensity, phi, domain);
    for (let i = 0; i < n; i++) {
      if (!domain[i]) continue;
      const delta = epsilon / (Math.PI * (epsilon * epsilon + phi[i] * phi[i]));
      const force = (intensity[i] - outside) ** 2 - (intensity[i] - inside) ** 2;
      phi[i] = Math.max(-3, Math.min(3, phi[i] + dt * delta * force * FORCE_GAIN));
    }
    phi = gaussianBlur({ width: w, height: h, data: phi }, smoothSigma).data;
    for (let i = 0; i < n; i++) if (!domain[i]) phi[i] = -2;
  }

  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = domain[i] && phi[i] > 0 ? 1 : 0;
  return mask;
}

function regionMeans(intensity: Float32Array, phi: Float32Array, domain: Uint8Array): { inside: number; outside: number } {
  let sumIn = 0;
  let countIn = 0;
  let sumOut = 0;
  let countOut = 0;
  for (let i = 0; i < intensity.length; i++) {
    if (!domain[i]) continue;
    if (phi[i] > 0) { sumIn += intensity[i]; countIn++; } else { sumOut += intensity[i]; countOut++; }
  }
  return { inside: countIn ? sumIn / countIn : 0, outside: countOut ? sumOut / countOut : 0 };
}
