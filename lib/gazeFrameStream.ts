/**
 * Every camera frame of the live gaze, for the neurological tests' metrics.
 *
 * The tests used to read `neuroLiveGazeRef` from their own `setInterval`
 * (100 ms): 10 Hz out of a 30 Hz camera, on the OneEuro-smoothed signal, and
 * out of step with the frames. Latency came out in 100 ms steps plus the
 * filter's lag, and fixation spread measured the filter as much as the eye.
 *
 * This stream keeps one entry per processed camera frame, stamped with the
 * frame's capture time (requestVideoFrameCallback) on the same
 * `performance.now()` clock the tests stamp their stimuli with. Each entry
 * carries the raw regressor output, the smoothed output, and why the frame is
 * unusable when it is — a dropped frame is marked, never replaced by a
 * placeholder coordinate.
 *
 * Recording only runs while at least one capture is open, so nothing
 * accumulates between tests.
 */

/** Why a frame carries no usable gaze. 0 = usable. */
export const GazeFrameQuality = {
  OK: 0,
  BLINK: 1,
  PARTIAL_BLINK: 2,
  IMPLAUSIBLE: 3,
  HEAD_INVALID: 4,
  NO_FACE: 5,
} as const;
export type GazeFrameQuality = (typeof GazeFrameQuality)[keyof typeof GazeFrameQuality];

export interface GazeFrame {
  /** Capture time, ms on the performance.now() clock. */
  t: number;
  /** Raw regressor output, CSS px (NaN when q ≠ OK). */
  x: number;
  y: number;
  /** OneEuro-smoothed output, CSS px (NaN when q ≠ OK). */
  sx: number;
  sy: number;
  q: GazeFrameQuality;
  /** Head yaw / pitch in degrees, when a face was found. */
  yaw?: number;
  pitch?: number;
}

/**
 * Column-oriented, rounded form stored with a test result — about a third of
 * the size of an array of objects. Invalid gaze is stored as null.
 */
export interface GazeFrameColumns {
  version: 1;
  clock: 'performance.now';
  /** Capture time relative to `t0`, ms. */
  t0: number;
  t: number[];
  x: (number | null)[];
  y: (number | null)[];
  sx: (number | null)[];
  sy: (number | null)[];
  q: number[];
  yaw: (number | null)[];
  pitch: (number | null)[];
  viewport: { w: number; h: number };
  /** Median frame interval, ms — the effective sampling rate of this recording. */
  medianFrameIntervalMs: number | null;
}

const round1 = (v: number | undefined): number | null =>
  v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10) / 10;

class GazeFrameStream {
  private frames: GazeFrame[] = [];
  private openCaptures = 0;
  private lastT = -Infinity;

  get recording(): boolean {
    return this.openCaptures > 0;
  }

  /** Open a capture; returns a token for `end`. */
  begin(): number {
    this.openCaptures++;
    return this.frames.length;
  }

  /** Close a capture and return every frame recorded since its `begin`. */
  end(token: number): GazeFrame[] {
    const out = this.frames.slice(token);
    this.openCaptures = Math.max(0, this.openCaptures - 1);
    if (this.openCaptures === 0) {
      this.frames = [];
      this.lastT = -Infinity;
    }
    return out;
  }

  /** Frames since `token` without closing the capture (for live use by a test). */
  peek(token: number): readonly GazeFrame[] {
    return this.frames.slice(token);
  }

  push(frame: GazeFrame): void {
    if (this.openCaptures === 0) return;
    // A repeated capture time is the same camera frame processed twice.
    if (frame.t <= this.lastT) return;
    this.lastT = frame.t;
    this.frames.push(frame);
  }
}

export const gazeFrameStream = new GazeFrameStream();

export function toGazeFrameColumns(frames: readonly GazeFrame[], viewport: { w: number; h: number }): GazeFrameColumns {
  const t0 = frames.length > 0 ? frames[0]!.t : 0;
  const intervals: number[] = [];
  for (let i = 1; i < frames.length; i++) intervals.push(frames[i]!.t - frames[i - 1]!.t);
  intervals.sort((a, b) => a - b);
  return {
    version: 1,
    clock: 'performance.now',
    t0,
    t: frames.map((f) => Math.round((f.t - t0) * 10) / 10),
    x: frames.map((f) => round1(f.x)),
    y: frames.map((f) => round1(f.y)),
    sx: frames.map((f) => round1(f.sx)),
    sy: frames.map((f) => round1(f.sy)),
    q: frames.map((f) => f.q),
    yaw: frames.map((f) => round1(f.yaw)),
    pitch: frames.map((f) => round1(f.pitch)),
    viewport,
    medianFrameIntervalMs: intervals.length > 0 ? Math.round(intervals[intervals.length >> 1]! * 10) / 10 : null,
  };
}

/** Inverse of `toGazeFrameColumns`, for analysis of a stored result. */
export function fromGazeFrameColumns(c: GazeFrameColumns): GazeFrame[] {
  return c.t.map((t, i) => ({
    t: c.t0 + t,
    x: c.x[i] ?? NaN,
    y: c.y[i] ?? NaN,
    sx: c.sx[i] ?? NaN,
    sy: c.sy[i] ?? NaN,
    q: c.q[i] as GazeFrameQuality,
    ...(c.yaw[i] != null && { yaw: c.yaw[i]! }),
    ...(c.pitch[i] != null && { pitch: c.pitch[i]! }),
  }));
}
