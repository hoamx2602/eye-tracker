import type { SessionMeta } from '@/lib/calibrationMeta';

export function offlineHandlingEnabled(): boolean {
  const raw = process.env.NEXT_PUBLIC_OFFLINE_HANDLING ?? '';
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

export interface OfflineGazeProcessResponse {
  calibration_train_rmse_px: number;
  calibration_loocv_px: number;
  calibration_region_errors_px: Record<string, number>;
  calibration_degree: number;
  calibration_dots_used: number;
  calibration_dots_total: number;
  head_compensation_applied: boolean;
  head_motion: Record<string, number>;
  biomarkers: {
    n_samples: number;
    valid_ratio: number;
    saccade_count: number;
    saccade_peak_velocity_deg_s: number;
    saccade_mean_amplitude_deg: number;
    fixation_count: number;
    fixation_mean_duration_ms: number;
    bcea_deg2: number;
  };
  gaze_trace?: Array<{ t_ms: number; x: number; y: number }>;
  validation?: {
    n_points: number;
    overall_px: number;
    overall_deg: number;
    overall_px_raw?: number;
    overall_deg_raw?: number;
    region_px?: Record<string, number>;
    region_deg?: Record<string, number>;
    by_quality?: Record<string, Record<string, number>>;
  } | null;
}

export function offlineBackendUrl(): string {
  const configured = process.env.NEXT_PUBLIC_OFFLINE_GAZE_BACKEND_URL;
  return (configured && configured.trim() ? configured : 'http://localhost:8000').replace(/\/$/, '');
}

export async function processOfflineGaze(
  videoBlob: Blob,
  meta: SessionMeta,
  opts: { includeTrace?: boolean; personalize?: boolean } = {},
): Promise<OfflineGazeProcessResponse> {
  if (!videoBlob || videoBlob.size === 0) {
    throw new Error('No recorded calibration video to process offline.');
  }
  const form = new FormData();
  form.append('file', videoBlob, 'calibration.webm');
  form.append('payload', JSON.stringify({
    ...meta,
    // FastAPI /process currently ignores unknown fields, but keeping the shape
    // close to reprocess.py means validation_dots can be used for accuracy A/B.
    validation_dots: meta.validation_dots,
  }));
  form.append('include_trace', opts.includeTrace ? 'true' : 'false');

  const res = await fetch(`${offlineBackendUrl()}/process`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    const msg =
      detail && typeof detail.detail === 'string'
        ? detail.detail
        : `Offline backend failed: HTTP ${res.status}`;
    throw new Error(msg);
  }
  return res.json();
}
