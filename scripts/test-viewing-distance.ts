/**
 * Behaviour tests for lib/screenScale.ts and lib/viewingDistance.ts.
 *
 * Run:  npm run test:distance
 *
 * These numbers decide every angular quantity the system reports, so the tests
 * are written against physical ground truth — a simulated participant at a known
 * distance in front of a known screen — rather than against the implementation.
 */
import {
  CARD_WIDTH_MM,
  pxPerCmFromCardWidth,
  cardWidthPxFromPxPerCm,
  isPlausibleScale,
  viewportWidthCm,
} from '../lib/screenScale';
import {
  BLIND_SPOT_ECCENTRICITY_DEG,
  aggregateBlindSpotTrials,
  calibrate,
  checkDistance,
  distanceBandCm,
  distanceFromBlindSpot,
  distanceFromFace,
  faceScale,
  faceScaleAtDistance,
  SUPPORTED_TARGET_DISTANCES_CM,
} from '../lib/viewingDistance';

let failures = 0;

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const close = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// A concrete rig to reason about: 1920 CSS px across a 34.5 cm-wide viewport.
const PX_PER_CM = 1920 / 34.5; // 55.65
const TAN_ECC = Math.tan((BLIND_SPOT_ECCENTRICITY_DEG * Math.PI) / 180);

console.log('\nscreenScale\n');

{
  // A card matched at 55.65 px/cm must be 8.56 cm wide on screen.
  const widthPx = cardWidthPxFromPxPerCm(PX_PER_CM);
  check('card width round-trips through the scale',
    close(pxPerCmFromCardWidth(widthPx), PX_PER_CM, 1e-9),
    `${widthPx.toFixed(1)} px = ${CARD_WIDTH_MM} mm`);

  check('viewport width recovers the physical width',
    close(viewportWidthCm(PX_PER_CM, 1920), 34.5, 1e-9));

  // The guard exists to stop a mis-sized rectangle from silently poisoning every
  // later measurement, so both directions of "obviously wrong" must be rejected.
  check('rejects an implausibly small scale', !isPlausibleScale(5));
  check('rejects an implausibly large scale', !isPlausibleScale(500));
  check('accepts a laptop-panel scale', isPlausibleScale(PX_PER_CM));
}

console.log('\nblind spot -> distance\n');

{
  // Ground truth: at distance d, the blind spot sits d·tan(13.5°) cm from
  // fixation. Feed that back in and the distance must come out.
  for (const d of SUPPORTED_TARGET_DISTANCES_CM) {
    const offsetPx = d * TAN_ECC * PX_PER_CM;
    const got = distanceFromBlindSpot(offsetPx, PX_PER_CM);
    check(`recovers ${d} cm`, close(got, d, 1e-6),
      `offset ${offsetPx.toFixed(0)} px -> ${got.toFixed(2)} cm`);
  }

  // Direction must not matter: the dot may vanish left or right of fixation
  // depending on which eye is open.
  const d = 40;
  const off = d * TAN_ECC * PX_PER_CM;
  check('sign of the offset is irrelevant',
    close(distanceFromBlindSpot(-off, PX_PER_CM), distanceFromBlindSpot(off, PX_PER_CM), 1e-9));
}

console.log('\nblind spot -> trial aggregation\n');

{
  const truth = 40;
  const offsetFor = (d: number) => d * TAN_ECC * PX_PER_CM;

  // Five honest trials with a little jitter.
  const jittered = [39.2, 40.6, 40.1, 39.7, 40.4].map(offsetFor);
  const clean = aggregateBlindSpotTrials(jittered, PX_PER_CM);
  check('median tracks the truth on clean trials',
    close(clean.distanceCm, truth, 0.6), `${clean.distanceCm.toFixed(2)} cm`);
  check('spread is small when trials agree', clean.spreadCm < 1.0,
    `spread ${clean.spreadCm.toFixed(2)} cm`);

  // One late keypress puts a trial far out. A mean would carry it into K and
  // therefore into every later measurement; the median must not.
  const withOutlier = [...jittered, offsetFor(85)];
  const robust = aggregateBlindSpotTrials(withOutlier, PX_PER_CM);
  const mean = withOutlier.map((o) => distanceFromBlindSpot(o, PX_PER_CM))
    .reduce((a, b) => a + b, 0) / withOutlier.length;
  check('a single bad trial does not move the estimate',
    close(robust.distanceCm, truth, 0.8),
    `median ${robust.distanceCm.toFixed(2)} cm vs mean ${mean.toFixed(2)} cm`);
  check('disagreement shows up in the spread', robust.spreadCm > clean.spreadCm,
    `${robust.spreadCm.toFixed(2)} cm`);

  // Physically impossible trials are dropped, not averaged in.
  const withGarbage = aggregateBlindSpotTrials([...jittered, 5, 100000], PX_PER_CM);
  check('implausible trials are rejected', withGarbage.nRejected === 2,
    `kept ${withGarbage.n}, rejected ${withGarbage.nRejected}`);
  check('rejection does not disturb the estimate',
    close(withGarbage.distanceCm, truth, 0.6));

  check('no usable trials yields NaN, not a number',
    Number.isNaN(aggregateBlindSpotTrials([1, 2], PX_PER_CM).distanceCm));
}

