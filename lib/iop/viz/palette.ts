/**
 * Colours for the IOP visualisations, on the page's dark slate surface.
 *
 * Region identity uses the first three slots of the reference categorical
 * palette (dark steps), which pass all-pairs colour-vision checks on
 * #0f172a: worst CVD dE 9.4, normal-vision dE 20.9, all >= 3:1 contrast.
 * Order is fixed; do not cycle or add a fourth hue - "other" is neutral.
 */

export type Rgb = [number, number, number];

export const REGION_COLOURS = {
  pupil: [0x39, 0x87, 0xe5] as Rgb, // slot 1 blue
  sclera: [0xd9, 0x59, 0x26] as Rgb, // slot 2 orange
  iris: [0x19, 0x9e, 0x70] as Rgb, // slot 3 aqua
  other: [0x64, 0x74, 0x8b] as Rgb, // neutral slate
};

/** Reddish-pixel highlight and the redness ramp: one warm hue, magnitude by alpha. */
export const REDNESS: Rgb = [0xe6, 0x67, 0x67];

/** Outlines drawn over photos: chosen for legibility on skin and sclera. */
export const OUTLINE = {
  contour: '#22c55e',
  lid: '#facc15',
  iris: '#3987e5',
  pupil: '#e66767',
  edge: 'rgba(250, 204, 21, 0.45)',
  inlier: '#facc15',
};

/** Chart tokens for the dark surface. */
export const CHART = {
  normal: '#3987e5', // slot 1
  high: '#d95926', // slot 2
  value: '#f8fafc', // text-primary: this eye's value
  grid: '#334155',
  axis: '#94a3b8',
  text: '#cbd5e1',
};

export const rgbCss = ([r, g, b]: Rgb, alpha = 1) => `rgba(${r}, ${g}, ${b}, ${alpha})`;
