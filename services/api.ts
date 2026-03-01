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
};
