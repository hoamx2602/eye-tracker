/**
 * GET /api/admin/participants/[email] — every Session this email has, newest
 * first, each with its NeurologicalRun summary if it has one. Admin auth
 * required.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAdminCookieName, verifyAdminToken } from '@/lib/admin-auth';
import { prisma } from '@/lib/prisma';

async function requireAdmin(request: NextRequest) {
  const cookieName = getAdminCookieName();
  const token = request.cookies.get(cookieName)?.value;
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const payload = await verifyAdminToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ email: string }> }
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { email: rawEmail } = await params;
    // Sessions are stored trimmed+lowercased at creation (see POST
    // /api/sessions) — normalize the lookup the same way so a link built
    // from any casing still finds the same participant.
    const email = decodeURIComponent(rawEmail).trim().toLowerCase();
    if (!email) return NextResponse.json({ error: 'Missing email' }, { status: 400 });

    const sessions = await prisma.session.findMany({
      where: { participantEmail: email },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        status: true,
        meanErrorPx: true,
        demographics: true,
        videoUrl: true,
        neurologicalRun: {
          select: { id: true, status: true, createdAt: true },
        },
      },
    });

    if (sessions.length === 0) {
      return NextResponse.json({ error: 'No sessions found for this participant' }, { status: 404 });
    }

    return NextResponse.json({ email, sessions });
  } catch (e) {
    console.error('[api/admin/participants/[email] GET]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
