/**
 * GET /api/admin/signed-url?url=<encoded-s3-url>
 * Returns { url: presignedGetUrl } for the S3 object. Admin auth required.
 * Use for video/images that would otherwise 403 (private bucket).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAdminCookieName, verifyAdminToken } from '@/lib/admin-auth';
import { getPresignedGetUrl } from '@/lib/s3SignedUrl';

export async function GET(request: NextRequest) {
  try {
    const cookieName = getAdminCookieName();
    const token = request.cookies.get(cookieName)?.value;
    if (!token) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const payload = await verifyAdminToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const rawUrl = searchParams.get('url');
    if (!rawUrl) {
      return NextResponse.json({ error: 'Missing url query' }, { status: 400 });
    }
    const objectUrl = decodeURIComponent(rawUrl);
    const signed = await getPresignedGetUrl(objectUrl);
    if (!signed) {
      return NextResponse.json({ error: 'Invalid S3 URL or failed to sign' }, { status: 400 });
    }
    return NextResponse.json({ url: signed });
  } catch (e) {
    const err = e as Error;
    console.error('[api/admin/signed-url]', err);
    return NextResponse.json({ error: 'Failed to generate signed URL' }, { status: 500 });
  }
}
