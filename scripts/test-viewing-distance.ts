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
import { angularErrorDegOrNull, sessionGeometry } from '../lib/resultScoring';
import {
  ANGULAR_TOLERANCE,
  BLIND_SPOT_ECCENTRICITY_DEG,
  POSTURAL_FLOOR_CM,
  FRAME_EDGE_MARGIN,
  MIN_TARGET_DISTANCE_CM,
  faceFitsInFrame,
  frameFitMargin,
  nearestFittingDistanceCm,
  aggregateBlindSpotTrials,
  assessBlindSpot,
  blindSpotSpreadLimitCm,
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

  // A turned head does read as slightly further away, and that is accepted
  // rather than corrected. The correction that used to live here divided by
  // cos(yaw) using a heuristic yaw that over-reads threefold, so it turned a
  // small honest error into a large invented one.
  for (const trueDeg of [10, 15, 20]) {
    const observed = trueWidth * Math.cos((trueDeg * Math.PI) / 180);
    const err = Math.abs(distanceFromFace(cal, faceScale(observed)) - 40) / 40;
    check(`a real ${trueDeg}° turn stays inside the ±8% depth band uncorrected`,
      err < 0.08, `${(err * 100).toFixed(1)}%`);
  }

  // What the correction did instead, measured from a real session: an 18° turn
  // (4.8% of foreshortening) was reported as 63.6° of yaw.
  const observed18 = trueWidth * Math.cos((18 * Math.PI) / 180);
  const overRead = Math.min((63.6 * Math.PI) / 180, Math.PI / 4);
  const wouldHaveBeen = observed18 / Math.max(Math.cos(overRead), Math.SQRT1_2);
  const oldErr = Math.abs(distanceFromFace(cal, wouldHaveBeen) - 40) / 40;
  const newErr = Math.abs(distanceFromFace(cal, faceScale(observed18)) - 40) / 40;
  check('the correction was worse than doing nothing', oldErr > newErr * 3,
    `corrected ${(oldErr * 100).toFixed(0)}% vs uncorrected ${(newErr * 100).toFixed(1)}%`);
  check('and it alone breached the band', oldErr > 0.08);
  check('while doing nothing does not', newErr < 0.08);

  check('faceScale is now the measured width, untouched',
    close(faceScale(0.1234), 0.1234, 1e-12));
}

console.log('\ndistance gate\n');

