/**
 * Synthetic checks for lib/driftCorrection.ts: a steady look at the centre
 * with a mapping offset is measured and applied; a wandering look, too few
 * frames or an implausibly large offset are recorded but not applied.
 *
 * Usage:  npx tsx scripts/check-drift-correction.ts
 */
import { GazeFrameQuality, type GazeFrame } from '../lib/gazeFrameStream';
import { commitDriftCheck, evaluateDriftCheck, getDriftOffset, resetDriftOffset, takeLastDriftCheck } from '../lib/driftCorrection';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
};
let seed = 3;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

const vp = { w: 1440, h: 900 };
const c = { x: 720, y: 450 };
const frames = (n: number, dx: number, dy: number, noise: number, q: number = GazeFrameQuality.OK): GazeFrame[] =>
  Array.from({ length: n }, (_, i) => {
    const x = c.x + dx + gauss() * noise, y = c.y + dy + gauss() * noise;
    return { t: i * 33, x, y, sx: x, sy: y, q: q as GazeFrame['q'] };
  });

resetDriftOffset();
const good = evaluateDriftCheck(frames(40, 60, -35, 10), c, vp);
check('steady fixation is applied', good.applied && Math.abs(good.measuredOffset!.x - 60) < 6 && Math.abs(good.measuredOffset!.y + 35) < 6,
  JSON.stringify(good.measuredOffset));
commitDriftCheck(good);
check('applied offset becomes the live correction', getDriftOffset().x === good.appliedOffset.x);
check('the check is handed to the next test once', takeLastDriftCheck() !== null && takeLastDriftCheck() === null);

const wander = evaluateDriftCheck(frames(40, 0, 0, 150), c, vp);
check('wandering gaze is not applied', !wander.applied && wander.reason === 'unstable', `${wander.reason} spread ${wander.spreadPx}`);
commitDriftCheck(wander);
check('a rejected check keeps the previous offset', getDriftOffset().x === good.appliedOffset.x);

const few = evaluateDriftCheck([...frames(5, 0, 0, 5), ...frames(30, 0, 0, 5, GazeFrameQuality.BLINK)], c, vp);
check('too few usable frames', !few.applied && few.reason === 'too_few_frames', few.reason);

const far = evaluateDriftCheck(frames(40, 400, 0, 10), c, vp);
check('an offset beyond 20% of the screen is not drift', !far.applied && far.reason === 'too_large', far.reason);

resetDriftOffset();
check('a new calibration clears the offset', getDriftOffset().x === 0 && getDriftOffset().y === 0);

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
