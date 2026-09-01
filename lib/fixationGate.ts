/**
 * Gaze-contingent capture gate.
 *
 * The calibration flow used to be purely timed: show a dot, wait 800 ms, then
 * record for 1200 ms regardless of what the eyes were doing. For a dot in a
 * screen corner — the largest saccade and the longest settling time — 800 ms is
 * often not enough, so the noisiest data lands on precisely the targets that
 * dominate the error. And nothing downstream can repair it: a robust median over
 * a window still returns garbage if the eye was in flight for the whole window.
 *
 * This gate decides *when* the eye has actually arrived, from two signals:
 *
 *   stability   the raw eye-feature vector stops moving. Always available,
 *               including during the very first calibration dot when no gaze
 *               mapping exists yet.
 *   proximity   the predicted gaze point is near the dot. Only meaningful once
 *               a regressor has been trained (validation and refinement passes),
 *               and it is what catches the case where the eye is steady but
 *               steady on the *wrong* thing.
 *
 * Because the right absolute stability threshold depends on the camera, the
 * subject and the lighting, the gate also accepts a **plateau**: once the signal
 * has stopped improving for a while it is as settled as it is going to get. That
 * keeps a badly-tuned threshold from stalling the flow, and the caller's timeout
 * is the final backstop — a dot that never settles is reported, not silently
 * accepted.
 */

export interface GateSample {
  /** Timestamp (ms), any monotonic clock. */
  t: number;
  /** Normalized pupil-offset features (EyeFeatures.leftRelative / rightRelative). */
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  /** Predicted gaze in screen px — omit before a regressor exists. */
  predX?: number;
  predY?: number;
}

export interface GateConfig {
  /** Sliding window the spread is measured over. */
  windowMs: number;
  /** Spread below this counts as settled outright, in feature units. */
  maxSpread: number;
  /** Predicted gaze must land within this many px of the dot. Null disables. */
  maxOffsetPx: number | null;
  /** Accept a plateau once the best spread hasn't improved for this long. */
  plateauMs: number;
  /** Relative slack for "hasn't improved": spread < bestSpread * this. */
  plateauFactor: number;
}

export const DEFAULT_GATE_CONFIG: GateConfig = {
  // ~200 ms at 30 fps. Long enough to average out landmark jitter, short enough
  // that the gate reacts within a frame or two of arrival.
  windowMs: 200,
  // Features are pupil offsets normalized by eye width and scaled ×10, so 0.30
  // is ~3% of eye width — around the landmark noise floor of a 1080p webcam.
  // Verify against the `spread` this gate logs on a real run and tune per rig.
  maxSpread: 0.3,
  // ~2° at 60 cm on a typical 1920 px / 34.5 cm screen. Deliberately loose: this
  // rejects "looking somewhere else", not small calibration error.
  maxOffsetPx: 120,
  plateauMs: 350,
  plateauFactor: 1.15,
};

export type GateReason =
  | 'waiting'     // not enough samples yet to judge
  | 'stable'      // spread under threshold and going nowhere
  | 'plateau'     // spread stopped improving; as settled as this rig gets
  | 'unstable'    // still jittering above threshold
  | 'moving'      // travelling in one direction — saccade in flight, or postural drift
  | 'off-target'; // steady, but the predicted gaze is not on this dot

export interface GateVerdict {
  settled: boolean;
  reason: GateReason;
  /** Largest per-channel peak-to-peak spread across the window, or null if short. */
  spread: number | null;
  /**
   * Net one-directional displacement across the window (largest channel).
   * Jitter cancels out and leaves this near zero; a saccade in flight or a
   * sliding posture does not. This is what separates "noisy but fixating" from
   * "still moving" — spread alone cannot, since both raise it.
   */
  drift: number | null;
  /** Distance from the dot in px, or null when no prediction was supplied. */
  offsetPx: number | null;
  /** Time since the dot appeared. */
  elapsedMs: number;
}

export class FixationGate {
  private cfg: GateConfig;
  private target: { x: number; y: number } | null = null;
  private buf: GateSample[] = [];
  private t0 = 0;
  private bestSpread = Infinity;
  private bestSpreadAt = 0;

