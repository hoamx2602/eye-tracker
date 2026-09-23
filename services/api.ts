/**
 * API client for backend (Next.js /api or optional NEXT_PUBLIC_API_URL).
 * With next dev / same origin: no env needed. Optional: set NEXT_PUBLIC_API_URL for different host.
 */

import type { SampleQuality } from '../types';

export const getBaseUrl = (): string => {
  if (typeof window === 'undefined') return '';
  try {
    const url = (process.env as { NEXT_PUBLIC_API_URL?: string }).NEXT_PUBLIC_API_URL;
    if (url) return url.replace(/\/$/, '');
  } catch (_) {}
  return '';
};

/**
 * The named, human-readable eye/head measurement a sample was captured with —
 * kept alongside `features` (the flattened regression vector) rather than
 * instead of it. `features` is what this session's model actually trained on
 * and is worth keeping exactly as it was; `rawEyeFeatures` is what makes the
 * sample useful to a *different* feature-vector design later without needing
 * to re-run MediaPipe on the video. Both are a few hundred bytes — the video
 * is what upload time is spent on, not this.
 */
export interface RawEyeFeaturesPayload {
  leftRelative: { x: number; y: number };
  rightRelative: { x: number; y: number };
  headPose: { pitch: number; yaw: number; roll: number };
  zDistance: number;
  leftEAR: number;
  rightEAR: number;
  blendshapes?: Record<string, number>;
  matrixHeadPose?: { pitch: number; yaw: number; roll: number };
}

export interface CreateSessionPayload {
  config?: Record<string, unknown>;
  /** Demographics at calibration time (age, gender, country, eyeConditions) */
  demographics?: { age?: number; gender?: string; email?: string; country?: string; eyeConditions?: string[] };
  /** Participant email, also stored in its own indexed column for lookup. */
  participantEmail?: string;
  validationErrors?: number[];
  meanErrorPx?: number;
  status?: string;
  videoUrl?: string | null;
  calibrationImageUrls?: string[];
  calibrationGazeSamples?: Array<{
    screenX: number;
    screenY: number;
    features?: number[];
    rawEyeFeatures?: RawEyeFeaturesPayload;
    timestamp?: number;
    head?: { valid: boolean; message: string; faceWidth?: number; minFaceWidth?: number; maxFaceWidth?: number; targetDistanceCm?: number };
    imageUrl?: string | null;
    patternName?: string;
    /** How the sample was collected (fixation / pursuit, frames, precision). See types.ts SampleQuality. */
    quality?: SampleQuality;
  }> | null;
  /** Per-dot video-clock windows for offline reprocessing. See lib/calibrationMeta.ts. */
  calibrationMeta?: Record<string, unknown>;
}

export interface Session {
  id: string;
  createdAt: string;
  updatedAt: string;
  config: Record<string, unknown> | null;
  demographics: { age?: number; gender?: string; email?: string; country?: string; eyeConditions?: string[]; wearsGlasses?: boolean; device?: string } | null;
  participantEmail?: string | null;
  validationErrors: number[];
  meanErrorPx: number | null;
  status: string | null;
  videoUrl: string | null;
  calibrationImageUrls: string[] | null;
  calibrationGazeSamples: unknown;
}

