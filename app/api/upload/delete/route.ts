/**
 * POST /api/upload/delete — remove objects this app itself uploaded.
 *
 * Body: { urls: string[] } — public URLs as returned by the upload routes.
 *
 * Exists for one case: a participant presses "Try again" on a calibration
 * step. The images already sent to S3 for that attempt are about to be
 * replaced by a fresh recording, and without this they stay in the bucket
 * forever — nothing in Postgres ever points at them, so there is no later
 * way to tell a genuine orphan from a real sample. Best-effort by design:
 * failing to clean up costs a few KB of storage, so a failure here is logged
 * and swallowed rather than surfaced to the participant.
 *
 * Every URL is resolved back to a key and checked against the same
 * managed-prefix rule the presigned-upload routes enforce, so this can only
 * ever delete objects under calibration/ — never an arbitrary key a caller
 * might pass in.
 */
import { NextRequest, NextResponse } from 'next/server';
import { DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { credentialsConfigured, getBucket, getS3Client, keyFromPublicUrl } from '@/lib/s3Server';

export async function POST(request: NextRequest) {
  const bucket = getBucket();
  if (!bucket || !credentialsConfigured()) {
    // Not an error worth surfacing — cleanup is best-effort and the caller
    // does not block on it.
    return NextResponse.json({ deleted: 0, skipped: 0 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const urls = Array.isArray(body.urls) ? body.urls : [];

    const keys: string[] = [];
    let skipped = 0;
    for (const url of urls) {
      const key = keyFromPublicUrl(url);
      if (key) keys.push(key);
      else skipped++;
    }

    if (keys.length === 0) {
      return NextResponse.json({ deleted: 0, skipped });
    }

    const s3 = getS3Client();
    // DeleteObjects takes at most 1000 keys per call; a single "try again"
    // never produces anywhere near that many images.
    const batch = keys.slice(0, 1000);
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      })
    );

    return NextResponse.json({ deleted: batch.length, skipped: skipped + (keys.length - batch.length) });
  } catch (e) {
    console.error('[api/upload/delete]', e);
    // Cleanup failing is not the participant's problem.
    return NextResponse.json({ deleted: 0, skipped: 0 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200 });
}
