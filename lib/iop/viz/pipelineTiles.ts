/**
 * The pipeline as a strip of steps, for showing how each number was reached:
 * normalised crop, red layer, highlight removal, circles, eyelids, sclera,
 * redness and the active contour.
 */
import { removeHighlights } from '../circleSearch';
import { channel, gaussianBlur } from '../imageOps';
import type { EyeAnalysis } from '../types';
import { drawCircle, drawDots, drawOutline, type Overlay, type VizTile } from './draw';
import { OUTLINE, REGION_COLOURS } from './palette';
import { greyscale, paint, photo, rednessHeatmap, regionOverlay, type RgbaImage } from './raster';
import { regionMasks, thickBoundary } from './regions';

const LID_SOURCE_TEXT: Record<EyeAnalysis['source'], string> = {
  auto: 'Close-up detector: faint dots are lid-edge candidates from column walks, bright dots the ones the circle fit kept; the two circles are the eyelids (paper Fig. 6).',
  mediapipe: 'MediaPipe face landmarks: the 16 lid landmarks of this eye define the opening.',
  manual: 'Hand-marked: two eyelid circles through the clicked corners and lid extremes.',
};

function lidOverlay(eye: EyeAnalysis): Overlay {
  return (ctx, scale) => {
    const evidence = eye.lidEvidence;
    if (evidence) {
      drawDots(ctx, scale, evidence.edges, OUTLINE.edge, 1);
      drawDots(ctx, scale, evidence.inliers, OUTLINE.inlier, 1.1);
      drawCircle(ctx, scale, evidence.upperLid, OUTLINE.lid, 1);
      drawCircle(ctx, scale, evidence.lowerLid, OUTLINE.lid, 1);
    } else if (eye.source === 'mediapipe') {
      drawDots(ctx, scale, eye.eyelid, OUTLINE.inlier, 1.6);
    }
    drawOutline(ctx, scale, eye.eyelid, OUTLINE.contour, 1.5);
  };
}

export function pipelineTiles(eye: EyeAnalysis): VizTile[] {
  const { width, height } = eye.roi;
  const red = gaussianBlur(channel(eye.roi, 0), 1);
  const regions = regionMasks(eye);
  const circles: Overlay = (ctx, scale) => {
    drawCircle(ctx, scale, eye.iris, OUTLINE.iris);
    drawCircle(ctx, scale, eye.pupil, OUTLINE.pupil);
  };
  const scleraOnly = { ...regions, pupil: new Uint8Array(regions.pupil.length), iris: new Uint8Array(regions.iris.length) };
  return [
    {
      id: 'crop',
      title: '1 · Normalised crop',
      caption: `Rescaled so the iris radius is 50 px (x${eye.roiScale.toFixed(2)} from the photo), as the paper fixes the eye crop size.`,
      image: () => photo(eye.roi),
    },
    {
      id: 'red-layer',
      title: '2 · Red layer',
      caption: 'The paper detects pupil and iris on the red channel, where the pupil is darkest against the iris.',
      image: () => greyscale(red),
    },
    {
      id: 'highlights',
      title: '3 · Highlights removed',
      caption: 'Morphological fill of bright spots enclosed by darker pixels, so corneal reflections do not break the pupil edge.',
      image: () => greyscale(removeHighlights(red)),
    },
    {
      id: 'circles',
      title: '4 · Iris and pupil circles',
      caption: `Blue: iris (r ${eye.iris.r.toFixed(0)} px). Red: pupil (r ${eye.pupil.r.toFixed(0)} px, edge contrast ${eye.pupilContrast.toFixed(0)}/255).`,
      image: () => photo(eye.roi),
      overlay: circles,
    },
    {
      id: 'lids',
      title: '5 · Eyelids',
      caption: LID_SOURCE_TEXT[eye.source],
      image: () => photo(eye.roi),
      overlay: lidOverlay(eye),
    },
    {
      id: 'sclera-mask',
      title: '6 · Sclera mask',
      caption: 'Opening minus iris, minus 10% of the eye length at each corner (pink caruncle) and specular glare.',
      image: (): RgbaImage => regionOverlay(eye.roi, scleraOnly, 0.5),
      overlay: circles,
    },
    {
      id: 'redness',
      title: '7 · Redness (MRL)',
      caption: `Per-pixel (3R - G - B) / (3·255); stronger red = redder. Its mean over the sclera is the MRL: ${eye.features.mrl.toFixed(3)}.`,
      image: () => rednessHeatmap(eye.roi, eye.scleraMask),
    },
    {
      id: 'active-contour',
      title: '8 · Active contour',
      caption: 'Orange: sclera mask boundary. Green: Chan-Vese region seeded from it; area and height ratios are the contour features.',
      image: () => {
        const img = photo(eye.roi);
        paint(img, thickBoundary(eye.scleraMask, width, height), REGION_COLOURS.sclera);
        return paint(img, thickBoundary(eye.contourMask, width, height), [0x22, 0xc5, 0x5e]);
      },
    },
  ];
}
