/**
 * The notebook's figure set, rebuilt from our pipeline's masks: labelled
 * regions, each region on black, the sclera contour, the reddish pixels and
 * their binary mask, and the combined label map.
 */
import type { EyeAnalysis } from '../types';
import { drawCircle, drawLabel, type Overlay, type VizTile } from './draw';
import { OUTLINE, REGION_COLOURS } from './palette';
import { binary, labelMap, maskedPhoto, paint, regionOverlay } from './raster';
import { countOnes, labelAnchor, regionMasks, thickBoundary, type RegionMasks } from './regions';

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

/** Region names at their centroids, so identity never rests on colour alone. */
function regionLabels(regions: RegionMasks): Overlay {
  return (ctx, scale) => {
    const entries: [string, Uint8Array][] = [['Pupil', regions.pupil], ['Iris', regions.iris], ['Sclera', regions.sclera]];
    for (const [name, mask] of entries) {
      const at = labelAnchor(mask, regions.width, regions.height);
      if (at) drawLabel(ctx, scale, name, at);
    }
  };
}

export function segmentationTiles(eye: EyeAnalysis): VizTile[] {
  const regions = regionMasks(eye);
  const { width, height } = eye.roi;
  const scleraCount = countOnes(regions.sclera);
  const redCount = countOnes(eye.redMask);
  return [
    {
      id: 'regions',
      title: 'Labelled regions',
      caption: 'Pupil, visible iris and sclera over the normalised crop; everything outside the eye opening is grey.',
      image: () => regionOverlay(eye.roi, regions),
      overlay: regionLabels(regions),
    },
    {
      id: 'sclera',
      title: 'Segmented sclera',
      caption: `Eye opening minus iris, canthal wedges and glare: ${scleraCount.toLocaleString()} px. MRL and RAP are measured here.`,
      image: () => maskedPhoto(eye.roi, regions.sclera),
    },
    {
      id: 'sclera-contour',
      title: 'Sclera with active contour',
      caption: `Green: boundary of the Chan-Vese region. Contour area ${eye.features.contourArea.toFixed(3)}, height ${eye.features.contourHeight.toFixed(3)} of the sclera mask.`,
      image: () => paint(maskedPhoto(eye.roi, regions.sclera), thickBoundary(eye.contourMask, width, height), [0x22, 0xc5, 0x5e]),
    },
    {
      id: 'red-pixels',
      title: 'Reddish pixels',
      caption: `Sclera pixels where red leads green and blue by >12%: ${redCount.toLocaleString()} px, RAP ${pct(eye.features.rap)}.`,
      image: () => maskedPhoto(eye.roi, eye.redMask),
    },
    {
      id: 'red-mask',
      title: 'Reddish-pixel mask',
      caption: 'The same pixels as a binary mask (P in Eq. 7); RAP = white pixels / sclera pixels.',
      image: () => binary(eye.redMask, width, height),
    },
    {
      id: 'iris',
      title: 'Segmented iris',
      caption: `Iris ring between the lids, pupil excluded. Iris radius ${eye.iris.r.toFixed(0)} px in the crop.`,
      image: () => maskedPhoto(eye.roi, regions.iris),
    },
    {
      id: 'pupil',
      title: 'Segmented pupil',
      caption: `Pupil radius ${eye.pupil.r.toFixed(0)} px; pupil / iris ratio ${eye.features.pupilIrisRatio.toFixed(3)}. Red ring marks the pupil, which is dark against the black background.`,
      image: () => maskedPhoto(eye.roi, regions.pupil),
      overlay: (ctx, scale) => drawCircle(ctx, scale, { ...eye.pupil, r: eye.pupil.r + 1.5 }, OUTLINE.pupil, 1.2),
    },
    {
      id: 'label-map',
      title: 'Label map',
      caption: 'All three regions as flat colours - the mask set every feature is computed from.',
      image: () => labelMap(regions),
      overlay: regionLabels(regions),
    },
  ];
}

export const REGION_LEGEND: { name: string; colour: [number, number, number] }[] = [
  { name: 'Pupil', colour: REGION_COLOURS.pupil },
  { name: 'Iris', colour: REGION_COLOURS.iris },
  { name: 'Sclera', colour: REGION_COLOURS.sclera },
  { name: 'Outside the eye opening', colour: REGION_COLOURS.other },
];
