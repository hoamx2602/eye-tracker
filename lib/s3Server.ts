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
import { prisma } from '@/lib/prisma';

/** Everything under this prefix is session media. Nothing else is writable. */
export const UPLOAD_PREFIX = 'calibration/';

/**
 * Who an upload belongs to, and what kind of record proves it is real.
 *
 * 'session' covers calibration's video and face captures — Session only
 * exists once demographics have been submitted through the real flow, so an
 * upload against a session id that doesn't resolve to a real, still-open row
 * never came from someone actually taking the assessment.
 *
 * 'run' is the same idea for whatever gets recorded during the neurological
 * tests — a NeurologicalRun only exists once calibration has actually
 * finished and handed off into that phase.
 */
export type UploadOwnerType = 'session' | 'run';

export function isUploadOwnerType(v: unknown): v is UploadOwnerType {
  return v === 'session' || v === 'run';
}

/**
 * A collision-proof id segment for a claimed owner — not a database lookup,
 * just shape validation, so a garbage string can't get embedded in a key.
 * cuid()s (what Session/NeurologicalRun ids actually are) are always
 * alphanumeric.
 */
function isPlausibleId(v: unknown): v is string {
  return typeof v === 'string' && /^[a-zA-Z0-9]{1,64}$/.test(v);
}

/**
 * The actual check: does this id resolve to a real row created through the
 * real flow, that hasn't already been finalized?
 *
 * A completed Session or a completed/abandoned NeurologicalRun refuses new
 * uploads for the same reason the PATCH routes for those records refuse
 * further writes once finalized — there is nothing left that a new file
 * could legitimately belong to.
 */
export async function validateUploadOwner(
  ownerType: UploadOwnerType,
  ownerId: string
): Promise<boolean> {
  if (!isPlausibleId(ownerId)) return false;
  if (ownerType === 'session') {
    const session = await prisma.session.findUnique({
      where: { id: ownerId },
      select: { status: true },
    });
    return session != null && session.status !== 'completed';
  }
  const run = await prisma.neurologicalRun.findUnique({
    where: { id: ownerId },
    select: { status: true },
  });
  return run != null && run.status !== 'completed' && run.status !== 'abandoned';
}

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

/**
 * A collision-proof key for an uploaded file, under the one writable prefix
 * and namespaced by the session/run it was validated against — so a bucket
 * listing traces straight back to whose data an object is, and an owner
 * that never finished a real session is easy to spot and clean up.
 */
export function buildKey(filename: string, owner: { type: UploadOwnerType; id: string }): string {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${UPLOAD_PREFIX}${owner.type}-${owner.id}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${safeName}`;
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

/**
 * Recover the S3 key from one of our own public object URLs.
 *
 * Returns null for anything that isn't actually a key we manage — an
 * unrelated URL, or a path outside UPLOAD_PREFIX — so a caller can reject it
 * rather than ask S3 to delete something it was never given permission to
 * name directly.
 */
export function keyFromPublicUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  try {
    const key = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
    return isManagedKey(key) ? key : null;
  } catch {
    return null;
  }
}

/** The bucket name, or null when the deployment has no S3 configured. */
export function getBucket(): string | null {
  return process.env.S3_BUCKET || null;
}

export function credentialsConfigured(): boolean {
  return Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}
