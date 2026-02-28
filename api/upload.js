/**
 * POST /api/upload — upload a file (body: base64 data + filename) to AWS S3.
 * Returns { url } (public S3 object URL).
 * Env: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, S3_BUCKET
 */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

function getS3Client() {
  const region = process.env.AWS_REGION || 'us-east-1';
  return new S3Client({
    region,
    credentials: process.env.AWS_ACCESS_KEY_ID
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
        }
      : undefined,
  });
}

function getPublicUrl(key) {
  const bucket = process.env.S3_BUCKET;
  const region = process.env.AWS_REGION || 'us-east-1';
  if (!bucket) return null;
  const domain = region === 'us-east-1'
    ? `https://${bucket}.s3.amazonaws.com`
    : `https://${bucket}.s3.${region}.amazonaws.com`;
  return `${domain}/${key}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.VERCEL ? '*' : (process.env.FRONTEND_ORIGIN || '*'));
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    return res.status(500).json({ error: 'S3_BUCKET not configured' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { data: base64Data, filename, contentType } = body;

    if (!base64Data || !filename) {
      return res.status(400).json({ error: 'Missing data or filename' });
    }

    const buffer = Buffer.from(base64Data, 'base64');
    const ext = filename.includes('.') ? filename.split('.').pop() : '';
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `calibration/${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${safeName}`;

    const s3 = getS3Client();
    const cmd = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType || (ext === 'webm' ? 'video/webm' : 'image/jpeg'),
      ACL: 'public-read',
    });
    await s3.send(cmd);

    const url = getPublicUrl(key);
    if (!url) return res.status(500).json({ error: 'Could not build S3 URL' });
    return res.status(200).json({ url });
  } catch (e) {
    console.error('[api/upload]', e);
    return res.status(500).json({ error: 'Upload failed' });
  }
}
