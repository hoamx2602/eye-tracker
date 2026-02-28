/**
 * API client for backend (Vercel serverless /api).
 * Base URL: VITE_API_URL or same origin (for Vercel deploy).
 */

const getBaseUrl = (): string => {
  try {
    const env = (import.meta as unknown as { env?: { VITE_API_URL?: string } }).env;
    if (env?.VITE_API_URL) return env.VITE_API_URL.replace(/\/$/, '');
  } catch (_) {}
  return '';
};

export interface CreateSessionPayload {
  config?: Record<string, unknown>;
  validationErrors?: number[];
  meanErrorPx?: number;
  status?: string;
  videoUrl?: string;
  calibrationImageUrls?: string[];
  calibrationGazeSamples?: Array<{ screenX: number; screenY: number; features?: number[]; timestamp?: number }>;
}

export interface Session {
  id: string;
  createdAt: string;
  updatedAt: string;
  config: Record<string, unknown> | null;
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

/** Upload a file (base64) to blob storage; returns URL. */
export const uploadApi = {
  async upload(base64Data: string, filename: string, contentType?: string): Promise<string> {
    const res = await fetch(`${getBaseUrl()}/api/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: base64Data, filename, contentType }),
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    const { url } = await res.json();
    return url;
  },
};