/** Neurological run (ticket 14 / 12). */
export interface NeurologicalRun {
  id: string;
  sessionId: string;
  configSnapshot?: { testOrder: string[]; testParameters: Record<string, unknown>; testEnabled: Record<string, boolean> } | null;
  testOrderSnapshot?: string[] | null;
  preSymptomScores?: unknown;
  postSymptomScores?: unknown;
  testResults?: Record<string, unknown> | null;
  status: string;
  /** One continuous recording spanning the 7 tests. See NEURO_RECORD_VIDEO_ENABLED in lib/recordingConfig.ts. */
  videoUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Public default config (testOrder, testParameters, testEnabled) for run creation. */
export async function getNeurologicalConfig(): Promise<{
  testOrder: string[];
  testParameters: Record<string, unknown>;
  testEnabled: Record<string, boolean>;
}> {
  const url = `${getBaseUrl()}/api/neurological-config?t=${Date.now()}`;
  const res = await fetch(url, { cache: 'no-store', credentials: 'include' });
  if (!res.ok) throw new Error('Failed to load neurological config');
  return res.json();
}

export const neurologicalRunsApi = {
  async get(id: string): Promise<NeurologicalRun> {
    const res = await fetch(`${getBaseUrl()}/api/neurological-runs/${id}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Get run failed: ${res.status}`);
    return res.json();
  },

  async create(
    sessionId: string,
    configSnapshot?: { testOrder: string[]; testParameters: Record<string, unknown>; testEnabled: Record<string, boolean> }
  ): Promise<NeurologicalRun> {
    const res = await fetch(`${getBaseUrl()}/api/neurological-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(configSnapshot ? { sessionId, configSnapshot } : { sessionId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(typeof err.error === 'string' ? err.error : `Create run failed: ${res.status}`);
    }
    return res.json();
  },

  async patch(
    id: string,
    data: Partial<{
      preSymptomScores: unknown;
      postSymptomScores: unknown;
      testResults: Record<string, unknown>;
      status: string;
      videoUrl: string | null;
    }>
  ): Promise<NeurologicalRun> {
    const res = await fetch(`${getBaseUrl()}/api/neurological-runs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Patch run failed: ${res.status}`);
    return res.json();
  },
};

export const sessionsApi = {
  async list(limit = 50, cursor?: string): Promise<{ sessions: Session[]; nextCursor: string | null }> {
    const url = new URL(`${getBaseUrl()}/api/sessions`);
    url.searchParams.set('limit', String(limit));
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Sessions list failed: ${res.status}`);
    return res.json();
  },

  async get(id: string): Promise<Session> {
    const res = await fetch(`${getBaseUrl()}/api/sessions/${id}`);
    if (!res.ok) throw new Error(`Session get failed: ${res.status}`);
    return res.json();
  },

  async create(payload: CreateSessionPayload): Promise<Session> {
    const res = await fetch(`${getBaseUrl()}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Session create failed: ${res.status}`);
    return res.json();
  },

  /**
   * Patch an in-progress session — called at every break, and for the final
   * save once a session already exists. `calibrationGazeSamples` and
   * `calibrationImageUrls` are always the complete current arrays, not a
   * delta: the server plainly overwrites the column with whatever is sent.
   *
   * Throws (rather than swallowing) on a completed-session rejection (400) so
   * callers can tell "nothing changed because it's already done" apart from a
   * real failure.
   */
  async update(id: string, payload: Partial<CreateSessionPayload>): Promise<Session> {
    const res = await fetch(`${getBaseUrl()}/api/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(typeof err.error === 'string' ? err.error : `Session update failed: ${res.status}`);
    }
    return res.json();
  },
};

/**
 * Who an upload belongs to — required on every upload call. The server
 * checks this against the database (a real, still-open Session or
 * NeurologicalRun) before it will hand out a presigned URL or open a
 * multipart upload, so a call with no participant behind it — someone who
 * found these endpoints and is calling them directly, not through the
 * assessment itself — has nothing valid to claim ownership of.
 */
export type UploadOwner = { type: 'session' | 'run'; id: string };

export const uploadApi = {
  /**
   * Upload via presigned URL (client PUTs directly to S3). Use for large files to avoid
   * Vercel 4.5 MB request body limit. Returns public URL or null if blob is empty.
   */
  async uploadBlob(
    blob: Blob,
    filename: string,
    contentType: string | undefined,
    owner: UploadOwner
  ): Promise<string | null> {
    if (!blob || blob.size === 0) return null;
    const baseUrl = getBaseUrl();
    let presignRes: Response;
    try {
      presignRes = await fetch(`${baseUrl}/api/upload/presign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename,
          contentType: contentType || blob.type,
          ownerType: owner.type,
          ownerId: owner.id,
        }),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'Failed to fetch' || msg.includes('fetch')) {
        throw new Error(
          'Cannot reach API (check network or CORS). On Vercel: do not set NEXT_PUBLIC_API_URL.'
        );
      }
      throw e;
    }
    if (!presignRes.ok) {
      const errBody = await presignRes.json().catch(() => ({}));
      const msg = (errBody && typeof errBody.error === 'string') ? errBody.error : `Presign failed: ${presignRes.status}`;
      throw new Error(msg);
    }
    const { uploadUrl, publicUrl } = await presignRes.json();
    if (!uploadUrl || !publicUrl) throw new Error('Invalid presign response');
    try {
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        body: blob,
        headers: { 'Content-Type': contentType || blob.type || 'application/octet-stream' },
      });
      if (!putRes.ok) throw new Error(`Upload failed: ${putRes.status}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'Failed to fetch' || msg.includes('fetch')) {
        throw new Error(
          'S3 upload blocked. Configure CORS on your S3 bucket: add origin https://eye-tracker-hoamx.vercel.app (and http://localhost:3000 for dev), AllowedMethods: PUT, GET.'
        );
      }
      throw e;
    }
    return publicUrl;
  },

  /**
   * Best-effort cleanup for objects already uploaded that a "Try again" is
   * about to make obsolete. Never throws — a failed cleanup is a few KB of
   * S3 storage, not a reason to interrupt or alarm the participant.
   */
  async deleteBlobs(urls: string[]): Promise<void> {
    const list = urls.filter((u): u is string => typeof u === 'string' && u.length > 0);
    if (list.length === 0) return;
    try {
      await fetch(`${getBaseUrl()}/api/upload/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: list }),
      });
    } catch (e) {
      console.warn('[uploadApi.deleteBlobs] cleanup failed, orphaned in S3', e);
    }
  },
};
