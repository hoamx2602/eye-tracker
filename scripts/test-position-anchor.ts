/**
 * Behaviour tests for lib/positionAnchor.ts.  Run: npm run test:anchor
 *
 * The point of the anchor is that it stays correct without knowing the camera,
 * so the tests simulate a pinhole camera with a *deliberately unknown* focal
 * length and check that the readings come out right anyway. A test that fed the
 * same focal length into both the simulation and the expectation would prove
 * nothing about the property that matters.
 */
import {
  DEFAULT_ANCHOR_TOLERANCE,
  NOMINAL_FACE_WIDTH_CM,
  captureAnchor,
  checkAnchor,
  deviationFrom,
  faceWidthCmFromCard,
  isPlausibleFaceWidthCm,
  type HeadSignature,
} from '../lib/positionAnchor';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
  else { failures++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}
const close = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// ── Simulated camera ─────────────────────────────────────────────────────────
// Focal length in *normalised* units (fraction of frame width per unit of
// tan-angle). Nothing under test is allowed to know this number.
const F_N = 1.35;
// Outer canthal distance, not bizygomatic width — the segment faceScale is
// built on. See rigidFaceWidth in eyeTrackingService.
const FACE_CM = 9.1;          // this participant, not the nominal 15
const SETUP_CM = 40;

/** Where a head at (x, y, z) centimetres appears, in normalised frame coords. */
function observe(xCm: number, yCm: number, zCm: number, rot = { yaw: 0, pitch: 0, roll: 0 }): HeadSignature {
  return {
    faceScale: (F_N * FACE_CM) / zCm,
    cx: 0.5 + (F_N * xCm) / zCm,
    cy: 0.5 + (F_N * yCm) / zCm,
    ...rot,
  };
}

const anchorSig = observe(0, 0, SETUP_CM);

console.log('\npositionAnchor — drift measurement\n');

{
  const anchor = captureAnchor(anchorSig, { faceWidthCm: FACE_CM, distanceCm: SETUP_CM, distanceSource: 'manual' });

  check('a stationary head shows no drift', (() => {
    const d = deviationFrom(anchor, anchorSig);
    return close(d.depthRatio, 1, 1e-9) && close(d.lateralFaceWidths, 0, 1e-9);
  })());

  // Depth: the ratio must be exact without anyone knowing the focal length.
  for (const z of [30, 36, 44, 55]) {
    const d = deviationFrom(anchor, observe(0, 0, z));
    check(`depth ratio is exact at ${z} cm`, close(d.depthRatio, z / SETUP_CM, 1e-9),
      `ratio ${d.depthRatio.toFixed(3)}`);
    check(`depth in cm is exact at ${z} cm`, close(d.depthCm!, z - SETUP_CM, 1e-9),
      `${d.depthCm!.toFixed(2)} cm`);
  }

  // Lateral: exact in cm, because the face is a known-size ruler in that plane.
  for (const x of [-6, -2.5, 3, 7]) {
    const d = deviationFrom(anchor, observe(x, 0, SETUP_CM));
    check(`lateral drift of ${x} cm is exact`, close(d.lateralCm!, x, 1e-9),
      `${d.lateralCm!.toFixed(2)} cm`);
  }

  // The hard case: moved sideways *and* changed depth at once. Using the live
  // face width as the ruler keeps the centimetres right; using the anchor's
  // would scale the answer by the depth change.
  const both = deviationFrom(anchor, observe(4, 0, 52));
  check('lateral stays exact when depth also changed', close(both.lateralCm!, 4, 1e-9),
    `${both.lateralCm!.toFixed(2)} cm at ${(52).toFixed(0)} cm depth`);
}

console.log('\npositionAnchor — works without any absolute measurement\n');

{
  // No faceWidthCm, no distanceCm: the depth ratio and face-width drift must
  // still be exact, and the cm fields must be null rather than a guess.
  const bare = captureAnchor(anchorSig);
  const d = deviationFrom(bare, observe(3, 0, 48));

  check('depth ratio survives with no calibration', close(d.depthRatio, 48 / SETUP_CM, 1e-9));
  check('drift in face widths survives', close(d.lateralFaceWidths, 3 / FACE_CM, 1e-9),
    `${d.lateralFaceWidths.toFixed(3)} face widths`);
  check('cm fields are null, not guessed', d.depthCm === null && d.lateralCm === null);
}

console.log('\npositionAnchor — the gate\n');

