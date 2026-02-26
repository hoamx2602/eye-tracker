/**
 * API client for backend (Vercel serverless /api).
 * Base URL: VITE_API_URL or same origin (for Vercel deploy).
 */

const getBaseUrl = (): string => {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) {
    return (import.meta.env as { VITE_API_URL?: string }).VITE_API_URL.replace(/\/$/, '');
  }
  return ''; // same origin → /api/...
};

export interface CreateSessionPayload {
  config?: Record<string, unknown>;
  validationErrors?: number[];
  meanErrorPx?: number;
  status?: string;
}

export interface Session {
  id: string;
  createdAt: string;
  updatedAt: string;
  config: Record<string, unknown> | null;
  validationErrors: number[];
  meanErrorPx: number | null;
  status: string | null;
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
