import { offlineBackendUrl } from '@/lib/offlineGazeBackend';

/**
 * A left/right facial measurement. `left`/`right` are the subject's anatomical
 * sides. `weaker_side` is reported separately because a bare ratio cannot say
 * which side is affected, which is the clinically decisive part.
 */
export interface SideMeasure {
  left: number | null;
  right: number | null;
  ratio_weaker_over_stronger: number | null;
  weaker_side: 'left' | 'right' | null;
}

/**
 * Upper-face versus lower-face symmetry. Whether the forehead is involved is
 * the classic discriminator between an upper motor neuron lesion and a
 * peripheral facial nerve palsy, but the gap is reported raw: applying a
 * cut-off would be an unvalidated clinical claim.
 */
export interface UpperLowerComparison {
  symmetry_gap: number | null;
  same_weaker_side: boolean | null;
  interpretation: string;
}

export type FaceMetricValue = number | string | SideMeasure | UpperLowerComparison | null;

export function isSideMeasure(value: FaceMetricValue): value is SideMeasure {
  return typeof value === 'object' && value !== null && 'ratio_weaker_over_stronger' in value;
}

export function isUpperLowerComparison(value: FaceMetricValue): value is UpperLowerComparison {
  return typeof value === 'object' && value !== null && 'symmetry_gap' in value;
}

export interface QualityIssue {
  code: string;
  severity: 'blocking' | 'advisory';
  scope: string;
  message: string;
}

/** Per-frame left/right trace behind a facial summary number. */
export interface FaceSeries {
  label: string;
  unit: string;
  t_ms: number[];
  left: number[];
  right: number[];
  peak_t_ms: number;
}

export interface F0Contour {
  trial: number;
  start_s: number;
  step_s: number;
  /** null marks an unvoiced frame — a break in the line, not a drop to zero. */
  hz: (number | null)[];
}

export interface SpeechSeries {
  duration_s: number;
  envelope: number[];
  gate: number;
  trials_s: [number, number][];
  f0?: F0Contour[];
}

export interface FacialSpeechReport {
  version: string;
  /** `insufficient-quality` means the capture could not be measured. It is a
   * distinct outcome from a measurement that came back normal. */
  status: 'ok' | 'insufficient-quality';
  interpretation: string;
  quality: {
    passed: boolean;
    issues: QualityIssue[];
    flags: string[];
    face: Record<string, number | null>;
    speech: Record<string, { duration_s?: number; rms_dbfs?: number; clipping_ratio?: number; snr_db?: number | null } | undefined>;
  };
  timeline?: Record<string, unknown>;
  face: {
    available: boolean;
    metrics: Record<string, FaceMetricValue>;
    task_frame_counts: Record<string, number>;
    series: Record<string, FaceSeries>;
    /** Annotated stills as data: URIs, keyed rest / smile_peak / brow_peak / eye_closed. */
    key_frames: Record<string, string>;
  };
  speech: {
    tasks: Record<string, Record<string, unknown>>;
    asr: { available: boolean; reason?: string };
  };
}

/** Aggregate across repetitions: a median plus the spread between trials. */
export interface TrialAggregate {
  median: number | null;
  iqr: number | null;
  n_trials: number;
  per_trial: number[];
}

export function asTrialAggregate(value: unknown): TrialAggregate | null {
  if (typeof value !== 'object' || value === null || !('median' in value)) return null;
  const record = value as Record<string, unknown>;
  return {
    median: typeof record.median === 'number' ? record.median : null,
    iqr: typeof record.iqr === 'number' ? record.iqr : null,
    n_trials: typeof record.n_trials === 'number' ? record.n_trials : 0,
    per_trial: Array.isArray(record.per_trial) ? (record.per_trial as number[]) : [],
  };
}

export function asSpeechSeries(value: unknown): SpeechSeries | null {
  if (typeof value !== 'object' || value === null || !('envelope' in value)) return null;
  return value as SpeechSeries;
}

export interface FacialSpeechJob {
  id: string;
  status: 'queued' | 'processing' | 'complete' | 'failed';
  phase: string;
  progress: number;
  message: string;
  error?: string;
  report?: FacialSpeechReport;
}

export function facialSpeechHandlingEnabled(): boolean {
  const raw = process.env.NEXT_PUBLIC_FACIAL_SPEECH_OFFLINE_HANDLING;
  // Unlike gaze, this route has no meaningful realtime fallback. Process
  // automatically when the backend is available; set the variable to 0 to keep
  // export-only behaviour for data collection.
  if (raw === undefined || raw.trim() === '') return true;
  return !['0', 'false', 'no', 'off'].includes(raw.trim().toLowerCase());
}

/**
 * `fetch` rejects with a bare "Failed to fetch" for connection refused, DNS
 * failure and blocked CORS alike. Surfaced as-is it reads like the analysis
 * examined the capture and gave up, when in fact nothing was ever sent. Name
 * the address that could not be reached instead.
 */
async function backendFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = offlineBackendUrl();
  try {
    return await fetch(`${base}${path}`, init);
  } catch (cause) {
    throw new Error(
      `the offline analysis backend at ${base} is unreachable. Start it (cd backend && docker compose up -d) or point NEXT_PUBLIC_OFFLINE_GAZE_BACKEND_URL at where it runs. The capture is still on this page — download it, or retry once the backend is up.`,
      { cause },
    );
  }
}

export async function startFacialSpeechProcessing(video: Blob, payload: Record<string, unknown>): Promise<FacialSpeechJob> {
  if (!video.size) throw new Error('No capture video is available for offline analysis.');
  const form = new FormData();
  form.append('file', video, 'facial-speech.webm');
  form.append('payload', JSON.stringify(payload));
  const response = await backendFetch('/facial-speech/process', { method: 'POST', body: form });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(typeof detail?.detail === 'string' ? detail.detail : `Offline backend failed: HTTP ${response.status}`);
  }
  return response.json();
}

export async function getFacialSpeechJob(jobId: string): Promise<FacialSpeechJob> {
  const response = await backendFetch(`/facial-speech/jobs/${encodeURIComponent(jobId)}`);
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(typeof detail?.detail === 'string' ? detail.detail : `Unable to read processing status: HTTP ${response.status}`);
  }
  return response.json();
}