{
  const anchor = captureAnchor(anchorSig, { faceWidthCm: FACE_CM, distanceCm: SETUP_CM, distanceSource: 'manual' });
  const tol = DEFAULT_ANCHOR_TOLERANCE;

  check('accepts the setup position', checkAnchor(anchor, anchorSig, tol).ok);

  // Just inside and just outside the 8% depth band.
  check('accepts a 5% depth change', checkAnchor(anchor, observe(0, 0, SETUP_CM * 1.05), tol).ok);
  const far = checkAnchor(anchor, observe(0, 0, SETUP_CM * 1.2), tol);
  check('rejects a 20% recession', far.fault === 'too-far', far.message);
  const near = checkAnchor(anchor, observe(0, 0, SETUP_CM * 0.8), tol);
  check('rejects a 20% approach', near.fault === 'too-close', near.message);

  // Lateral: 0.31 outer-canthal widths ≈ 2.8 cm for this participant.
  check('accepts 2 cm of sway', checkAnchor(anchor, observe(2, 0, SETUP_CM), tol).ok);
  // The physical tolerance must not have moved when the width unit did.
  check('the drift band is still ~2.8 cm', Math.abs(tol.driftFaceWidths * FACE_CM - 2.84) < 0.05,
    `${(tol.driftFaceWidths * FACE_CM).toFixed(2)} cm`);
  const left = checkAnchor(anchor, observe(6, 0, SETUP_CM), tol);
  check('rejects 6 cm of sway', !left.ok, `${left.fault}: ${left.message}`);
  check('sway instruction opposes the drift',
    left.message.startsWith('Move Right') &&
    checkAnchor(anchor, observe(-6, 0, SETUP_CM), tol).message.startsWith('Move Left'));

  const down = checkAnchor(anchor, observe(0, 5, SETUP_CM), tol);
  check('rejects vertical slump', !down.ok, `${down.fault}: ${down.message}`);

  const rot = (yawDeg: number, pitchDeg: number, rollDeg: number) =>
    checkAnchor(anchor, observe(0, 0, SETUP_CM, {
      yaw: (yawDeg * Math.PI) / 180,
      pitch: (pitchDeg * Math.PI) / 180,
      roll: (rollDeg * Math.PI) / 180,
    }), tol);

  // Each axis is judged in ITS OWN units, and the three are not comparable.
  //
  //   roll   a genuine angle — atan2 across the eye-corner line.
  //   yaw    an estimator reading that over-states real rotation by ~2.6×,
  //          because it scales the nose's offset from landmarks that sit
  //          several centimetres behind the nose tip.
  //   pitch  its own scale again, with a large constant offset that the
  //          live-against-anchor comparison cancels.
  //
  // So the tests check each axis against its own gate rather than asserting an
  // ordering between three different units.
  const turned = rot(tol.yawDeg + 10, 0, 0);
  check('rejects a turned head', turned.fault === 'turned', turned.message);
  check('accepts a small head turn', rot(tol.yawDeg - 10, 0, 0).ok);
  check('names which way to turn back',
    rot(tol.yawDeg + 10, 0, 0).message !== rot(-(tol.yawDeg + 10), 0, 0).message,
    `${rot(tol.yawDeg + 10, 0, 0).message} vs ${rot(-(tol.yawDeg + 10), 0, 0).message}`);

  check('pitch has its own bound', !rot(0, tol.pitchDeg + 5, 0).ok, rot(0, tol.pitchDeg + 5, 0).message);
  check('and a nod within it passes', rot(0, tol.pitchDeg - 5, 0).ok);
  check('a large tilt is still caught', !rot(0, 0, tol.rollDeg + 10).ok,
    rot(0, 0, tol.rollDeg + 10).message);
  check('and roll is in true degrees, so 20° of tilt is 20° of tilt',
    rot(0, 0, 20).ok, `gate is ${tol.rollDeg}°`);

  // The yaw estimator over-reads by roughly 2.6×, so the gate has to be stated
  // in its units or it stops people at about 4.6° of real rotation.
  check('the yaw gate leaves room for a real head turn', tol.yawDeg >= 20,
    `${tol.yawDeg} estimator-degrees ≈ ${(tol.yawDeg / 2.6).toFixed(0)}° of actual turn`);

  // Each axis is judged alone, so a small movement on every axis at once must
  // not add up into a rejection the way a max-of-three would suggest.
  check('small movements on all three axes together still pass', rot(10, 10, 10).ok);

  // The depth allowance has a physical floor for the same reason the distance
  // band does: sitting closer does not make a person steadier.
  {
    const near = captureAnchor(anchorSig, { faceWidthCm: FACE_CM, distanceCm: 30, distanceSource: 'manual' });
    // 2.8 cm of depth change at a 30 cm setup — 9.3%, past the 8% percentage
    // band but inside the 3 cm floor.
    const drifted = { ...anchorSig, faceScale: anchorSig.faceScale * (30 / 32.8) };
    check('a near participant is judged on centimetres, not percent',
      checkAnchor(near, drifted, tol).ok,
      '2.8 cm at a 30 cm setup is 9.3% — the floor admits it');
    const farOut = { ...anchorSig, faceScale: anchorSig.faceScale * (30 / 35) };
    check('but the floor is a floor, not an amnesty', !checkAnchor(near, farOut, tol).ok,
      `${checkAnchor(near, farOut, tol).message}`);
  }

  // Rotation outranks depth, because a turned head foreshortens the measured
  // face width and therefore corrupts the depth reading. Reporting depth first
  // handed a distance instruction to someone who had only glanced sideways.
  const turnedAndClose = checkAnchor(
    anchor,
    observe(0, 0, SETUP_CM * 0.85, { yaw: (tol.yawDeg + 15) * Math.PI / 180, pitch: 0, roll: 0 }),
    tol,
  );
  check('a turned head is reported as turned, not as mis-placed',
    turnedAndClose.fault === 'turned', turnedAndClose.message);

  // Depth is reported before drift: it breaks the mapping hardest and is the
  // least visible to the participant.
  const bothWrong = checkAnchor(anchor, observe(8, 0, SETUP_CM * 1.3), tol);
  check('depth fault outranks drift fault', bothWrong.fault === 'too-far', bothWrong.fault);

  check('reports unknown with no anchor', checkAnchor(null, anchorSig, tol).fault === 'unknown');
  check('reports unknown with no face', checkAnchor(anchor, null, tol).fault === 'unknown');
}

