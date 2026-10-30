/**
 * GET /api/doctor/neurological-runs/[id] — fetch a single run with session context.
 * Doctor auth required; only the doctor the run's session belongs to may read it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { userFromRequest } from '@/lib/request-auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await userFromRequest(request);
  if (!user || user.role !== 'DOCTOR') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

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
            participantEmail: true,
            config: true,
            doctorId: true,
          },
        },
      },
    });
    if (!run || run.session?.doctorId !== user.sub) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }
    return NextResponse.json(run);
  } catch (e) {
    console.error('[api/doctor/neurological-runs/[id] GET]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
