/**
 * Server-side S3 plumbing, shared by the upload routes.
 *
 * This lives in one place because the single-shot presign route and the
 * multipart route have to agree on three things exactly: where objects are
 * keyed, how a public URL is derived from a key, and which credentials are
 * used. When those drifted apart, an object uploaded by one route was
 * unreadable at the URL handed out by the other.
 */
import { S3Client } from '@aws-sdk/client-s3';

/** Everything under this prefix is session media. Nothing else is writable. */
export const UPLOAD_PREFIX = 'calibration/';

export function getS3Client(): S3Client {
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

export function getPublicUrl(key: string): string | null {
  const bucket = process.env.S3_BUCKET;
  const region = process.env.AWS_REGION || 'us-east-1';
  if (!bucket) return null;
  const domain =
    region === 'us-east-1'
      ? `https://${bucket}.s3.amazonaws.com`
      : `https://${bucket}.s3.${region}.amazonaws.com`;
  return `${domain}/${key}`;
}

/** A collision-proof key for an uploaded file, under the one writable prefix. */
export function buildKey(filename: string): string {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${UPLOAD_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${safeName}`;
}

export function contentTypeFor(filename: string, given?: string): string {
  if (given) return given;
  const ext = filename.includes('.') ? filename.split('.').pop() : '';
  return ext === 'webm' ? 'video/webm' : 'image/jpeg';
}

/**
 * Guard for keys that arrive from the browser.
 *
 * The multipart endpoints take a key back from the client on every call, so
 * without this a caller could name any object in the bucket and have the
 * server sign writes to it.
 */
export function isManagedKey(key: unknown): key is string {
  return (
    typeof key === 'string' &&
    key.startsWith(UPLOAD_PREFIX) &&
    !key.includes('..') &&
    key.length <= 512
  );
}

/** The bucket name, or null when the deployment has no S3 configured. */
export function getBucket(): string | null {
  return process.env.S3_BUCKET || null;
}

export function credentialsConfigured(): boolean {
  return Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}
