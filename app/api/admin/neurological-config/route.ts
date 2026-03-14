/**
 * GET  /api/admin/neurological-config — get config (default or ?name=...). Admin auth required.
 * PUT  /api/admin/neurological-config — update config (upsert). Admin auth required.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAdminCookieName, verifyAdminToken } from '@/lib/admin-auth';
import { prisma } from '@/lib/prisma';
import { getDefaultConfigSnapshot } from '@/lib/neurologicalConfig';

async function requireAdmin(request: NextRequest) {
  const cookieName = getAdminCookieName();
  const token = request.cookies.get(cookieName)?.value;
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const payload = await verifyAdminToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
  return null;
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name') || 'default';

    const row = await prisma.neurologicalTestConfig.findUnique({
      where: { name },
    });

    if (!row) {
      const defaultSnap = getDefaultConfigSnapshot();
      return NextResponse.json({
        id: null,
        name,
        testOrder: defaultSnap.testOrder,
        testParameters: defaultSnap.testParameters,
        testEnabled: defaultSnap.testEnabled,
      });
    }

    const testOrder = Array.isArray(row.testOrder) ? row.testOrder : (row.testOrder as unknown) as string[];
    const testParameters = (row.testParameters as Record<string, unknown>) ?? {};
    const testEnabled = (row.testEnabled as Record<string, boolean>) ?? {};

    return NextResponse.json({
      id: row.id,
      name: row.name,
      testOrder,
      testParameters,
      testEnabled,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  } catch (e) {
    console.error('[api/admin/neurological-config GET]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json().catch(() => ({}));
    const name = typeof body.name === 'string' ? body.name : 'default';
    const testOrder = Array.isArray(body.testOrder) ? body.testOrder : undefined;
    const testParameters =
      body.testParameters != null && typeof body.testParameters === 'object'
        ? (body.testParameters as Record<string, unknown>)
        : undefined;
    const testEnabled =
      body.testEnabled != null && typeof body.testEnabled === 'object'
        ? (body.testEnabled as Record<string, boolean>)
        : undefined;

    const data: { name: string; testOrder?: unknown; testParameters?: unknown; testEnabled?: unknown } = {
      name,
    };
    if (testOrder !== undefined) data.testOrder = testOrder;
    if (testParameters !== undefined) data.testParameters = testParameters;
    if (testEnabled !== undefined) data.testEnabled = testEnabled;

    const row = await prisma.neurologicalTestConfig.upsert({
      where: { name },
      create: {
        name,
        testOrder: data.testOrder ?? getDefaultConfigSnapshot().testOrder,
        testParameters: data.testParameters ?? getDefaultConfigSnapshot().testParameters,
        testEnabled: data.testEnabled ?? getDefaultConfigSnapshot().testEnabled,
      },
      update: {
        ...(data.testOrder !== undefined && { testOrder: data.testOrder }),
        ...(data.testParameters !== undefined && { testParameters: data.testParameters }),
        ...(data.testEnabled !== undefined && { testEnabled: data.testEnabled }),
      },
    });

    return NextResponse.json({
      id: row.id,
      name: row.name,
      testOrder: row.testOrder,
      testParameters: row.testParameters,
      testEnabled: row.testEnabled,
      updatedAt: row.updatedAt,
    });
  } catch (e) {
    console.error('[api/admin/neurological-config PUT]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
