/**
 * GET  /api/admin/app-config — get app config. Admin auth required.
 * PUT  /api/admin/app-config — update app config (upsert). Admin auth required.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAdminCookieName, verifyAdminToken } from '@/lib/admin-auth';
import { prisma } from '@/lib/prisma';
import { DEFAULT_CONFIG } from '@/types';
import type { AppConfig } from '@/types';

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
    const row = await prisma.appConfig.findUnique({
      where: { name: 'default' },
    });

    if (!row || !row.config || typeof row.config !== 'object') {
      return NextResponse.json({ config: DEFAULT_CONFIG });
    }

    const config = { ...DEFAULT_CONFIG, ...(row.config as object) };
    return NextResponse.json({ config });
  } catch (e) {
    console.error('[api/admin/app-config GET]', e);
    return NextResponse.json({ error: 'Failed to load config' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }

    const config = { ...DEFAULT_CONFIG, ...body } as AppConfig;

    await prisma.appConfig.upsert({
      where: { name: 'default' },
      create: { name: 'default', config: config as any },
      update: { config: config as any },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[api/admin/app-config PUT]', e);
    return NextResponse.json({ error: 'Failed to save config' }, { status: 500 });
  }
}