  constructor(cfg: Partial<GateConfig> = {}) {
    this.cfg = { ...DEFAULT_GATE_CONFIG, ...cfg };
  }

  /** Start gating a new dot. Call the moment the dot becomes visible. */
  reset(target: { x: number; y: number } | null, now: number): void {
    this.target = target;
    this.buf = [];
    this.t0 = now;
    this.bestSpread = Infinity;
    this.bestSpreadAt = now;
  }

  /** Feed one frame; returns whether the eye can now be considered settled. */
  push(s: GateSample): GateVerdict {
    this.buf.push(s);
    // Keep one sample older than the cutoff so the retained window always spans
    // at least `windowMs`. Trimming to strictly-inside samples leaves a short
    // window early on, and a short window understates the spread — which is how
    // an eye still travelling gets waved through as "stable".
    const cutoff = s.t - this.cfg.windowMs;
    while (this.buf.length > 2 && this.buf[1].t <= cutoff) this.buf.shift();

    const elapsedMs = s.t - this.t0;
    const pending = (reason: GateReason): GateVerdict =>
      ({ settled: false, reason, spread: null, drift: null, offsetPx: null, elapsedMs });

    if (this.buf.length < 4 || s.t - this.buf[0].t < this.cfg.windowMs) {
      return pending('waiting');
    }

    const spread = this.spread();
    const drift = this.drift();

    if (spread < this.bestSpread) {
      this.bestSpread = spread;
      this.bestSpreadAt = s.t;
    }

    const offsetPx =
      this.target && s.predX !== undefined && s.predY !== undefined
        ? Math.hypot(s.predX - this.target.x, s.predY - this.target.y)
        : null;

    const verdict = (settled: boolean, reason: GateReason): GateVerdict =>
      ({ settled, reason, spread, drift, offsetPx, elapsedMs });

    // Proximity is a veto, not a trigger: a steady eye pointed elsewhere is not
    // a fixation on this dot, however stable the features look.
    if (this.cfg.maxOffsetPx !== null && offsetPx !== null && offsetPx > this.cfg.maxOffsetPx) {
      return verdict(false, 'off-target');
    }
    // Directional movement disqualifies the window outright — this is the
    // approach saccade the old fixed 800 ms wait kept recording through.
    if (drift > this.cfg.maxSpread) {
      return verdict(false, 'moving');
    }
    if (spread <= this.cfg.maxSpread) {
      return verdict(true, 'stable');
    }
    // Jittery beyond the threshold but no longer improving: this rig/subject is
    // as steady as it will get, and waiting longer only adds fatigue.
    if (s.t - this.bestSpreadAt >= this.cfg.plateauMs) {
      return verdict(true, 'plateau');
    }
    return verdict(false, 'unstable');
  }

  /** Largest peak-to-peak range across the four feature channels in the window. */
  private spread(): number {
    return this.worstChannel((vals) => Math.max(...vals) - Math.min(...vals));
  }

  /**
   * Largest net displacement across the window: |mean(last third) − mean(first
   * third)|. Averaging the ends rather than differencing single samples keeps
   * per-frame noise out of the estimate.
   */
  private drift(): number {
    const k = Math.max(1, Math.floor(this.buf.length / 3));
    const mean = (vals: number[]) => vals.reduce((a, b) => a + b, 0) / vals.length;
    return this.worstChannel((vals) => Math.abs(mean(vals.slice(-k)) - mean(vals.slice(0, k))));
  }

  private worstChannel(measure: (vals: number[]) => number): number {
    let worst = 0;
    for (const key of ['lx', 'ly', 'rx', 'ry'] as const) {
      const v = measure(this.buf.map((s) => s[key]));
      if (v > worst) worst = v;
    }
    return worst;
  }
}

/** Per-dot record of how the gate behaved — stored on the session for QA. */
export interface DotConvergence {
  /** Dot index in the current phase. */
  index: number;
  /** Why collection started: the gate settled, or the timeout fired. */
  reason: GateReason | 'timeout';
  /** Time from dot onset to collection start. */
  waitMs: number;
  spread: number | null;
  offsetPx: number | null;
}
