import type { SessionMeta } from '@/lib/calibrationMeta';

const TRUTHY = ['1', 'true', 'yes', 'on'];

export function offlineHandlingEnabled(): boolean {
  return TRUTHY.includes((process.env.NEXT_PUBLIC_OFFLINE_HANDLING ?? '').trim().toLowerCase());
}

/**
 * Opt-in per-subject fine-tuning (NEXT_PUBLIC_OFFLINE_PERSONALIZE=1).
 *
 * Off by default because it costs minutes of GPU time per session and
 * serialises requests on the backend. The backend keeps the fine-tuned weights
 * only when they beat the baseline on held-out dots, so enabling it cannot make
 * a session's reported accuracy worse — only slower.
 */
export function offlinePersonalizationEnabled(): boolean {
  return TRUTHY.includes((process.env.NEXT_PUBLIC_OFFLINE_PERSONALIZE ?? '').trim().toLowerCase());
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
  /** Parallax gain actually applied (0 = compensation off). */
  head_comp_gain?: number;
  /** Per-gain held-out error sweep and the winner, when the gain was auto-picked. */
  head_comp_gain_selection?: {
    mode: string;
    chosen: number;
    reason?: string;
    sweep_px?: Record<string, number>;
  } | null;
  /** Per-subject fine-tuning outcome, when `personalize` was requested. */
  personalization?: {
    kept?: boolean;
    applied?: boolean;
    reason?: string;
    n_dots?: number;
    n_crops?: number;
    [k: string]: unknown;
  } | null;
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
    validation_dots: meta.validation_dots,
    // Per-subject fine-tuning is a payload field, not a form field. It used to
    // be accepted here and then silently dropped, which is why no session has
    // ever come back with a personalization result.
    personalize: opts.personalize ?? false,
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
