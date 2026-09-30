/**
 * Labelled feature rows collected in the IOP tool, kept in this browser and
 * exported as CSV for iop_estimation/train_iop_mlp.py. No image leaves the
 * browser; only these numbers and labels do, when the researcher exports.
 */
import { FEATURE_ORDER, type EyeSideLabel, type IopFeatures } from './types';

/** Paper Section 3: IOP <= 20 mmHg is normal, above is high. */
export const HIGH_IOP_CUTOFF_MMHG = 20;

export type IopLabel = 'normal' | 'high' | 'unknown';
export type Medication = 'yes' | 'no' | 'unknown';

export interface IopDatasetRow {
  id: string;
  createdAt: string;
  participantId: string;
  imageName: string;
  eye: EyeSideLabel;
  geometrySource: 'mediapipe' | 'auto' | 'manual';
  features: IopFeatures;
  iopMmHg: number | null;
  label: IopLabel;
  /** IOP-lowering or other eye drops: a likely confounder for redness and pupil size. */
  onEyeDrops: Medication;
  qualityFlags: string[];
  notes: string;
}

const STORAGE_KEY = 'iop-dataset-rows-v1';

export function labelFromIop(iopMmHg: number | null): IopLabel {
  if (iopMmHg === null || Number.isNaN(iopMmHg)) return 'unknown';
  return iopMmHg > HIGH_IOP_CUTOFF_MMHG ? 'high' : 'normal';
}

export function loadRows(): IopDatasetRow[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as IopDatasetRow[]) : [];
  } catch {
    return [];
  }
}

/** Returns false when the browser refused to store (private mode, quota). */
export function saveRows(rows: IopDatasetRow[]): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
    return true;
  } catch {
    return false;
  }
}

function csvCell(value: string | number | null): string {
  if (value === null) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const CSV_HEADER = [
  'id', 'created_at', 'participant_id', 'image_name', 'eye', 'geometry_source',
  ...FEATURE_ORDER, 'iop_mmhg', 'label', 'on_eye_drops', 'quality_flags', 'notes',
];

export function rowsToCsv(rows: IopDatasetRow[]): string {
  const lines = rows.map((row) =>
    [
      row.id, row.createdAt, row.participantId, row.imageName, row.eye, row.geometrySource,
      ...FEATURE_ORDER.map((key) => Number(row.features[key].toFixed(6))),
      row.iopMmHg, row.label, row.onEyeDrops, row.qualityFlags.join('|'), row.notes,
    ].map(csvCell).join(','),
  );
  return [CSV_HEADER.join(','), ...lines].join('\n');
}

export function downloadCsv(rows: IopDatasetRow[], filename = 'iop-features.csv'): void {
  const blob = new Blob([rowsToCsv(rows)], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
