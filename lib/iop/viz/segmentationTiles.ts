/**
 * The notebook's figure set, rebuilt from our pipeline's masks at display
 * resolution: regions, the sclera and its contour, reddish pixels, the vessel
 * network, iris, pupil, what was excluded, and the redness map.
 */
import type { Point } from '../types';
import type { DisplayEye } from './display';
import { drawCircle, drawLabel, type Overlay, type VizTile } from './draw';
import { OUTLINE, REDNESS, REGION_COLOURS, type Rgb } from './palette';
import { binary, highlightedPhoto, labelMap, maskedPhoto, paint, photo, rednessHeatmap, regionOverlay, tint } from './raster';
import { countOnes, labelAnchor, regionMasks, thickBoundary, type RegionMasks } from './regions';
import { vesselMap } from './vessels';

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const GREEN: Rgb = [0x22, 0xc5, 0x5e];
const AMBER: Rgb = [0xfa, 0xcc, 0x15];
const SLATE: Rgb = [0x64, 0x74, 0x8b];

/** Region names at their deepest points, so identity never rests on colour alone. */
function regionLabels(regions: RegionMasks, factor: number): Overlay {
  const entries: [string, Uint8Array][] = [['Pupil', regions.pupil], ['Iris', regions.iris], ['Sclera', regions.sclera]];
  let anchors: { name: string; at: Point }[] | null = null;
  return (ctx, scale) => {
    // Found once, on first draw: repeated erosion is the slow part at display resolution.
    anchors ??= entries.flatMap(([name, mask]) => {
      const at = labelAnchor(mask, regions.width, regions.height);
      return at ? [{ name, at }] : [];
    });
    for (const { name, at } of anchors) drawLabel(ctx, scale, name, at, 9 * factor);
  };
}

/** a AND NOT b. */
const without = (a: Uint8Array, b: Uint8Array) => a.map((v, i) => (v && !b[i] ? 1 : 0));

export function segmentationTiles(view: DisplayEye): VizTile[] {
  const { eye, roi, factor } = view;
  const { width, height } = roi;
  const line = Math.max(2, Math.round(2 * factor));
  const regions = regionMasks(view);
  const vessels = vesselMap(roi, view.scleraMask, factor);
  const excluded = without(view.openingOutsideIris, view.scleraMask);
  const labels = regionLabels(regions, factor);
  return [
    {
      id: 'regions', title: 'Labelled regions',
      caption: 'Pupil, visible iris and sclera over the eye; everything outside the eye opening is grey.',
      image: () => regionOverlay(roi, regions), overlay: labels,
    },
    {
      id: 'sclera', title: 'Segmented sclera',
      caption: `Eye opening minus iris, canthal wedges and glare. MRL and RAP are measured on this region (${eye.scleraPixelCount.toLocaleString()} px at the measurement scale).`,
      image: () => maskedPhoto(roi, view.scleraMask),
    },
    {
      id: 'sclera-contour', title: 'Sclera with active contour',
      caption: `Green: boundary of the Chan-Vese region. Contour area ${eye.features.contourArea.toFixed(3)}, height ${eye.features.contourHeight.toFixed(3)} of the sclera mask.`,
      image: () => paint(maskedPhoto(roi, view.scleraMask), thickBoundary(view.contourMask, width, height, line), GREEN),
    },
    {
      id: 'label-map', title: 'Label map',
      caption: 'All three regions as flat colours - the mask set every feature is computed from.',
      image: () => labelMap(regions), overlay: labels,
    },
    {
      id: 'red-pixels', title: 'Reddish pixels',
      caption: `Full colour: sclera pixels where red leads green and blue by >12% (the RAP rule); the rest of the sclera is dimmed. RAP ${pct(eye.features.rap)}.`,
      image: () => highlightedPhoto(roi, view.redMask, view.scleraMask),
    },
    {
      id: 'red-mask', title: 'Reddish-pixel mask',
      caption: `The same pixels as a binary mask (P in Eq. 7), sclera outlined in grey. RAP = white / sclera pixels = ${pct(eye.features.rap)}.`,
      image: () => paint(binary(view.redMask, width, height), without(thickBoundary(view.scleraMask, width, height, line), view.redMask), SLATE),
    },
    {
      id: 'vessels', title: 'Vessel network',
      caption: `Conjunctival vessels (black top-hat on the green channel) in red over the sclera: ${pct(vessels.coverage)} of it. Reference view, not a paper feature.`,
      image: () => tint(maskedPhoto(roi, view.scleraMask), vessels.mask, REDNESS, 0.9),
    },
    {
      id: 'vessel-mask', title: 'Sclera minus vessels',
      caption: 'Binary: sclera white, vessels black. It resembles the notebook\'s "red pixel" mask, which in fact kept bright pixels and dropped the vessels.',
      image: () => binary(without(view.scleraMask, vessels.mask), width, height),
    },
    {
      id: 'iris', title: 'Segmented iris',
      caption: `Iris ring between the lids, pupil excluded. Iris radius ${eye.iris.r.toFixed(0)} px at the measurement scale.`,
      image: () => maskedPhoto(roi, regions.iris),
    },
    {
      id: 'pupil', title: 'Segmented pupil',
      caption: `Pupil / iris ratio ${eye.features.pupilIrisRatio.toFixed(3)}. The red ring marks the pupil, which is dark on the black background.`,
      image: () => maskedPhoto(roi, regions.pupil),
      overlay: (ctx, scale) => drawCircle(ctx, scale, { ...view.pupil, r: view.pupil.r + 1.5 * factor }, OUTLINE.pupil, 1.2 * factor),
    },
    {
      id: 'excluded', title: 'Excluded from the sclera',
      caption: countOnes(excluded)
        ? 'Amber: parts of the opening left out - the canthal wedges (pink caruncle, lid margin) and specular glare. Orange: the sclera kept.'
        : 'Nothing in the opening was excluded. Orange: the sclera kept.',
      image: () => tint(tint(photo(roi), view.scleraMask, REGION_COLOURS.sclera, 0.25), excluded, AMBER, 0.6),
    },
    {
      id: 'redness-map', title: 'Redness map',
      caption: `Per-pixel (3R - G - B) / (3·255) over the sclera; stronger red = redder. Its mean is the MRL: ${eye.features.mrl.toFixed(3)}.`,
      image: () => rednessHeatmap(roi, view.scleraMask),
    },
  ];
}

export const REGION_LEGEND: { name: string; colour: Rgb }[] = [
  { name: 'Pupil', colour: REGION_COLOURS.pupil },
  { name: 'Iris', colour: REGION_COLOURS.iris },
  { name: 'Sclera', colour: REGION_COLOURS.sclera },
  { name: 'Outside the eye opening', colour: REGION_COLOURS.other },
];
