/**
 * Checks the calibration dot layout (lib/appHelpers.generateCalibrationPoints).
 *
 * The grid has to use every dot it promises and keep all four corners — the
 * outer ring is what pins the mapping at the screen edges. Pure, no DB.
 *
 * Usage:  npx tsx scripts/check-calibration-grid.ts
 */
import { calibrationGridShape, generateCalibrationPoints } from '../lib/appHelpers';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
};

const EDGE = 4;
const corners = (pts: { x: number; y: number }[]) =>
  [[EDGE, EDGE], [100 - EDGE, EDGE], [EDGE, 100 - EDGE], [100 - EDGE, 100 - EDGE]]
    .filter(([x, y]) => pts.some((p) => Math.abs(p.x - x) < 0.01 && Math.abs(p.y - y) < 0.01)).length;

const shape24 = calibrationGridShape(24);
const p24 = generateCalibrationPoints(24);
console.log(`24 dots -> ${shape24.cols} columns x ${shape24.rows} rows`);
check('24 dots is a full 6 x 4 rectangle', shape24.cols === 6 && shape24.rows === 4);
check('24 dots produces 24 positions', p24.length === 24);
check('24 dots keeps all four corners', corners(p24) === 4, `${corners(p24)}/4`);
check('24 dots spans 4–96% both ways',
  Math.min(...p24.map((p) => p.x)) === EDGE && Math.max(...p24.map((p) => p.x)) === 100 - EDGE &&
  Math.min(...p24.map((p) => p.y)) === EDGE && Math.max(...p24.map((p) => p.y)) === 100 - EDGE);

// The counts the app can be configured with must all stay sane.
for (const [count, cols, rows] of [[6, 3, 2], [9, 3, 3], [16, 4, 4], [20, 5, 4], [25, 5, 5], [28, 7, 4]] as const) {
  const s = calibrationGridShape(count);
  const pts = generateCalibrationPoints(count);
  check(`${count} dots -> ${cols}x${rows}, all corners`,
    s.cols === cols && s.rows === rows && pts.length === count && corners(pts) === 4,
    `${s.cols}x${s.rows}, ${pts.length} dots, ${corners(pts)} corners`);
}

let bad: number[] = [];
for (let n = 4; n <= 40; n++) {
  const pts = generateCalibrationPoints(n);
  const unique = new Set(pts.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`)).size;
  const inRange = pts.every((p) => p.x >= EDGE - 1e-9 && p.x <= 100 - EDGE + 1e-9 && p.y >= EDGE - 1e-9 && p.y <= 100 - EDGE + 1e-9);
  if (pts.length !== n || unique !== n || !inRange) bad.push(n);
}
check('every count 4–40 gives that many distinct dots inside the field', bad.length === 0, bad.length ? `bad: ${bad}` : '');

const primes = [7, 11, 13].map((n) => `${n}:${generateCalibrationPoints(n).length}`);
check('prime counts still produce exactly that many dots', primes.every((p) => p.split(':')[0] === p.split(':')[1]), primes.join(' '));

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
