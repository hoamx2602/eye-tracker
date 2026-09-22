/**
 * Settings for the calibration video recording, and for getting it off the
 * participant's machine.
 *
 * These numbers interact, and getting them wrong is paid for as a wait at the
 * end of every session:
 *
 *   - the recorder produces bytes at `VIDEO_BITS_PER_SECOND`
 *   - the browser sends them at whatever the participant's upstream allows
 *
 * If the first is higher than the second, the upload can never catch up, and
 * the difference accumulates into a wait after calibration finishes. Measured
 * on this study's bucket: recording ran at 16 Mbps against ~7 Mbps of real
 * upstream, which produced 140-260 MB files and a two-to-four minute wait
 * while a participant sat looking at a "Saving" screen.
 *
 * Two things fix that together, and neither is sufficient alone:
 *   1. keep the bitrate comfortably below the slowest upstream you expect
 *   2. stream the file out *during* the session instead of at the end
 *      (see `lib/chunkedUpload.ts`)
 */

/** Parse a positive number from an env var, falling back when unset or junk. */
function envNumber(raw: string | undefined, fallback: number): number {
  const n = Number((raw ?? '').trim());
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Video bitrate, in bits per second.
 *
 * The recording exists so gaze can be re-derived offline, which means the iris
 * — around 15-25 px across at 720p — has to survive compression. The previous
 * 16 Mbps was chosen for that reason, but it is far above what VP9 needs at
 * 720p30: it was spending bits on the wall behind the participant while making
 * the file impossible to upload in reasonable time.
 *
 * 6 Mbps keeps the iris detail and cuts the file by roughly two thirds. Tune
 * with `NEXT_PUBLIC_VIDEO_BITRATE_MBPS` — raise it if an A/B on real sessions
 * shows offline gaze error getting worse, lower it if participants are on
 * slower connections than the recording can keep up with.
 */
export const VIDEO_BITS_PER_SECOND = Math.round(
  envNumber(process.env.NEXT_PUBLIC_VIDEO_BITRATE_MBPS, 6) * 1_000_000
);

/**
 * How often MediaRecorder hands us a chunk.
 *
 * `recorder.start()` with no argument fires `ondataavailable` exactly once, at
 * stop — so the entire file sits in memory until the session ends and none of
 * it can be uploaded early. Passing a timeslice is what makes streaming
 * possible at all.
 *
 * Five seconds is a compromise: short enough that the upload starts almost
 * immediately, long enough that we are not paying a round trip per second.
 */
export const RECORDER_TIMESLICE_MS = 5_000;

/**
 * Bytes buffered before a part is sent.
 *
 * S3 requires every part except the last to be at least 5 MiB, so this is a
 * floor imposed by the API, not a tuning choice.
 */
export const UPLOAD_PART_SIZE = 5 * 1024 * 1024;

/**
 * Parts uploaded at once.
 *
 * One at a time is enough to keep up on paper, but leaves no headroom: a
 * single slow part and the buffer grows for the rest of the session. Two gives
 * the upload a chance to catch back up without flooding a weak connection.
 */
export const UPLOAD_PART_CONCURRENCY = 2;

/**
 * Whether to record one continuous video spanning the 7 neurological tests,
 * the same way calibration already records itself.
 *
 * The tests are the actual scientific measurement and, unlike calibration,
 * have no raw-video fallback today — only the derived per-test metrics. This
 * closes that gap using the exact same streaming uploader and ownership
 * check calibration's video already goes through (see lib/chunkedUpload.ts
 * and validateUploadOwner in lib/s3Server.ts), just against the
 * NeurologicalRun instead of the Session.
 *
 * On by default; NEXT_PUBLIC_NEURO_RECORD_VIDEO=0 (or false/off/no) is the
 * kill switch if it ever needs to come off quickly without touching scoring
 * or the results screen, neither of which read this column.
 */
export const NEURO_RECORD_VIDEO_ENABLED =
  !['0', 'false', 'off', 'no'].includes(
    (process.env.NEXT_PUBLIC_NEURO_RECORD_VIDEO ?? '').trim().toLowerCase()
  );
