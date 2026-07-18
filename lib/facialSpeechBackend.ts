import { offlineBackendUrl } from '@/lib/offlineGazeBackend';

export interface FacialSpeechReport {
  version: string;
  interpretation: string;
  quality: {
    passed: boolean;
    flags: string[];
    face: Record<string, number | null>;
    speech: Record<string, { duration_s?: number; rms_dbfs?: number; clipping_ratio?: number } | undefined>;
  };
  face: { metrics: Record<string, number | null>; task_frame_counts: Record<string, number> };
  speech: {
    tasks: Record<string, Record<string, unknown>>;
    asr: { available: boolean; reason?: string };
  };
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

export async function startFacialSpeechProcessing(video: Blob, payload: Record<string, unknown>): Promise<FacialSpeechJob> {
  if (!video.size) throw new Error('No capture video is available for offline analysis.');
  const form = new FormData();
  form.append('file', video, 'facial-speech.webm');
  form.append('payload', JSON.stringify(payload));
  const response = await fetch(`${offlineBackendUrl()}/facial-speech/process`, { method: 'POST', body: form });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(typeof detail?.detail === 'string' ? detail.detail : `Offline backend failed: HTTP ${response.status}`);
  }
  return response.json();
}

export async function getFacialSpeechJob(jobId: string): Promise<FacialSpeechJob> {
  const response = await fetch(`${offlineBackendUrl()}/facial-speech/jobs/${encodeURIComponent(jobId)}`);
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(typeof detail?.detail === 'string' ? detail.detail : `Unable to read processing status: HTTP ${response.status}`);
  }
  return response.json();
}
