/**
 * POST /api/upload/presign — get a presigned S3 PUT URL for direct browser upload.
 * Body: { filename: string, contentType?: string }
 * Returns: { uploadUrl, publicUrl }
 * Client PUTs the file (blob) to uploadUrl, then uses publicUrl in the session.
 * Avoids Vercel 4.5 MB request body limit by not sending file data through the server.
 *
 * S3 bucket must allow CORS from your app origin, e.g.:
 * [{"AllowedOrigins": ["https://your-app.vercel.app", "http://localhost:3000"],
 *   "AllowedMethods": ["PUT", "GET"], "AllowedHeaders": ["*"]}]
 */
import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

function getS3Client() {
  const region = process.env.AWS_REGION || 'us-east-1';
  return new S3Client({
    region,
    credentials:
      process.env.AWS_ACCESS_KEY_ID
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
          }
        : undefined,
  });
}

function getPublicUrl(key: string) {
  const bucket = process.env.S3_BUCKET;
  const region = process.env.AWS_REGION || 'us-east-1';
  if (!bucket) return null;
  const domain =
    region === 'us-east-1'
      ? `https://${bucket}.s3.amazonaws.com`
      : `https://${bucket}.s3.${region}.amazonaws.com`;
  return `${domain}/${key}`;
}

export async function POST(request: NextRequest) {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    return NextResponse.json({ error: 'S3_BUCKET not configured' }, { status: 500 });
  }
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    return NextResponse.json(
      { error: 'AWS credentials not configured' },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { filename, contentType } = body as { filename?: string; contentType?: string };
    if (!filename || typeof filename !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid filename' }, { status: 400 });
    }

    const ext = filename.includes('.') ? filename.split('.').pop() : '';
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `calibration/${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${safeName}`;
    const resolvedContentType = contentType || (ext === 'webm' ? 'video/webm' : 'image/jpeg');

    const s3 = getS3Client();
    const putCommand = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: resolvedContentType,
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
