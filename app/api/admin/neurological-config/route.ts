/**
 * GET  /api/admin/neurological-config — get config (default or ?name=...). Admin auth required.
 * PUT  /api/admin/neurological-config — update config (upsert). Admin auth required. Validates body.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAdminCookieName, verifyAdminToken } from '@/lib/admin-auth';
import { prisma } from '@/lib/prisma';
import { getDefaultConfigSnapshot, DEFAULT_TEST_ORDER } from '@/lib/neurologicalConfig';

const VALID_TEST_IDS = new Set<string>([...DEFAULT_TEST_ORDER]);

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

    let testOrder: string[] | undefined;
    if (body.testOrder !== undefined) {
      if (!Array.isArray(body.testOrder)) {
        return NextResponse.json({ error: 'testOrder must be an array' }, { status: 400 });
      }
      const arr = body.testOrder as unknown[];
      if (arr.some((x) => typeof x !== 'string')) {
        return NextResponse.json({ error: 'testOrder must contain only strings' }, { status: 400 });
      }
      const ids = arr as string[];
      if (ids.some((id) => !VALID_TEST_IDS.has(id))) {
        return NextResponse.json(
          { error: `testOrder may only contain valid test ids: ${[...VALID_TEST_IDS].join(', ')}` },
          { status: 400 }
        );
      }
      testOrder = ids;
    }

    let testParameters: Record<string, unknown> | undefined;
    if (body.testParameters !== undefined) {
      if (body.testParameters === null || typeof body.testParameters !== 'object' || Array.isArray(body.testParameters)) {
        return NextResponse.json({ error: 'testParameters must be an object' }, { status: 400 });
      }
      testParameters = body.testParameters as Record<string, unknown>;
    }

    let testEnabled: Record<string, boolean> | undefined;
    if (body.testEnabled !== undefined) {
      if (body.testEnabled === null || typeof body.testEnabled !== 'object' || Array.isArray(body.testEnabled)) {
        return NextResponse.json({ error: 'testEnabled must be an object' }, { status: 400 });
      }
      const en = body.testEnabled as Record<string, unknown>;
      if (Object.values(en).some((v) => typeof v !== 'boolean')) {
        return NextResponse.json({ error: 'testEnabled values must be boolean' }, { status: 400 });
      }
      testEnabled = en as Record<string, boolean>;
    }

    const defaultSnap = getDefaultConfigSnapshot();
    const createPayload = {
      name,
      testOrder: testOrder ?? defaultSnap.testOrder,
      testParameters: (testParameters ?? defaultSnap.testParameters) as object,
      testEnabled: (testEnabled ?? defaultSnap.testEnabled) as object,
    };

    const updatePayload: { testOrder?: string[]; testParameters?: object; testEnabled?: object } = {};
    if (testOrder !== undefined) updatePayload.testOrder = testOrder;
    if (testParameters !== undefined) updatePayload.testParameters = testParameters;
    if (testEnabled !== undefined) updatePayload.testEnabled = testEnabled;

    const row = await prisma.neurologicalTestConfig.upsert({
      where: { name },
      create: createPayload,
      update: Object.keys(updatePayload).length > 0 ? updatePayload : { updatedAt: new Date() },
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
