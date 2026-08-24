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
const FACE_CM = 14.2;          // this participant, not the nominal 15
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

  // Lateral: 0.2 face widths ≈ 2.8 cm for this participant.
  check('accepts 2 cm of sway', checkAnchor(anchor, observe(2, 0, SETUP_CM), tol).ok);
  const left = checkAnchor(anchor, observe(6, 0, SETUP_CM), tol);
  check('rejects 6 cm of sway', !left.ok, `${left.fault}: ${left.message}`);
  check('sway instruction opposes the drift',
    left.message.startsWith('Move Right') &&
    checkAnchor(anchor, observe(-6, 0, SETUP_CM), tol).message.startsWith('Move Left'));

  const down = checkAnchor(anchor, observe(0, 5, SETUP_CM), tol);
  check('rejects vertical slump', !down.ok, `${down.fault}: ${down.message}`);

  const turned = checkAnchor(anchor, observe(0, 0, SETUP_CM, { yaw: (20 * Math.PI) / 180, pitch: 0, roll: 0 }), tol);
  check('rejects a turned head', turned.fault === 'turned', turned.message);
  check('accepts a small head turn',
    checkAnchor(anchor, observe(0, 0, SETUP_CM, { yaw: (5 * Math.PI) / 180, pitch: 0, roll: 0 }), tol).ok);

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
}

console.log(failures ? `\n${failures} failure(s)\n` : '\nall position-anchor tests passed\n');
process.exit(failures ? 1 : 0);
