/**
 * API client for backend (Next.js /api or optional NEXT_PUBLIC_API_URL).
 * With next dev / same origin: no env needed. Optional: set NEXT_PUBLIC_API_URL for different host.
 */

const getBaseUrl = (): string => {
  if (typeof window === 'undefined') return '';
  try {
    const url = (process.env as { NEXT_PUBLIC_API_URL?: string }).NEXT_PUBLIC_API_URL;
    if (url) return url.replace(/\/$/, '');
  } catch (_) {}
  return '';
};

export interface CreateSessionPayload {
  config?: Record<string, unknown>;
  /** Demographics at calibration time (age, gender, country, eyeConditions) */
  demographics?: { age?: number; gender?: string; country?: string; eyeConditions?: string[] };
  validationErrors?: number[];
  meanErrorPx?: number;
  status?: string;
  videoUrl?: string;
  calibrationImageUrls?: string[];
  calibrationGazeSamples?: Array<{
    screenX: number;
    screenY: number;
    features?: number[];
    timestamp?: number;
    head?: { valid: boolean; message: string; faceWidth?: number; minFaceWidth?: number; maxFaceWidth?: number; targetDistanceCm?: number };
    imageUrl?: string | null;
  }>;
}

export interface Session {
  id: string;
  createdAt: string;
  updatedAt: string;
  config: Record<string, unknown> | null;
  demographics: { age?: number; gender?: string; country?: string; eyeConditions?: string[] } | null;
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
  preSymptomScores?: Record<string, number> | null;
  postSymptomScores?: Record<string, number> | null;
  testResults?: Record<string, unknown> | null;
  status: string;
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
      preSymptomScores: Record<string, number>;
      postSymptomScores: Record<string, number>;
      testResults: Record<string, unknown>;
      status: string;
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
};

/** Upload a file (base64) to blob storage; returns URL. Skips upload if data is empty; returns null. */
export const uploadApi = {
  async upload(base64Data: string, filename: string, contentType?: string): Promise<string | null> {
    if (!base64Data || typeof base64Data !== 'string' || base64Data.length < 10) {
      return null;
    }
    const res = await fetch(`${getBaseUrl()}/api/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: base64Data, filename, contentType }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const msg = (errBody && typeof errBody.error === 'string') ? errBody.error : `Upload failed: ${res.status}`;
      throw new Error(msg);
    }
    const { url } = await res.json();
    return url ?? null;
  },

  /**
   * Upload via presigned URL (client PUTs directly to S3). Use for large files to avoid
   * Vercel 4.5 MB request body limit. Returns public URL or null if blob is empty.
   */
  async uploadBlob(blob: Blob, filename: string, contentType?: string): Promise<string | null> {
    if (!blob || blob.size === 0) return null;
    const baseUrl = getBaseUrl();
    let presignRes: Response;
    try {
      presignRes = await fetch(`${baseUrl}/api/upload/presign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, contentType: contentType || blob.type }),
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
};
