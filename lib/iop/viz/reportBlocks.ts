/**
 * The visualisation as a notebook: numbered blocks in the order the analysis
 * notebook runs, each with a short explanation, its figures, and an "Out"
 * cell of printed values. Figures are VizTiles; values are measured on the
 * normalised crop, like every feature.
 */
import type { DerivedViz } from './derived';
import type { DisplayEye } from './display';
import type { VizTile } from './draw';

export type BlockExtra = 'formulas' | 'red-lead-chart' | 'radial-chart' | 'classes-chart' | 'region-legend';

export interface OutputLine {
  label: string;
  value: string;
}

export interface ReportBlock {
  id: string;
  title: string;
  description: string;
  figures: VizTile[];
  outputs: OutputLine[];
  extras?: BlockExtra[];
}

const f4 = (value: number) => (Number.isFinite(value) ? value.toFixed(4) : 'n/a');
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

const SOURCE_TEXT: Record<DisplayEye['eye']['source'], string> = {
  mediapipe: 'MediaPipe face landmarks',
  auto: 'close-up detector',
  manual: 'hand-marked points',
};

/**
 * @param tiles Every tile from segmentationTiles and pipelineTiles, by id.
 */
export function reportBlocks(view: DisplayEye, derived: DerivedViz, tiles: Map<string, VizTile>): ReportBlock[] {
  const { eye } = view;
  const { features } = eye;
  const pick = (...ids: string[]) => ids.map((id) => tiles.get(id)).filter((tile): tile is VizTile => !!tile);
  const px = (n: number) => `${n.toLocaleString()} px`;
  return [
    {
      id: 'input', title: 'Input: normalised eye crop',
      description: 'The eye is cropped and rescaled so the iris radius is 50 px, so that every eye is measured at the same scale. Every feature below is measured at this scale; the figures are drawn from the original photo for detail.',
      figures: pick('crop'),
      outputs: [
        { label: 'Eye located by', value: SOURCE_TEXT[eye.source] },
        { label: 'Iris radius in the photo', value: px(Math.round(eye.iris.r / eye.roiScale)) },
        { label: 'Rescale factor', value: `x${eye.roiScale.toFixed(3)}` },
      ],
    },
    {
      id: 'segmentation', title: 'Segmentation masks',
      description: 'Pupil, visible iris and sclera - the three regions every feature is computed from - over the eye and as a flat label map.',
      figures: pick('regions', 'label-map'),
      extras: ['region-legend'],
      outputs: [
        { label: 'Area share (pupil / iris / sclera)', value: `${f4(derived.areaShares.pupil)} / ${f4(derived.areaShares.iris)} / ${f4(derived.areaShares.sclera)}` },
        { label: 'Area (pupil / iris / sclera)', value: `${px(derived.areaPixels.pupil)} / ${px(derived.areaPixels.iris)} / ${px(derived.areaPixels.sclera)}` },
      ],
    },
    {
      id: 'sclera', title: 'Sclera segmentation',
      description: 'Sclera = eye opening minus the iris, minus 10% of the eye length at each corner (the pink caruncle and lid margin) and specular glare. MRL and RAP are measured on this region.',
      figures: pick('sclera', 'excluded'),
      outputs: [
        { label: 'Sclera pixels', value: px(eye.scleraPixelCount) },
        { label: 'Excluded from the opening (canthi + glare)', value: pct(derived.excludedShare) },
      ],
    },
    {
      id: 'contour', title: 'Sclera contour (active contour)',
      description: 'A Chan-Vese active contour seeded with the sclera mask keeps the region that is uniformly bright. Its area and height, relative to the mask, are the two contour features.',
      figures: pick('sclera-contour', 'active-contour'),
      outputs: [
        { label: 'Contour Area', value: f4(features.contourArea) },
        { label: 'Contour Height', value: f4(features.contourHeight) },
      ],
    },
    {
      id: 'redness', title: 'Red pixels: RAP and MRL',
      description: 'A sclera pixel is reddish when red leads green and blue by more than 12% and green and blue stay close. RAP is their share of the sclera; MRL is the mean redness over every sclera pixel.',
      figures: pick('red-pixels', 'red-mask', 'redness-map'),
      extras: ['formulas', 'red-lead-chart'],
      outputs: [
        { label: 'Red Area Percentage (RAP)', value: f4(features.rap) },
        { label: 'Mean Redness Level (MRL)', value: f4(features.mrl) },
      ],
    },
    {
      id: 'inverted', title: 'Inverted red pixel mask',
      description: 'The complement of the reddish mask inside the sclera: the pixels not counted as red. Together the two masks cover the whole sclera.',
      figures: pick('inverted-pixels', 'inverted-mask'),
      outputs: [{ label: 'Inverted share (1 - RAP)', value: f4(1 - features.rap) }],
    },
    {
      id: 'vessels', title: 'Vessel network (reference)',
      description: 'Conjunctival vessels found by a black top-hat on the green channel. Not one of the five features: it shows the structures the redness measures respond to.',
      figures: pick('vessels', 'vessel-mask'),
      outputs: [{ label: 'Sclera covered by vessels', value: pct(derived.vessels.coverage) }],
    },
    {
      id: 'iris', title: 'Iris (segmented)',
      description: 'The iris circle, refined on the red layer using only its left and right arcs (the lids hide the top and bottom), and the visible iris ring.',
      figures: pick('circles', 'iris'),
      outputs: [{ label: 'Iris radius (normalised)', value: `${eye.iris.r.toFixed(1)} px` }],
    },
    {
      id: 'pupil', title: 'Pupil (segmented) and pupil / iris ratio',
      description: 'The pupil is searched inside a square just inside the iris, on the red layer with reflections filled in, as the dark disc with the sharpest edge.',
      figures: pick('red-layer', 'highlights', 'pupil'),
      extras: ['radial-chart'],
      outputs: [
        { label: 'Pupil radius (normalised)', value: `${eye.pupil.r.toFixed(1)} px` },
        { label: 'Pupil edge contrast', value: `${eye.pupilContrast.toFixed(0)} / 255` },
        { label: 'Pupil/Iris Ratio', value: f4(features.pupilIrisRatio) },
      ],
    },
    {
      id: 'lids', title: 'Eyelid localisation',
      description: 'How the eye opening was outlined. Each eyelid is modelled as a circle; the sclera and every region above depend on this outline.',
      figures: pick('lids', 'sclera-mask'),
      outputs: [{ label: 'Outline from', value: SOURCE_TEXT[eye.source] }],
    },
    {
      id: 'summary', title: 'Summary',
      description: 'The five features for this eye, and where each sits against the reference distributions for normal and high IOP.',
      figures: [],
      extras: ['classes-chart'],
      outputs: [
        { label: 'Pupil/Iris Ratio', value: f4(features.pupilIrisRatio) },
        { label: 'Red Area Percentage (RAP)', value: f4(features.rap) },
        { label: 'Mean Redness Level (MRL)', value: f4(features.mrl) },
        { label: 'Contour Area', value: f4(features.contourArea) },
        { label: 'Contour Height', value: f4(features.contourHeight) },
      ],
    },
  ];
}
