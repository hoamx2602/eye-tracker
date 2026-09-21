/**
 * Streams the calibration video to S3 while it is still being recorded.
 *
 * MediaRecorder hands us the file in pieces; this collects them into parts of
 * the size S3 requires and sends each one as soon as it is full. By the time
 * the participant finishes calibration, most of the video is already in the
 * bucket, and the wait at the end is whatever is left over rather than the
 * whole file.
 *
 * The one rule this class follows everywhere: **never throw into the recording
 * path**. A failed part, a bucket without the right CORS, an offline moment —
 * all of it is swallowed, the uploader marks itself dead, and `finish()`
 * returns null. The caller then uploads the complete blob the old way, which
 * is slow but always worked. Losing the recording because an optimisation
 * failed would be a far worse outcome than waiting for it.
 */
import { getBaseUrl } from '@/services/api';
import { UPLOAD_PART_CONCURRENCY, UPLOAD_PART_SIZE } from '@/lib/recordingConfig';

type Part = { PartNumber: number; ETag: string };

type CreateResult = { key: string; uploadId: string; publicUrl: string };

async function callMultipart<T>(payload: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${getBaseUrl()}/api/upload/multipart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      typeof (err as { error?: string }).error === 'string'
        ? (err as { error: string }).error
        : `multipart ${String(payload.action)} failed: ${res.status}`
    );
  }
  return (await res.json()) as T;
}

export class ChunkedVideoUploader {
  private session: Promise<CreateResult> | null = null;
  private buffered: Blob[] = [];
  private bufferedBytes = 0;
  private nextPartNumber = 1;
  private parts: Part[] = [];
  private inFlight = new Set<Promise<void>>();
  private dead = false;
  private deadReason: string | null = null;

  constructor(
    private readonly filename: string,
    private readonly contentType: string
  ) {}

  /** True once something has gone wrong and the caller must upload normally. */
  get failed(): boolean {
    return this.dead;
  }

  get failureReason(): string | null {
    return this.deadReason;
  }

  /** How many bytes are sitting in the buffer, not yet sent. */
  get pendingBytes(): number {
    return this.bufferedBytes;
  }

  private die(reason: string): void {
    if (this.dead) return;
    this.dead = true;
    this.deadReason = reason;
    // Hold no references to video data once we have given up on it.
    this.buffered = [];
    this.bufferedBytes = 0;
    console.warn('[chunkedUpload] falling back to a single upload:', reason);
  }

  /**
   * Begin the upload. Safe to call before any data exists — the create call
   * happens in the background and parts wait on it.
   */
  start(): void {
    if (this.session || this.dead) return;
    this.session = callMultipart<CreateResult>({
      action: 'create',
      filename: this.filename,
      contentType: this.contentType,
    }).catch((e) => {
      this.die(e instanceof Error ? e.message : String(e));
      throw e;
    });
    // The rejection is handled above; this stops an unhandled rejection
    // warning when nothing else awaits the promise.
    this.session.catch(() => {});
  }

  /** Feed one MediaRecorder chunk in. Returns immediately. */
  add(chunk: Blob): void {
    if (this.dead || !chunk || chunk.size === 0) return;
    this.buffered.push(chunk);
    this.bufferedBytes += chunk.size;
    while (this.bufferedBytes >= UPLOAD_PART_SIZE) {
      this.flushPart(UPLOAD_PART_SIZE);
    }
  }

  /**
   * Cut `size` bytes off the front of the buffer and start sending them.
   *
   * Parts are numbered here, at slice time, so the sequence is correct even
   * though they finish out of order.
   */
  private flushPart(size: number): void {
    const whole = new Blob(this.buffered, { type: this.contentType });
    const part = whole.slice(0, size);
    const rest = whole.slice(size);
    this.buffered = rest.size > 0 ? [rest] : [];
    this.bufferedBytes = rest.size;

    const partNumber = this.nextPartNumber++;
    const task = this.sendPart(partNumber, part)
      .catch((e) => this.die(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        this.inFlight.delete(task);
      });
    this.inFlight.add(task);
  }

  private async sendPart(partNumber: number, blob: Blob): Promise<void> {
    // Don't let a weak connection accumulate an unbounded number of parallel
    // PUTs; wait for a slot before asking for a URL.
    while (this.inFlight.size > UPLOAD_PART_CONCURRENCY) {
      await Promise.race([...this.inFlight]);
      if (this.dead) return;
    }
    if (this.dead || !this.session) return;

    const { key, uploadId } = await this.session;
    const { url } = await callMultipart<{ url: string }>({
      action: 'part',
      key,
      uploadId,
      partNumber,
    });

    const res = await fetch(url, { method: 'PUT', body: blob });
    if (!res.ok) throw new Error(`part ${partNumber} PUT failed: ${res.status}`);

    const etag = res.headers.get('ETag') ?? res.headers.get('etag');
    if (!etag) {
      // Almost always the bucket's CORS config missing ExposeHeaders: ["ETag"].
      // Without the tag the upload can never be completed, so stop now rather
      // than uploading the rest of the video for nothing.
      throw new Error('S3 did not expose the part ETag — add ExposeHeaders: ["ETag"] to bucket CORS');
    }
    this.parts.push({ PartNumber: partNumber, ETag: etag });
  }

  /**
   * Send whatever is left and close the upload.
   *
   * Call only after MediaRecorder has delivered its final chunk — that is,
   * after `onstop` — or the tail of the video is lost.
   *
   * @returns the public URL, or null if the caller should upload the blob
   *          itself in the usual way.
   */
  async finish(): Promise<string | null> {
    if (this.dead || !this.session) return null;
    try {
      if (this.bufferedBytes > 0) {
        // The final part is exempt from the 5 MiB minimum, so the remainder
        // goes up whatever its size.
        this.flushPart(this.bufferedBytes);
      }
      while (this.inFlight.size > 0) {
        await Promise.all([...this.inFlight]);
      }
      if (this.dead) return null;
      if (this.parts.length === 0) return null;

      const { key, uploadId, publicUrl } = await this.session;
      await callMultipart({ action: 'complete', key, uploadId, parts: this.parts });
      return publicUrl;
    } catch (e) {
      this.die(e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  /**
   * Give up on an upload that will never be completed — a re-run of
   * calibration, or a participant who leaves.
   *
   * Parts already in the bucket are billed until they are aborted, and they do
   * not show up in a normal listing, so this matters more than it looks.
   */
  async abort(): Promise<void> {
    const session = this.session;
    this.die('aborted');
    this.session = null;
    if (!session) return;
    try {
      const { key, uploadId } = await session;
      await callMultipart({ action: 'abort', key, uploadId });
    } catch {
      // Nothing useful to do; the bucket lifecycle rule is the backstop.
    }
  }
}
