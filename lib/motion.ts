/**
 * Motion profiles for on-screen targets the participant follows with their eyes.
 *
 * A dot that starts or stops at full speed jerks: the eye cannot match an
 * instant change of velocity, so it falls behind with a catch-up saccade at
 * every turn. These profiles start and end every movement at zero velocity.
 *
 * Only for pursuit-style targets. The saccadic and anti-saccade stimuli jump
 * on purpose — the sudden onset is what those tests measure.
 */

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/**
 * Minimum-jerk profile on [0, 1]: zero velocity and acceleration at both ends.
 * Average speed is unchanged, so a segment keeps its duration; peak speed is
 * 1.875× the average, reached at the midpoint.
 */
export function smootherstep(t: number): number {
  const x = clamp01(t);
  return x * x * x * (x * (6 * x - 15) + 10);
}

/**
 * Distance fraction along a constant-speed path whose speed ramps linearly up
 * from rest over `rampMs` and back down to rest over the last `rampMs`.
 *
 * `elapsedMs` runs over [0, totalMs], where totalMs = cruiseMs + rampMs and
 * cruiseMs is the time the path takes at full speed: each ramp covers half the
 * distance it would at full speed, so the two together cost one `rampMs`.
 */
export function rampedProgress(elapsedMs: number, cruiseMs: number, rampMs: number): number {
  const total = cruiseMs + rampMs;
  const r = Math.max(0, Math.min(rampMs, total / 2));
  const tau = Math.max(0, Math.min(total, elapsedMs));
  // Distance in "ms at full speed": the path is cruiseMs long.
  let s: number;
  if (r === 0) s = tau;
  else if (tau < r) s = (tau * tau) / (2 * r);
  else if (tau > total - r) s = cruiseMs - ((total - tau) * (total - tau)) / (2 * r);
  else s = r / 2 + (tau - r);
  return cruiseMs > 0 ? clamp01(s / cruiseMs) : 1;
}

/**
 * Amplitude envelope for a sinusoidal target: rises from 0 to 1 over the first
 * `rampMs` of motion, so the dot leaves the centre from rest instead of at the
 * sinusoid's peak speed.
 */
export function rampIn(elapsedMs: number, rampMs: number): number {
  return rampMs > 0 ? smootherstep(elapsedMs / rampMs) : 1;
}
