/**
 * Shared types for the frontal-eye IOP risk pipeline (Al-Oudat et al., 2018,
 * EURASIP JIVP 2018:90). Everything here is plain data so the pipeline runs
 * the same in the browser and in Node tests.
 */

/** RGB image, row-major, 3 bytes per pixel (no alpha). */
export interface RgbImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Single-channel float image, row-major. */
export interface GrayImage {
  width: number;
  height: number;
  data: Float32Array;
}

export interface Point {
  x: number;
  y: number;
}

export interface Circle {
  cx: number;
  cy: number;
  r: number;
}

export type EyeSide = 'left' | 'right';

/** A close-up of one eye does not show which eye it is. */
export type EyeSideLabel = EyeSide | 'unknown';

/**
 * Where the eye is in the source image, in source pixels. `eyelid` is the
 * closed outline of the palpebral opening (upper lid then lower lid).
 */
export interface EyeGeometry {
  side: EyeSideLabel;
  iris: Circle;
  eyelid: Point[];
  /** mediapipe = face landmarks; auto = close-up detector; manual = clicked points. */
  source: 'mediapipe' | 'auto' | 'manual';
  /** How the close-up detector found the lids, for the visualisations. */
  lidEvidence?: LidEvidence;
}

/** Lid edge candidates, the ones the circle fit accepted, and the fitted lid circles. */
export interface LidEvidence {
  edges: Point[];
  inliers: Point[];
  upperLid: Circle;
  lowerLid: Circle;
}

/** The five features of the paper, in the order of its feature matrix (Fig. 11). */
export interface IopFeatures {
  /** Pupil radius / iris radius. */
  pupilIrisRatio: number;
  /** Red area percentage of the sclera, 0..1 (Eq. 7). */
  rap: number;
  /** Mean redness level of the sclera (Eq. 6). */
  mrl: number;
  /** Active-contour region area / sclera mask area. */
  contourArea: number;
  /** Active-contour region height / sclera mask height. */
  contourHeight: number;
}

export const FEATURE_ORDER: (keyof IopFeatures)[] = [
  'pupilIrisRatio',
  'rap',
  'mrl',
  'contourArea',
  'contourHeight',
];

export interface QualityFlag {
  code: 'low_resolution' | 'eye_not_open' | 'glare' | 'pupil_low_contrast' | 'small_sclera' | 'iris_refine_failed';
  message: string;
}

/** Everything the UI needs to draw and report one analysed eye. */
export interface EyeAnalysis {
  side: EyeSideLabel;
  source: EyeGeometry['source'];
  features: IopFeatures;
  /** Normalised crop the features were measured on. */
  roi: RgbImage;
  /** Maps ROI pixels back to the source: src = roiOrigin + roi / roiScale. */
  roiOrigin: Point;
  roiScale: number;
  /** Geometry in ROI pixels. */
  iris: Circle;
  pupil: Circle;
  eyelid: Point[];
  /** Masks in ROI pixels, 1 = inside. */
  scleraMask: Uint8Array;
  redMask: Uint8Array;
  contourMask: Uint8Array;
  pupilContrast: number;
  scleraPixelCount: number;
  flags: QualityFlag[];
  /** Close-up detector evidence, in ROI pixels (auto source only). */
  lidEvidence?: LidEvidence;
}