console.log('\npositionAnchor — messages degrade without a measured face width\n');

{
  const bare = captureAnchor(anchorSig);
  const c = checkAnchor(bare, observe(6, 0, SETUP_CM));
  check('still gives a direction', c.message.startsWith('Move Right'), c.message);
  check('falls back to the nominal face width for the number',
    c.message.includes(`${Math.round((6 / FACE_CM) * NOMINAL_FACE_WIDTH_CM)}cm`), c.message);
  const depth = checkAnchor(bare, observe(0, 0, SETUP_CM * 1.3));
  check('omits the number it cannot know', depth.message === 'Move Closer', depth.message);
}

console.log('\nface width from a card in the face plane\n');

{
  // The card and the face are at the same depth, so their pixel widths are in
  // the same ratio as their real widths — whatever the focal length is.
  const CARD_CM = 8.56;
  for (const z of [30, 40, 55]) {
    const cardPx = (F_N * CARD_CM) / z * 1920;
    const facePx = (F_N * FACE_CM) / z * 1920;
    const got = faceWidthCmFromCard(cardPx, facePx, CARD_CM);
    check(`recovers face width at ${z} cm`, close(got, FACE_CM, 1e-9), `${got.toFixed(2)} cm`);
  }

  check('rejects a zero-width card', Number.isNaN(faceWidthCmFromCard(0, 100, 8.56)));
  check('accepts a plausible face', isPlausibleFaceWidthCm(FACE_CM));
  check('rejects an implausible face', !isPlausibleFaceWidthCm(45));
  // The band has to be tight enough to catch a misplaced card. A card held
  // forward of the outer-eye-corner plane makes the face read narrow by exactly
  // the fraction it was out of place, and that fraction lands in every distance
  // the session reports afterwards.
  check('accepts a young child', isPlausibleFaceWidthCm(7.6));
  check('accepts a large adult', isPlausibleFaceWidthCm(10.5));
  check('catches a card held ~11 cm forward at 40 cm', !isPlausibleFaceWidthCm(9.1 / 1.3),
    `${(9.1 / 1.3).toFixed(1)} cm — a 30% error the old 6–13 band passed silently`);
  // And the honest limit: a 20% error still lands inside the range of real human
  // faces, so no band on a single number can catch it. Worth stating so nobody
  // mistakes this for a guarantee.
  check('but a 20% error is indistinguishable from a small face',
    isPlausibleFaceWidthCm(9.1 / 1.2),
    `${(9.1 / 1.2).toFixed(1)} cm — inside the real human range, so the band cannot object`);
  check('rejects a bizygomatic width mistaken for the eye span', !isPlausibleFaceWidthCm(14.2));
}

console.log(failures ? `\n${failures} failure(s)\n` : '\nall position-anchor tests passed\n');
process.exit(failures ? 1 : 0);