{
  const K_TRUE = 0.24 * 40;
  const cal = calibrate({
    distanceCm: 40, faceScale: K_TRUE / 40, pxPerCm: PX_PER_CM, method: 'blind-spot',
  })!;
  const scaleAt = (d: number) => K_TRUE / d;

  // Band is fractional — tighter up close, where a centimetre costs more angular
  // error — and sized by what the reported science can absorb, not by how badly
  // the sensor used to mismeasure.
  check('band is 5% at the 60 cm target', close(distanceBandCm(60), 3, 1e-9));
  check('tolerance widens the band', close(distanceBandCm(60, 2), 6, 1e-9));
  check('tolerance is clamped', close(distanceBandCm(60, 99), distanceBandCm(60, 3), 1e-9));

  // Below ~60 cm the physical floor takes over, and it must: a proportional band
  // keeps shrinking as the participant sits closer while their postural sway
  // does not. Seated head sway peaks at 2–3 cm in young adults and 3–4 cm in
  // older ones, so a ±1.5 cm band at a 30 cm target is smaller than the natural
  // movement of the people it is meant to admit.
  check('the physical floor holds at close targets',
    close(distanceBandCm(30), POSTURAL_FLOOR_CM, 1e-9),
    `±${distanceBandCm(30)} cm, not ±${(30 * ANGULAR_TOLERANCE).toFixed(1)} cm`);
  check('a 30 cm target is no harder to hold than a 55 cm one',
    distanceBandCm(30) >= distanceBandCm(55) * 0.9,
    `±${distanceBandCm(30).toFixed(1)} vs ±${distanceBandCm(55).toFixed(1)} cm`);
  check('the floor never makes a far target tighter than the proportional band',
    distanceBandCm(90) > POSTURAL_FLOOR_CM);

  // The band exists to bound how much the *task* may change between sessions,
  // not only the error on a number. Saccadic targets sit at fixed viewport
  // fractions, so amplitude in degrees is set by where the participant sits.
  const amplitudeDeg = (distCm: number, sepCm = 0.5 * 34.5) =>
    2 * (Math.atan(sepCm / 2 / distCm) * 180) / Math.PI;
  const spreadOver = (bandCm: number) =>
    amplitudeDeg(40 - bandCm) / amplitudeDeg(40 + bandCm) - 1;
  // The band this replaced: max(3, 40·0.1) · 2 = ±8 cm.
  check('the old ±8 cm band let the same test vary by ~48%',
    Math.abs(spreadOver(8) - 0.48) < 0.03, `${(spreadOver(8) * 100).toFixed(0)}%`);
  // The physical floor costs some of that back, knowingly. ±3 cm at a 40 cm
  // target is 16% of amplitude rather than the 10% a pure ±2 cm band would give
  // — but ±2 cm is below the postural sway of an older participant, so the
  // tighter band buys its precision by excluding them entirely. Three times
  // better than what it replaced, and achievable, beats five times better and
  // impossible.
  const spread = spreadOver(distanceBandCm(40));
  check('the new band is far tighter than the old one', spread < spreadOver(8) / 2.5,
    `±${distanceBandCm(40).toFixed(1)} cm → ${(spread * 100).toFixed(0)}% vs the old 48%`);
  check('and it is still achievable by a participant with normal sway',
    distanceBandCm(40) >= 3, 'seated head sway peaks at 3–4 cm in older adults');

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

console.log('\nframing limit — what actually stops you getting close\n');

{
  // The near limit is not optics, it is framing: the head has to fit a 16:9
  // frame, and the vertical axis binds first.
  check('the config floor is 20 cm', MIN_TARGET_DISTANCE_CM === 20);

  const box = (minX: number, maxX: number, minY: number, maxY: number) =>
    ({ minX, maxX, minY, maxY });

  check('a comfortably framed face fits', faceFitsInFrame(box(0.35, 0.65, 0.15, 0.85)));
  check('a face touching the top edge does not',
    !faceFitsInFrame(box(0.35, 0.65, 0.005, 0.85)));
  check('nor one MediaPipe extrapolated past the edge',
    !faceFitsInFrame(box(0.35, 0.65, -0.08, 0.92)),
    'landmarks outside [0,1] are exactly the signal wanted');
  check('the margin is the tightest edge, whichever it is',
    close(frameFitMargin(box(0.30, 0.70, 0.04, 0.85)), 0.04, 1e-9));
  check('a clipped face reports a negative margin',
    frameFitMargin(box(0.35, 0.65, -0.05, 0.85)) < 0);

  // A width-fraction proxy cannot see the vertical axis, which is the one that
  // binds. This is why the old 0.5 ceiling was wrong in both directions.
  const wideButTall = box(0.40, 0.60, -0.02, 1.02);
  check('a narrow face can still be clipped vertically', !faceFitsInFrame(wideButTall),
    'width fraction 0.20 — a width ceiling would have passed this');

  // Extrapolating the nearest workable distance from what is observed.
  // A head spanning 70% of the frame at 40 cm hits the edge at ~29 cm.
  const nearest = nearestFittingDistanceCm(0.70, 40);
  check('predicts the nearest fitting distance', close(nearest, 40 * 0.7 / (1 - 2 * FRAME_EDGE_MARGIN), 1e-9),
    `${nearest.toFixed(1)} cm`);
  check('a smaller head can get closer', nearestFittingDistanceCm(0.5, 40) < nearest);
  check('the prediction scales with where it was observed',
    close(nearestFittingDistanceCm(0.35, 80), nearest, 1e-9),
    'same head, measured twice as far, same answer');
  check('says it does not know without an observation',
    Number.isNaN(nearestFittingDistanceCm(0, 40)) && Number.isNaN(nearestFittingDistanceCm(0.7, 0)));

  // The case the user asked for, and the honest answer to it.
  const headAt40 = 0.77; // ~22 cm head in a 28.7 cm-tall frame: 65 deg cam at 40 cm
  check('a 65° webcam cannot reach 20 cm', nearestFittingDistanceCm(headAt40, 40) > 20,
    `needs ${nearestFittingDistanceCm(headAt40, 40).toFixed(0)} cm`);
  const wideAt40 = 0.60; // 78 deg cam
  check('a wide-angle camera gets closer', nearestFittingDistanceCm(wideAt40, 40) < nearestFittingDistanceCm(headAt40, 40),
    `needs ${nearestFittingDistanceCm(wideAt40, 40).toFixed(0)} cm`);
}

console.log('\ngeometry provenance — never convert from a stand-in\n');

{
  const geo = (cfg: unknown) => sessionGeometry(cfg);

  const real = geo({
    positionAnchor: { distanceCm: 38.4, distanceSource: 'blind-spot' },
    distanceCalibration: { distanceCm: 38.1, pxPerCm: 55.6, method: 'blind-spot' },
    faceDistance: 40,
  });
  check('a measured session is measured', real.measured);
  check('and reports where they actually sat, not the target',
    close(real.distanceCm, 38.4, 1e-9), `${real.distanceCm} cm, target was 40`);
  check('degrees come out', angularErrorDegOrNull(47.5, real) != null);

  // The hole this closes: the anchor stores the *configured target* when nothing
  // measured the participant, tagged distanceSource: 'assumed'. Treating that as
  // a measurement reports 40 cm for someone who may have sat at 35.
  const assumed = geo({
    positionAnchor: { distanceCm: 40, distanceSource: 'assumed' },
    faceDistance: 40,
  });
  check('an assumed anchor is NOT a measurement', !assumed.measured);
  check('and yields no angular figure at all',
    angularErrorDegOrNull(47.5, assumed) === null,
    'a dash cannot be averaged or plotted; a fabricated 1.20° can');

  const noScale = geo({
    positionAnchor: { distanceCm: 38.4, distanceSource: 'manual' },
  });
  check('a measured distance without a measured display scale is still not enough',
    !noScale.measured && angularErrorDegOrNull(47.5, noScale) === null);

  check('nothing at all yields nothing', angularErrorDegOrNull(47.5, geo(undefined)) === null);
  check('no error yields nothing', angularErrorDegOrNull(null, real) === null);

  // And the conversion itself, once the inputs are real, must use them both.
  const atRef = angularErrorDegOrNull(47.5, { distanceCm: 60, pxPerCm: 96 / 2.54, measured: true })!;
  check('47.5 px at 60 cm on a CSS-reference display is 1.20°', close(atRef, 1.2, 0.005),
    `${atRef.toFixed(2)}° — the number a fallback used to invent`);
  const atReal = angularErrorDegOrNull(47.5, { distanceCm: 40, pxPerCm: 55.65, measured: true })!;
  check('the same error on a real Retina panel at 40 cm is different',
    Math.abs(atReal - atRef) > 0.01, `${atReal.toFixed(2)}°`);
}

console.log('\nblind-spot quality gate\n');

{
  // A run is only worth anchoring K to if enough trials survived and they agree.
  const offsetsAt = (d: number, n: number) =>
    Array.from({ length: n }, () => d * Math.tan((BLIND_SPOT_ECCENTRICITY_DEG * Math.PI) / 180) * PX_PER_CM);

  const good = aggregateBlindSpotTrials(offsetsAt(40, 5), PX_PER_CM);
  check('accepts five agreeing trials', assessBlindSpot(good).ok,
    `${good.distanceCm.toFixed(1)} cm ±${good.spreadCm.toFixed(1)}`);

  // The failure this exists for: four trials rejected as implausible leaves one
  // survivor, whose median absolute deviation is exactly zero. Reported spread
  // then looks perfect precisely because almost nothing was measured.
  const oneSurvivor = aggregateBlindSpotTrials(
    [...offsetsAt(40, 1), ...offsetsAt(400, 4)], PX_PER_CM,
  );
  check('the lone-survivor run reports a flattering spread',
    oneSurvivor.n === 1 && oneSurvivor.spreadCm === 0,
    `n=${oneSurvivor.n}, spread ${oneSurvivor.spreadCm.toFixed(1)}`);
  check('...and is rejected anyway', !assessBlindSpot(oneSurvivor).ok,
    assessBlindSpot(oneSurvivor).reason);

  const twoSurvivors = aggregateBlindSpotTrials(
    [...offsetsAt(40, 2), ...offsetsAt(400, 3)], PX_PER_CM,
  );
  check('rejects two survivors', !assessBlindSpot(twoSurvivors).ok);
  const threeSurvivors = aggregateBlindSpotTrials(
    [...offsetsAt(40, 3), ...offsetsAt(400, 2)], PX_PER_CM,
  );
  check('accepts three survivors that agree', assessBlindSpot(threeSurvivors).ok);

  // Trials that disagree wildly mean the participant was not holding fixation.
  const scattered = aggregateBlindSpotTrials(
    [...offsetsAt(28, 2), ...offsetsAt(40, 1), ...offsetsAt(58, 2)], PX_PER_CM,
  );
  check('rejects trials that disagree', !assessBlindSpot(scattered).ok,
    `spread ±${scattered.spreadCm.toFixed(1)} cm`);

  // ...but ordinary human variability must still pass, or the task never ends.
  const realistic = aggregateBlindSpotTrials(
    [offsetsAt(38, 1)[0], offsetsAt(39.5, 1)[0], offsetsAt(40, 1)[0],
     offsetsAt(41, 1)[0], offsetsAt(42.5, 1)[0]], PX_PER_CM,
  );
  check('accepts normal trial-to-trial scatter', assessBlindSpot(realistic).ok,
    `±${realistic.spreadCm.toFixed(1)} cm, limit ±${blindSpotSpreadLimitCm(realistic.distanceCm).toFixed(1)}`);

  check('rejects a run with no plausible trials at all',
    !assessBlindSpot(aggregateBlindSpotTrials(offsetsAt(400, 5), PX_PER_CM)).ok);

  // The limit scales with distance: the same centimetre of disagreement is a
  // bigger relative failure up close.
  check('spread limit is tighter up close',
    blindSpotSpreadLimitCm(30) < blindSpotSpreadLimitCm(60));
}

console.log('\npaired sweep cancels reaction time\n');

{
  // What the two-legged trial is for. The dot moves at SWEEP_PX_PER_SEC; the
  // participant reacts RT later, so the outward leg overshoots the true edge and
  // the inward leg undershoots it by the same distance. Either alone is biased;
  // the mean is not.
  const SWEEP = 180;
  const trueOffset = 40 * Math.tan((BLIND_SPOT_ECCENTRICITY_DEG * Math.PI) / 180) * PX_PER_CM;

  for (const rt of [0.2, 0.3, 0.4]) {
    const lag = SWEEP * rt;
    const outward = trueOffset + lag;   // pressed late while moving away
    const inward = trueOffset - lag;    // pressed late while moving back
    const single = aggregateBlindSpotTrials(Array(5).fill(outward), PX_PER_CM);
    const paired = aggregateBlindSpotTrials(Array(5).fill((outward + inward) / 2), PX_PER_CM);
    check(`outward-only is biased at RT ${rt * 1000} ms`,
      single.distanceCm - 40 > 2,
      `reports ${single.distanceCm.toFixed(1)} cm for a true 40 cm`);
    check(`paired legs cancel it at RT ${rt * 1000} ms`,
      close(paired.distanceCm, 40, 1e-9),
      `reports ${paired.distanceCm.toFixed(1)} cm`);
  }
}

console.log(failures ? `\n${failures} failure(s)\n` : '\nall viewing-distance tests passed\n');
process.exit(failures ? 1 : 0);
