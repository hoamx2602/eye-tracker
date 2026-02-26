/**
 * GET /api/sessions/[id] — get one session by id
 */
import { prisma } from '../lib/prisma.js';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.VERCEL ? '*' : (process.env.FRONTEND_ORIGIN || '*'));
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  try {
    const session = await prisma.session.findUnique({ where: { id } });
    if (!session) return res.status(404).json({ error: 'Not found' });
    return res.status(200).json(session);
  } catch (e) {
    console.error('[api/sessions/[id]]', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
