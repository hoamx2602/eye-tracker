/**
 * The processing steps as figures, for showing how each number was reached:
 * crop, red layer, highlight removal, circles, eyelids, sclera, redness and
 * the active contour. Drawn at display resolution (see display.ts).
 */
import { removeHighlights } from '../circleSearch';
import { channel, gaussianBlur } from '../imageOps';
import type { Circle, EyeAnalysis, GrayImage } from '../types';
import type { DisplayEye } from './display';
import { drawCircle, drawDots, drawOutline, type Overlay, type VizTile } from './draw';
import { OUTLINE, REGION_COLOURS } from './palette';
import { greyscale, paint, photo, rednessHeatmap, regionOverlay } from './raster';
import { regionMasks, thickBoundary } from './regions';

const LID_SOURCE_TEXT: Record<EyeAnalysis['source'], string> = {
  auto: 'Close-up detector: faint dots are lid-edge candidates from column walks, bright dots the ones the circle fit kept; the two circles are the eyelids.',
  mediapipe: 'MediaPipe face landmarks: the 16 lid landmarks of this eye define the opening.',
  manual: 'Hand-marked: two eyelid circles through the clicked corners and lid extremes.',
};

/** Side of the square the pupil search works in, as in circleSearch.findPupil. */
const PUPIL_BOX_HALF = 0.95;

function lidOverlay(view: DisplayEye): Overlay {
  const f = view.factor;
  return (ctx, scale) => {
    const evidence = view.lidEvidence;
    if (evidence) {
      drawDots(ctx, scale, evidence.edges, OUTLINE.edge, f);
      drawDots(ctx, scale, evidence.inliers, OUTLINE.inlier, 1.1 * f);
      drawCircle(ctx, scale, evidence.upperLid, OUTLINE.lid, f);
      drawCircle(ctx, scale, evidence.lowerLid, OUTLINE.lid, f);
    } else if (view.eye.source === 'mediapipe') {
      drawDots(ctx, scale, view.eyelid, OUTLINE.inlier, 1.6 * f);
    }
    drawOutline(ctx, scale, view.eyelid, OUTLINE.contour, 1.5 * f);
  };
}

/** The red layer with highlights removed inside the pupil-search square only, as the pipeline does. */
function highlightsRemovedInBox(red: GrayImage, iris: Circle): GrayImage {
  const half = iris.r * PUPIL_BOX_HALF;
  const x0 = Math.max(0, Math.round(iris.cx - half));
  const y0 = Math.max(0, Math.round(iris.cy - half));
  const x1 = Math.min(red.width, Math.round(iris.cx + half));
  const y1 = Math.min(red.height, Math.round(iris.cy + half));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 3 || h < 3) return red;
  const box = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) box[y * w + x] = red.data[(y0 + y) * red.width + x0 + x];
  const filled = removeHighlights({ width: w, height: h, data: box }).data;
  const out = Float32Array.from(red.data);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[(y0 + y) * red.width + x0 + x] = filled[y * w + x];
  return { width: red.width, height: red.height, data: out };
}

export function pipelineTiles(view: DisplayEye): VizTile[] {
  const { eye, roi, factor: f } = view;
  const { width, height } = roi;
  const line = Math.max(2, Math.round(2 * f));
  const red = gaussianBlur(channel(roi, 0), f);
  const regions = regionMasks(view);
  const circles: Overlay = (ctx, scale) => {
    drawCircle(ctx, scale, view.iris, OUTLINE.iris, 1.5 * f);
    drawCircle(ctx, scale, view.pupil, OUTLINE.pupil, 1.5 * f);
  };
  const pupilBox: Overlay = (ctx, scale) => {
    const half = view.iris.r * PUPIL_BOX_HALF;
    ctx.strokeStyle = OUTLINE.lid;
    ctx.lineWidth = f * scale;
    ctx.strokeRect((view.iris.cx - half) * scale, (view.iris.cy - half) * scale, 2 * half * scale, 2 * half * scale);
  };
  const scleraOnly = { ...regions, pupil: new Uint8Array(regions.pupil.length), iris: new Uint8Array(regions.iris.length) };
  return [
    {
      id: 'crop', title: 'Normalised crop',
      caption: `Features are measured with the iris rescaled to 50 px (x${eye.roiScale.toFixed(2)} of the photo), so every eye is measured at the same scale. Shown here at x${f.toFixed(1)} that scale for detail.`,
      image: () => photo(roi),
    },
    {
      id: 'red-layer', title: 'Red layer',
      caption: 'Pupil and iris are detected on the red channel, where the pupil is darkest against the iris.',
      image: () => greyscale(red),
    },
    {
      id: 'highlights', title: 'Highlights removed',
      caption: 'Inside the yellow square (just inside the iris, where the pupil is searched), bright spots enclosed by darker pixels are filled so reflections do not break the pupil edge.',
      image: () => greyscale(highlightsRemovedInBox(red, view.iris)),
      overlay: pupilBox,
    },
    {
      id: 'circles', title: 'Iris and pupil circles',
      caption: `Blue: iris. Red: pupil (edge contrast ${eye.pupilContrast.toFixed(0)}/255). Pupil / iris ratio ${eye.features.pupilIrisRatio.toFixed(3)}.`,
      image: () => photo(roi), overlay: circles,
    },
    {
      id: 'lids', title: 'Eyelids',
      caption: LID_SOURCE_TEXT[eye.source],
      image: () => photo(roi), overlay: lidOverlay(view),
    },
    {
      id: 'sclera-mask', title: 'Sclera mask',
      caption: 'Opening minus iris, minus 10% of the eye length at each corner (pink caruncle) and specular glare.',
      image: () => regionOverlay(roi, scleraOnly, 0.5), overlay: circles,
    },
    {
      id: 'redness', title: 'Redness (MRL)',
      caption: `Per-pixel (3R - G - B) / (3·255); stronger red = redder. Its mean over the sclera is the MRL: ${eye.features.mrl.toFixed(3)}.`,
      image: () => rednessHeatmap(roi, view.scleraMask),
    },
    {
      id: 'active-contour', title: 'Active contour',
      caption: 'Orange: sclera mask boundary. Green: Chan-Vese region seeded from it; area and height ratios are the contour features.',
      image: () => {
        const img = photo(roi);
        paint(img, thickBoundary(view.scleraMask, width, height, line), REGION_COLOURS.sclera);
        return paint(img, thickBoundary(view.contourMask, width, height, line), [0x22, 0xc5, 0x5e]);
      },
    },
  ];
}
