/**
 * GET  /api/sessions     — list sessions (optional query: limit, cursor)
 * POST /api/sessions     — create session (body: config?, validationErrors?, meanErrorPx?, status?)
 */
import { prisma } from '../lib/prisma.js';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.VERCEL ? '*' : (process.env.FRONTEND_ORIGIN || '*'));
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const limit = Math.min(parseInt(req.query?.limit || '50', 10), 100);
      const cursor = req.query?.cursor || undefined;
      const sessions = await prisma.session.findMany({
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { createdAt: 'desc' },
      });
      const hasMore = sessions.length > limit;
      const list = hasMore ? sessions.slice(0, limit) : sessions;
      const nextCursor = hasMore ? list[list.length - 1].id : null;
      return res.status(200).json({ sessions: list, nextCursor });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const {
        config,
        validationErrors,
        meanErrorPx,
        status,
        videoUrl,
        calibrationImageUrls,
        calibrationGazeSamples,
      } = body;
      const session = await prisma.session.create({
        data: {
          config: config ?? undefined,
          validationErrors: Array.isArray(validationErrors) ? validationErrors : [],
          meanErrorPx: typeof meanErrorPx === 'number' ? meanErrorPx : null,
          status: typeof status === 'string' ? status : 'completed',
          videoUrl: typeof videoUrl === 'string' ? videoUrl : null,
          calibrationImageUrls: Array.isArray(calibrationImageUrls) ? calibrationImageUrls : null,
          calibrationGazeSamples:
            Array.isArray(calibrationGazeSamples) || calibrationGazeSamples === null
              ? calibrationGazeSamples
              : undefined,
        },
      });
      return res.status(201).json(session);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[api/sessions]', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
