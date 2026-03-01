/**
 * POST /api/upload — upload a file (body: base64 data + filename) to AWS S3.
 * Returns { url } (public S3 object URL).
 */
import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

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
      { error: 'AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set in .env.local' },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { data: base64Data, filename, contentType } = body as {
      data?: string;
      filename?: string;
      contentType?: string;
    };

    if (!base64Data || !filename) {
      return NextResponse.json(
        { error: base64Data === undefined || base64Data === '' ? 'Missing or empty data' : 'Missing filename' },
        { status: 400 }
      );
    }
    if (typeof base64Data !== 'string') {
      return NextResponse.json({ error: 'data must be a base64 string' }, { status: 400 });
    }

    const buffer = Buffer.from(base64Data, 'base64');
    const ext = filename.includes('.') ? filename.split('.').pop() : '';
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `calibration/${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${safeName}`;

    const s3 = getS3Client();
    const putParams: {
      Bucket: string;
      Key: string;
      Body: Buffer;
      ContentType: string;
      ACL?: 'public-read';
    } = {
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType || (ext === 'webm' ? 'video/webm' : 'image/jpeg'),
    };
    if (process.env.S3_ACL_PUBLIC_READ === '1') {
      putParams.ACL = 'public-read';
    }
    await s3.send(new PutObjectCommand(putParams));

    const url = getPublicUrl(key);
    if (!url) return NextResponse.json({ error: 'Could not build S3 URL' }, { status: 500 });
    return NextResponse.json({ url });
  } catch (e) {
    const err = e as Error;
    console.error('[api/upload]', err);
    const message = process.env.NODE_ENV === 'development' ? err.message : 'Upload failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200 });
}
