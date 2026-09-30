/**
 * Numbers behind the measurement charts: where the RAP threshold cuts the
 * sclera's colour distribution, how the circle search saw the pupil and iris
 * edges, and the paper's per-class feature distributions.
 */
import { removeHighlights } from '../circleSearch';
import { RED_DOMINANCE } from '../features';
import { channel, gaussianBlur, sampleGray } from '../imageOps';
import type { EyeAnalysis } from '../types';

export interface LeadBin {
  /** Bin centre: how far red leads the stronger of green and blue, (R - max(G, B)) / R. */
  lead: number;
  pixels: number;
  /** Share of all sclera pixels in this bin. */
  share: number;
  countsAsRed: boolean;
}

/**
 * Histogram of red's lead over the sclera. The RAP rule counts a pixel when
 * the lead exceeds RED_DOMINANCE (and G, B are close), so RAP is roughly the
 * share of pixels to the right of that line.
 */
export function redLeadHistogram(eye: EyeAnalysis, bins = 30, from = -0.1, to = 0.5): LeadBin[] {
  const counts = new Array<number>(bins).fill(0);
  const width = (to - from) / bins;
  let total = 0;
  const { data } = eye.roi;
  for (let i = 0; i < eye.scleraMask.length; i++) {
    if (!eye.scleraMask[i]) continue;
    const r = data[i * 3];
    if (r === 0) continue;
    const lead = (r - Math.max(data[i * 3 + 1], data[i * 3 + 2])) / r;
    const k = Math.min(bins - 1, Math.max(0, Math.floor((lead - from) / width)));
    counts[k]++;
    total++;
  }
  return counts.map((pixels, k) => {
    const lead = from + (k + 0.5) * width;
    return { lead: +lead.toFixed(3), pixels, share: total ? pixels / total : 0, countsAsRed: lead >= RED_DOMINANCE };
  });
}

export interface RadialSample {
  /** Distance from the pupil centre in iris radii. */
  radius: number;
  /** Mean red-layer intensity (highlights removed) on that circle. */
  intensity: number;
}

/**
 * Mean intensity on circles around the pupil centre - the profile the
 * integro-differential search differentiates. The steepest rises are the
 * pupil and iris edges.
 */
export function radialProfile(eye: EyeAnalysis, maxRadius = 1.6, steps = 80): RadialSample[] {
  const red = removeHighlights(gaussianBlur(channel(eye.roi, 0), 1));
  const { cx, cy } = eye.pupil;
  const samples: RadialSample[] = [];
  for (let k = 0; k <= steps; k++) {
    const radius = (maxRadius * k) / steps;
    const r = radius * eye.iris.r;
    let sum = 0;
    // Lateral arcs only, as in the iris search: the lids hide the top and bottom.
    const angles = [-40, -20, 0, 20, 40, 140, 160, 180, 200, 220];
    for (const a of angles) sum += sampleGray(red, cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180));
    samples.push({ radius: +radius.toFixed(3), intensity: +(sum / angles.length).toFixed(1) });
  }
  return samples;
}

/** Normal density, for drawing the paper's Table 4 class distributions. */
export function gaussian(x: number, mean: number, std: number): number {
  return Math.exp(-((x - mean) ** 2) / (2 * std * std)) / (std * Math.sqrt(2 * Math.PI));
}
