/**
 * Behaviour tests for lib/fixationGate.ts.
 *
 * The repo has no JS test runner, so this follows the backend convention: a
 * plain script that asserts and prints. Run:  npm run test:gate
 *
 * The synthetic traces model what the gate actually has to separate — a saccade
 * still in flight, an eye that has arrived, an eye steady on the wrong target,
 * and a subject who never settles.
 */
import { FixationGate, DEFAULT_GATE_CONFIG, type GateSample } from '../lib/fixationGate';

const FPS = 30;
const FRAME_MS = 1000 / FPS;
const DOT = { x: 960, y: 540 };

let failures = 0;

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/**
 * A dot window: `flightFrames` of the eye moving toward the dot, then noise-only
 * fixation. `noise` is the per-frame feature jitter amplitude.
 */
function trace(opts: {
  flightFrames: number;
  totalFrames: number;
  noise: number;
  from?: number;
  to?: number;
  predOffsetPx?: number;
  withPred?: boolean;
  drift?: number;
}): GateSample[] {
  const { flightFrames, totalFrames, noise, from = 2.0, to = 0.0, drift = 0 } = opts;
  // Deterministic pseudo-noise so runs are reproducible without a seeded RNG dep.
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff) * 2 - 1;
  };
  const out: GateSample[] = [];
  for (let i = 0; i < totalFrames; i++) {
    const p = flightFrames > 0 ? Math.min(1, i / flightFrames) : 1;
    const base = from + (to - from) * p + drift * i;
    const s: GateSample = {
      t: i * FRAME_MS,
      lx: base + rnd() * noise,
      ly: base * 0.5 + rnd() * noise,
      rx: base + rnd() * noise,
      ry: base * 0.5 + rnd() * noise,
    };
    if (opts.withPred) {
      const off = opts.predOffsetPx ?? 0;
      s.predX = DOT.x + off + rnd() * 5;
      s.predY = DOT.y + rnd() * 5;
    }
    out.push(s);
  }
  return out;
}

/** Run a trace through the gate; return the first settled verdict, if any. */
function firstSettle(samples: GateSample[], cfg = {}) {
  const gate = new FixationGate(cfg);
  gate.reset(DOT, 0);
  for (const s of samples) {
    const v = gate.push(s);
    if (v.settled) return v;
  }
  return null;
}

console.log('\nfixationGate\n');

// 1. The core case: the timer-based flow starts recording at a fixed 800 ms.
//    A corner dot with a long approach must NOT be accepted before it lands.
{
  const flightFrames = 21; // 700 ms in flight
  const v = firstSettle(trace({ flightFrames, totalFrames: 90, noise: 0.05 }));
  check('settles on a slow corner dot', v !== null);
  check(
    'does not settle while the eye is still in flight',
    v !== null && v.elapsedMs >= flightFrames * FRAME_MS * 0.8,
    v ? `settled at ${Math.round(v.elapsedMs)} ms, flight ended at ${Math.round(flightFrames * FRAME_MS)} ms` : ''
  );
}

// 2. A dot the eye reaches immediately should be accepted quickly — the gate
//    must not cost time on the easy centre dots.
{
  const v = firstSettle(trace({ flightFrames: 0, totalFrames: 60, noise: 0.05 }));
  check('settles fast when the eye is already on target', v !== null && v.elapsedMs < 400,
    v ? `${Math.round(v.elapsedMs)} ms` : 'never settled');
}

// 3. Proximity veto: features perfectly steady, but gaze parked far away.
{
  const v = firstSettle(
    trace({ flightFrames: 0, totalFrames: 90, noise: 0.02, withPred: true, predOffsetPx: 600 })
  );
  check('rejects a steady eye on the wrong target', v === null);
}

// 4. Same trace, prediction on target → accepted.
{
  const v = firstSettle(
    trace({ flightFrames: 0, totalFrames: 90, noise: 0.02, withPred: true, predOffsetPx: 0 })
  );
  check('accepts a steady eye on target', v !== null, v ? `reason=${v.reason}` : '');
}

// 5. Plateau fallback: noise well above maxSpread (a bad threshold for this rig,
//    or a genuinely jittery subject). The gate must still converge rather than
//    stall the calibration forever.
{
  const noisy = trace({ flightFrames: 0, totalFrames: 120, noise: DEFAULT_GATE_CONFIG.maxSpread * 3 });
  const v = firstSettle(noisy);
  check('falls back to plateau when the threshold is too strict', v !== null && v.reason === 'plateau',
    v ? `reason=${v.reason}, spread=${v.spread?.toFixed(2)}` : 'never settled');
}

// 6. Directional movement. A clearly sliding signal must be rejected outright
//    as 'moving' — this is the discriminator that peak-to-peak spread alone
//    cannot make, since jitter and travel both raise the spread.
{
  const v = firstSettle(trace({ flightFrames: 0, totalFrames: 90, noise: 0.02, drift: 0.25 }));
  check('rejects a steadily moving eye', v === null, v ? `settled as ${v.reason}` : '');

  // Same trace, one frame at a time, to confirm the reported reason.
  const gate = new FixationGate();
  gate.reset(DOT, 0);
  let sawMoving = false;
  for (const s of trace({ flightFrames: 0, totalFrames: 90, noise: 0.02, drift: 0.25 })) {
    if (gate.push(s).reason === 'moving') { sawMoving = true; break; }
  }
  check('reports movement as "moving", not "unstable"', sawMoving);
}

// 6b. Drift near the noise floor is genuinely ambiguous; the gate is allowed to
//     accept it via plateau, but never as 'stable'.
{
  const v = firstSettle(trace({ flightFrames: 0, totalFrames: 90, noise: 0.02, drift: 0.06 }));
  check('never calls a slowly drifting eye "stable"', v === null || v.reason !== 'stable',
    v ? `reason=${v.reason}` : 'never settled');
}

// 7. reset() must clear state between dots — otherwise dot N inherits dot N-1's
//    plateau and is accepted instantly.
{
  const gate = new FixationGate();
  gate.reset(DOT, 0);
  for (const s of trace({ flightFrames: 0, totalFrames: 60, noise: 0.02 })) gate.push(s);

  gate.reset(DOT, 0);
  let settledAt: number | null = null;
  for (const s of trace({ flightFrames: 15, totalFrames: 60, noise: 0.05 })) {
    const v = gate.push(s);
    if (v.settled) { settledAt = v.elapsedMs; break; }
  }
  check('reset clears the previous dot state', settledAt !== null && settledAt > 200,
    settledAt === null ? 'never settled' : `${Math.round(settledAt)} ms`);
}

console.log(failures ? `\n${failures} failure(s)\n` : '\nall gate tests passed\n');
process.exit(failures ? 1 : 0);
