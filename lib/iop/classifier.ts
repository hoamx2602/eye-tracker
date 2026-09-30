/**
 * The paper's classifier: a 5-10-1 multilayer perceptron with sigmoid units,
 * output >= 0.5 meaning high IOP (Section 4.4). The paper publishes neither
 * data nor weights, so weights come from training on our own labelled
 * features (iop_estimation/train_iop_mlp.py writes this JSON format).
 */
import { FEATURE_ORDER, type IopFeatures } from './types';

export const IOP_MODEL_URL = '/iop/model.json';

export interface IopModel {
  version: 1;
  features: (keyof IopFeatures)[];
  scalerMean: number[];
  scalerStd: number[];
  /** hiddenWeights[input][hidden], as sklearn's coefs_[0]. */
  hiddenWeights: number[][];
  hiddenBias: number[];
  outputWeights: number[];
  outputBias: number;
  threshold: number;
  /** Free-form provenance: dataset, date, cross-validated metrics. */
  trainedOn?: string;
  metrics?: Record<string, number>;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Probability of high IOP for one feature vector. */
export function predictHighIop(model: IopModel, features: IopFeatures): number {
  const x = model.features.map((key, i) => (features[key] - model.scalerMean[i]) / (model.scalerStd[i] || 1));
  const hidden = model.hiddenBias.map((bias, j) => sigmoid(x.reduce((sum, xi, i) => sum + xi * model.hiddenWeights[i][j], bias)));
  return sigmoid(hidden.reduce((sum, hj, j) => sum + hj * model.outputWeights[j], model.outputBias));
}

/** Loads the trained model if one has been deployed; null means features-only mode. */
export async function loadIopModel(): Promise<IopModel | null> {
  try {
    const response = await fetch(IOP_MODEL_URL, { cache: 'no-store' });
    if (!response.ok) return null;
    const model = (await response.json()) as IopModel;
    const valid = model.version === 1 && model.features.every((f) => FEATURE_ORDER.includes(f));
    return valid ? model : null;
  } catch {
    return null;
  }
}

export interface ClassStats {
  mean: number;
  std: number;
}

/**
 * Table 4 of the paper: mean and STD per class. Only for orientation - our
 * red-pixel rule and active-contour settings are not the authors' (they did
 * not publish them), so our values sit on a different scale for RAP and the
 * contour features.
 */
export const PAPER_TABLE4: Record<keyof IopFeatures, { normal: ClassStats; high: ClassStats }> = {
  pupilIrisRatio: { normal: { mean: 0.4491, std: 0.0924 }, high: { mean: 0.6983, std: 0.101 } },
  rap: { normal: { mean: 0.3506, std: 0.1165 }, high: { mean: 0.855, std: 0.2672 } },
  mrl: { normal: { mean: 0.2807, std: 0.0677 }, high: { mean: 0.6363, std: 0.0732 } },
  contourArea: { normal: { mean: 0.4553, std: 0.0722 }, high: { mean: 0.2013, std: 0.1182 } },
  contourHeight: { normal: { mean: 0.6134, std: 0.126 }, high: { mean: 0.3147, std: 0.1574 } },
};

export const FEATURE_LABELS: Record<keyof IopFeatures, string> = {
  pupilIrisRatio: 'Pupil / iris ratio',
  rap: 'Red area percentage (RAP)',
  mrl: 'Mean redness level (MRL)',
  contourArea: 'Sclera contour area',
  contourHeight: 'Sclera contour height',
};
