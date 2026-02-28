/**
 * Parse S3 object URL and generate presigned Get URL.
 * Supports: https://bucket.s3.region.amazonaws.com/key and https://bucket.s3.amazonaws.com/key
 */
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
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

export function parseS3Url(objectUrl: string): { bucket: string; key: string } | null {
  try {
    const u = new URL(objectUrl);
    if (u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase();
    const pathname = u.pathname.replace(/^\/+/, '');
    if (!pathname) return null;
    // bucket.s3.region.amazonaws.com or bucket.s3.amazonaws.com
    const match = host.match(/^([a-z0-9][a-z0-9.-]+)\.s3(?:\.([a-z0-9-]+))?\.amazonaws\.com$/);
    if (!match) return null;
    const bucket = match[1];
    const key = decodeURIComponent(pathname);
    return { bucket, key };
  } catch {
    return null;
  }
}

const EXPIRES_IN = 3600; // 1 hour

export async function getPresignedGetUrl(objectUrl: string): Promise<string | null> {
  const parsed = parseS3Url(objectUrl);
  if (!parsed) return null;
  const { bucket, key } = parsed;
  const bucketEnv = process.env.S3_BUCKET;
  if (bucketEnv && bucket !== bucketEnv) return null; // only allow our bucket
  try {
    const client = getS3Client();
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const url = await getSignedUrl(client, command, { expiresIn: EXPIRES_IN });
    return url;
  } catch {
    return null;
  }
}
