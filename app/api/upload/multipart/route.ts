/**
 * POST /api/upload/multipart — drive an S3 multipart upload from the browser.
 *
 * The calibration video is the largest thing a session produces by two orders
 * of magnitude. Sending it as one PUT after calibration means the participant
 * waits for the whole file; this route lets the browser push each part as
 * MediaRecorder produces it, so by the time the session ends there is usually
 * nothing left to send.
 *
 * Four actions, all on POST, distinguished by `action`:
 *   create   { filename, contentType? }            → { key, uploadId, publicUrl }
 *   part     { key, uploadId, partNumber }         → { url }
 *   complete { key, uploadId, parts[] }            → { publicUrl }
 *   abort    { key, uploadId }                     → { ok }
 *
 * The browser PUTs each part to the signed `url` and reads the part's ETag from
 * the response headers, so the bucket CORS config must expose it:
 *   ExposeHeaders: ["ETag"]
 * without that the client cannot complete the upload and falls back to a
 * single PUT at the end.
 *
 * A session that is abandoned mid-recording leaves parts behind. They are
 * invisible in the bucket listing but still billed, so the bucket should carry
 * a lifecycle rule to abort incomplete multipart uploads after a day or so.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  buildKey,
  contentTypeFor,
  credentialsConfigured,
  getBucket,
  getPublicUrl,
  getS3Client,
  isManagedKey,
} from '@/lib/s3Server';

type Part = { PartNumber: number; ETag: string };

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const bucket = getBucket();
  if (!bucket) {
    return NextResponse.json({ error: 'S3_BUCKET not configured' }, { status: 500 });
  }
  if (!credentialsConfigured()) {
    return NextResponse.json({ error: 'AWS credentials not configured' }, { status: 500 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return badRequest('Invalid JSON body');
  }

  const s3 = getS3Client();
  const action = body.action;

  try {
    if (action === 'create') {
      const filename = body.filename;
      if (typeof filename !== 'string' || !filename) return badRequest('Missing filename');
      const key = buildKey(filename);
      const created = await s3.send(
        new CreateMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          ContentType: contentTypeFor(filename, body.contentType as string | undefined),
          ...(process.env.S3_ACL_PUBLIC_READ === '1' ? { ACL: 'public-read' as const } : {}),
        })
      );
      if (!created.UploadId) {
        return NextResponse.json({ error: 'S3 returned no upload id' }, { status: 502 });
      }
      return NextResponse.json({ key, uploadId: created.UploadId, publicUrl: getPublicUrl(key) });
    }

    // Every remaining action addresses an upload already in progress.
    const { key, uploadId } = body as { key?: unknown; uploadId?: unknown };
    if (!isManagedKey(key)) return badRequest('Invalid key');
    if (typeof uploadId !== 'string' || !uploadId) return badRequest('Missing uploadId');

    if (action === 'part') {
      const partNumber = Number(body.partNumber);
      // S3 allows 1..10000. At 5 MiB a part that ceiling is far beyond any
      // session we record, so anything outside it is a bug or an attack.
      if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
        return badRequest('Invalid partNumber');
      }
      const url = await getSignedUrl(
        s3,
        new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }),
        { expiresIn: 3600 }
      );
      return NextResponse.json({ url });
    }

    if (action === 'complete') {
      const rawParts = body.parts;
      if (!Array.isArray(rawParts) || rawParts.length === 0) return badRequest('Missing parts');
      const parts: Part[] = [];
      for (const p of rawParts) {
        const n = Number((p as Record<string, unknown>)?.PartNumber);
        const tag = (p as Record<string, unknown>)?.ETag;
        if (!Number.isInteger(n) || n < 1 || typeof tag !== 'string' || !tag) {
          return badRequest('Malformed part entry');
        }
        parts.push({ PartNumber: n, ETag: tag });
      }
      // S3 rejects an out-of-order part list; the client assembles parts as
      // uploads finish, which is not the order they were numbered in.
      parts.sort((a, b) => a.PartNumber - b.PartNumber);
      await s3.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts },
        })
      );
      return NextResponse.json({ publicUrl: getPublicUrl(key) });
    }

    if (action === 'abort') {
      await s3.send(
        new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId })
      );
      return NextResponse.json({ ok: true });
    }

    return badRequest('Unknown action');
  } catch (e) {
    const err = e as Error;
    console.error('[api/upload/multipart]', action, err);
    return NextResponse.json({ error: `Multipart ${String(action)} failed` }, { status: 500 });
  }
}