console.log('\nface scale -> distance\n');

{
  // Simulated camera: face subtends a fixed angle, so normalised face width is
  // inversely proportional to distance. K should absorb the constant.
  const K_TRUE = 0.24 * 40; // face fills 24% of frame width at 40 cm
  const widthAt = (d: number) => K_TRUE / d;

  const cal = calibrate({
    distanceCm: 40,
    faceScale: faceScale(widthAt(40)),
    pxPerCm: PX_PER_CM,
    method: 'blind-spot',
  })!;
  check('calibration is produced', cal !== null && cal.k > 0, `K = ${cal.k.toFixed(4)}`);

  for (const d of SUPPORTED_TARGET_DISTANCES_CM) {
    const got = distanceFromFace(cal, faceScale(widthAt(d)));
    check(`predicts ${d} cm from face width`, close(got, d, 1e-6), `${got.toFixed(2)} cm`);
  }

  check('faceScaleAtDistance inverts distanceFromFace',
    close(faceScaleAtDistance(cal, 55), widthAt(55), 1e-9));

  check('rejects a degenerate calibration',
    calibrate({ distanceCm: 40, faceScale: 0, pxPerCm: PX_PER_CM, method: 'manual' }) === null);
}

console.log('\nhead rotation\n');

{
  // The bug this replaces: turning the head foreshortens the measured face width
  // by cos(yaw), which the old band read as "moved away".
  const K_TRUE = 0.24 * 40;
  const trueWidth = K_TRUE / 40;
  const cal = calibrate({
    distanceCm: 40, faceScale: faceScale(trueWidth), pxPerCm: PX_PER_CM, method: 'blind-spot',
  })!;

  const yaw = (20 * Math.PI) / 180;
  const observed = trueWidth * Math.cos(yaw); // what the camera actually sees

  const naive = distanceFromFace(cal, observed);
  const corrected = distanceFromFace(cal, faceScale(observed, yaw));
  check('uncorrected width reads a turned head as further away', naive > 42,
    `${naive.toFixed(1)} cm at 20° yaw (truth 40)`);
  check('yaw correction restores the true distance', close(corrected, 40, 0.01),
    `${corrected.toFixed(2)} cm`);

  // Past the clamp the correction must stop growing rather than diverge.
  const extreme = faceScale(0.1, (80 * Math.PI) / 180);
  check('correction is clamped at large yaw', extreme <= 0.1 / Math.SQRT1_2 + 1e-9,
    `factor ${(extreme / 0.1).toFixed(3)}`);
}

console.log('\ndistance gate\n');

{
  const K_TRUE = 0.24 * 40;
  const cal = calibrate({
    distanceCm: 40, faceScale: K_TRUE / 40, pxPerCm: PX_PER_CM, method: 'blind-spot',
  })!;
  const scaleAt = (d: number) => K_TRUE / d;

  // Band is relative with a floor — tighter up close, where a centimetre costs
  // more angular error.
  check('band is 3 cm at the 30 cm target', close(distanceBandCm(30), 3, 1e-9));
  check('band is 6 cm at the 60 cm target', close(distanceBandCm(60), 6, 1e-9));
  check('tolerance widens the band', close(distanceBandCm(60, 2), 12, 1e-9));

  for (const target of SUPPORTED_TARGET_DISTANCES_CM) {
    const onTarget = checkDistance(cal, scaleAt(target), target);
    check(`accepts a participant sitting at ${target} cm`, onTarget.verdict === 'ok',
      `${onTarget.distanceCm.toFixed(1)} cm`);
  }

  const near = checkDistance(cal, scaleAt(24), 40);
  check('flags too close', near.verdict === 'too-close', `${near.distanceCm.toFixed(1)} cm`);
  const far = checkDistance(cal, scaleAt(56), 40);
  check('flags too far', far.verdict === 'too-far', `${far.distanceCm.toFixed(1)} cm`);

  // Without calibration the caller must be able to tell that it does not know,
  // rather than receive a confident wrong answer.
  check('reports unknown when uncalibrated',
    checkDistance(null, 0.2, 40).verdict === 'unknown');
}

console.log(failures ? `\n${failures} failure(s)\n` : '\nall viewing-distance tests passed\n');
process.exit(failures ? 1 : 0);
