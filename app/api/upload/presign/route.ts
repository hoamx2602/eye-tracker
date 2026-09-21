/**
 * POST /api/upload/presign — get a presigned S3 PUT URL for direct browser upload.
 * Body: { filename: string, contentType?: string }
 * Returns: { uploadUrl, publicUrl }
 * Client PUTs the file (blob) to uploadUrl, then uses publicUrl in the session.
 * Avoids Vercel 4.5 MB request body limit by not sending file data through the server.
 *
 * This is the right route for the face-capture images, and the fallback for the
 * calibration video when the streaming upload in `lib/chunkedUpload.ts` cannot
 * be used. Keying and URL derivation are shared with the multipart route via
 * `lib/s3Server.ts` so the two cannot disagree about where an object lives.
 *
 * S3 bucket must allow CORS from your app origin, e.g.:
 * [{"AllowedOrigins": ["https://your-app.vercel.app", "http://localhost:3000"],
 *   "AllowedMethods": ["PUT", "GET"], "AllowedHeaders": ["*"],
 *   "ExposeHeaders": ["ETag"]}]
 * ExposeHeaders is what the multipart upload needs; without it that path falls
 * back to sending the whole video as one PUT through here.
 */
import { NextRequest, NextResponse } from 'next/server';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  buildKey,
  contentTypeFor,
  credentialsConfigured,
  getBucket,
  getPublicUrl,
  getS3Client,
} from '@/lib/s3Server';

export async function POST(request: NextRequest) {
  const bucket = getBucket();
  if (!bucket) {
    return NextResponse.json({ error: 'S3_BUCKET not configured' }, { status: 500 });
  }
  if (!credentialsConfigured()) {
    return NextResponse.json({ error: 'AWS credentials not configured' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { filename, contentType } = body as { filename?: string; contentType?: string };
    if (!filename || typeof filename !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid filename' }, { status: 400 });
    }

    const key = buildKey(filename);
    const s3 = getS3Client();
    const putCommand = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentTypeFor(filename, contentType),
      ...(process.env.S3_ACL_PUBLIC_READ === '1' ? { ACL: 'public-read' as const } : {}),
    });
    const uploadUrl = await getSignedUrl(s3, putCommand, { expiresIn: 300 });

    const publicUrl = getPublicUrl(key);
    if (!publicUrl) return NextResponse.json({ error: 'Could not build public URL' }, { status: 500 });

    return NextResponse.json({ uploadUrl, publicUrl });
  } catch (e) {
    const err = e as Error;
    console.error('[api/upload/presign]', err);
    return NextResponse.json({ error: 'Failed to create presigned URL' }, { status: 500 });
  }
}
