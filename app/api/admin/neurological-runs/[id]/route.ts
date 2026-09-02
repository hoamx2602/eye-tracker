/**
 * GET /api/admin/neurological-runs/[id] — fetch a single run with session context.
 * Admin auth required.
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
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const run = await prisma.neurologicalRun.findUnique({
      where: { id },
      include: {
        session: {
          select: {
            id: true,
            meanErrorPx: true,
            demographics: true,
          },
        },
      },
    });
    if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    return NextResponse.json(run);
  } catch (e) {
    console.error('[api/admin/neurological-runs/[id] GET]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
