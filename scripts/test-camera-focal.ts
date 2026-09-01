/**
 * Behaviour tests for lib/cameraFocal.ts.
 *
 * Run:  npm run test:focal
 *
 * The claim under test is the one the whole flow rests on: that K splits into a
 * camera term and a person term, so one absolute measurement on a machine is
 * enough for everyone who uses it afterwards. So the tests are written as a
 * simulated camera with a known focal length photographing simulated people with
 * known face widths at known distances, and they check that the pipeline
 * recovers the distances it was never told.
 */
import {
  MIN_FOCAL,
  MAX_FOCAL,
  APPROACH_TOLERANCE,
  FOCAL_DRIFT_TOLERANCE,
  NOMINAL_FOCAL,
  approximateDistanceCm,
  calibrateFromFocal,
  canPersistFocalForPlatform,
  cameraKey,
  checkFocalAgainst,
  clearFocal,
  focalFromCalibration,
  fovDegFromFocal,
  isPlausibleFocal,
  kFromFocal,
  loadFocal,
  saveFocal,
  type CameraFocal,
} from '../lib/cameraFocal';
import { calibrate, distanceFromFace } from '../lib/viewingDistance';
import { faceWidthCmFromCard, isPlausibleCardBox, cardLongSidePx } from '../lib/positionAnchor';

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

// A minimal localStorage, since the persistence layer is half the point.
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
};

const PX_PER_CM = 1920 / 34.5;
/** The rig: a webcam with a 65° horizontal field of view. */
const F_TRUE = 1 / (2 * Math.tan((65 * Math.PI) / 180 / 2)); // ≈ 0.785
/** What that camera sees: face width as a fraction of frame width. */
const seenScale = (faceWidthCm: number, distanceCm: number) => (F_TRUE * faceWidthCm) / distanceCm;

console.log('\nfocal length algebra\n');

{
  check('F for a 65° camera is in the webcam range', isPlausibleFocal(F_TRUE),
    `F=${F_TRUE.toFixed(3)}`);
  check('FOV round-trips', close(fovDegFromFocal(F_TRUE), 65, 1e-9),
    `${fovDegFromFocal(F_TRUE).toFixed(1)}°`);
  check('a wider lens is a shorter focal length', fovDegFromFocal(0.6) > fovDegFromFocal(1.2));

  check('rejects a focal length below the band', !isPlausibleFocal(MIN_FOCAL - 0.01));
  check('rejects a focal length above the band', !isPlausibleFocal(MAX_FOCAL + 0.01));
  check('rejects NaN', !isPlausibleFocal(NaN));

  // K = F · W, both ways.
  const k = kFromFocal(F_TRUE, 14.2);
  check('K = F · W', close(k, F_TRUE * 14.2, 1e-12));
  check('F = K / W', close(focalFromCalibration(k, 14.2), F_TRUE, 1e-12));
  check('refuses a zero face width', Number.isNaN(focalFromCalibration(k, 0)));
  check('refuses a zero K', Number.isNaN(focalFromCalibration(0, 14.2)));
}

console.log('\none bootstrap, then every later participant for free\n');

{
  // Participant A does the full sequence once: card at the cheek gives their
  // face width, a tape measure gives one absolute distance.
  const A_FACE_CM = 14.2;
  const A_BOOTSTRAP_CM = 47;

  const calA = calibrate({
    distanceCm: A_BOOTSTRAP_CM,
    faceScale: seenScale(A_FACE_CM, A_BOOTSTRAP_CM),
    pxPerCm: PX_PER_CM,
    method: 'manual',
  })!;
  const fMeasured = focalFromCalibration(calA.k, A_FACE_CM);

  check('the bootstrap recovers the camera it was shot on',
    close(fMeasured, F_TRUE, 1e-9),
    `F=${fMeasured.toFixed(4)} vs true ${F_TRUE.toFixed(4)}`);

  // ...and A's own distances still work, as they did before any of this.
  check('A reads their own distance back',
    close(distanceFromFace(calA, seenScale(A_FACE_CM, 40)), 40, 1e-9));

  // Participant B, later, on the same machine. Card at the cheek only — no tape,
  // no blind spot. A *different* face width, which is the point: if the saving
  // only worked for people shaped like A it would be worthless.
  for (const B_FACE_CM of [12.4, 14.2, 16.8]) {
    const calB = calibrateFromFocal({
      f: fMeasured,
      faceWidthCm: B_FACE_CM,
      faceScale: seenScale(B_FACE_CM, 55),
      pxPerCm: PX_PER_CM,
    })!;
    check(`B (face ${B_FACE_CM} cm) is placed correctly with no absolute measurement`,
      close(calB.distanceCm, 55, 1e-9),
      `reads ${calB.distanceCm.toFixed(2)} cm`);
    for (const d of [30, 40, 60]) {
      check(`  ...and tracks to ${d} cm`,
        close(distanceFromFace(calB, seenScale(B_FACE_CM, d)), d, 1e-9));
    }
    check('  ...and is labelled as reconstructed, not measured',
      calB.method === 'camera-focal');
  }

  // The error that does propagate: a wrong face width scales everything.
  const withBadFace = calibrateFromFocal({
    f: fMeasured, faceWidthCm: 14.2 * 1.05, faceScale: seenScale(14.2, 40), pxPerCm: PX_PER_CM,
  })!;
  check('a 5% face-width error is a 5% distance error — nothing hides it',
    close(withBadFace.distanceCm, 42, 1e-6),
    `reads ${withBadFace.distanceCm.toFixed(2)} cm for a true 40`);
}

console.log('\ncard measurement feeding the split\n');

{
  // The card at the cheek, at three distances. Both objects are in the same
  // plane, so the focal length cancels and the answer must not move.
  const FACE_CM = 14.2;
  const CARD_CM = 8.56;
  for (const d of [30, 40, 55]) {
    const cardPx = (F_TRUE * CARD_CM) / d * 1920;
    const facePx = (F_TRUE * FACE_CM) / d * 1920;
    const got = faceWidthCmFromCard(cardPx, facePx, CARD_CM);
    check(`recovers face width at ${d} cm`, close(got, FACE_CM, 1e-9), `${got.toFixed(2)} cm`);
  }

  // A card out of the face plane does not cancel, and the error is one-directional.
  const dFace = 40;
  for (const offset of [-2, 2]) {
    const cardPx = (F_TRUE * CARD_CM) / (dFace + offset) * 1920;
    const facePx = (F_TRUE * FACE_CM) / dFace * 1920;
    const got = faceWidthCmFromCard(cardPx, facePx, CARD_CM);
    check(`a card ${Math.abs(offset)} cm ${offset < 0 ? 'nearer' : 'further'} than the cheek skews it`,
      Math.abs(got - FACE_CM) / FACE_CM > 0.04,
      `${got.toFixed(2)} cm (${(100 * (got - FACE_CM) / FACE_CM).toFixed(1)}%)`);
  }

  // Aspect ratio catches a box that is not a card seen square-on.
  check('accepts a landscape card box', isPlausibleCardBox(320, 202));
  check('accepts the same card held portrait', isPlausibleCardBox(202, 320));
  check('takes the long side whichever way up', cardLongSidePx(202, 320) === 320);
  check('rejects a square box', !isPlausibleCardBox(300, 300));
  check('rejects a badly tilted card', !isPlausibleCardBox(320, 140));
  check('rejects a zero-height box', !isPlausibleCardBox(320, 0));
}

console.log('\ncoarse estimate, for walking someone to their seat\n');

{
  // Before the camera is measured, the face width alone gives a distance good to
  // about the spread of webcam fields of view. Enough to place someone; not
  // enough to hold them.
  const FACE_CM = 14.2;
  check('nominal focal length is a plausible webcam', isPlausibleFocal(NOMINAL_FOCAL),
    `F=${NOMINAL_FOCAL.toFixed(3)} (${fovDegFromFocal(NOMINAL_FOCAL).toFixed(0)}°)`);

  // On the nominal camera it is exact...
  const onNominal = approximateDistanceCm(FACE_CM, (NOMINAL_FOCAL * FACE_CM) / 40);
  check('exact on a camera that matches the assumption', close(onNominal, 40, 1e-9));

  // ...and across the real range of webcam optics it stays inside the loose gate.
  let worst = 0;
  for (const fov of [54, 60, 65, 70, 78]) {
    const fTrue = 1 / (2 * Math.tan((fov * Math.PI) / 180 / 2));
    const est = approximateDistanceCm(FACE_CM, (fTrue * FACE_CM) / 40);
    const err = Math.abs(est - 40) / 40;
    worst = Math.max(worst, err);
    check(`  ${fov}° camera reads a true 40 cm as ${est.toFixed(1)} cm`, err < APPROACH_TOLERANCE,
      `${(err * 100).toFixed(0)}% off, gate is ${(APPROACH_TOLERANCE * 100).toFixed(0)}%`);
  }
  check('so no real webcam can be stranded by the approach gate', worst < APPROACH_TOLERANCE,
    `worst ${(worst * 100).toFixed(0)}% vs gate ${(APPROACH_TOLERANCE * 100).toFixed(0)}%`);

  check('says it does not know without a face width',
    Number.isNaN(approximateDistanceCm(null, 0.28)));
  check('says it does not know without a face', Number.isNaN(approximateDistanceCm(14.2, 0)));
}

console.log('\ncache identity and staleness\n');

{
  const key = cameraKey('abcdef0123456789xyz', 1920, 1080);
  check('the same sensor at another resolution keeps its key',
    cameraKey('abcdef0123456789xyz', 1280, 720) === key,
    'F is in frame widths, so resolution does not change it');
  check('a different sensor crop gets a different key',
    cameraKey('abcdef0123456789xyz', 1280, 960) !== key);
  check('an exposed zoom level gets a different optical key',
    cameraKey('abcdef0123456789xyz', 1920, 1080, { zoom: 1 }) !==
      cameraKey('abcdef0123456789xyz', 1920, 1080, { zoom: 1.5 }));
  check('resizeMode is part of the optical key',
    cameraKey('abcdef0123456789xyz', 1920, 1080, { resizeMode: 'none' }) !==
      cameraKey('abcdef0123456789xyz', 1920, 1080, { resizeMode: 'crop-and-scale' }));
  check('a different device gets a different key',
    cameraKey('9999999999999999zzz', 1920, 1080) !== key);
  check('a missing deviceId still produces a stable key',
    cameraKey(undefined, 1920, 1080) === cameraKey(undefined, 1920, 1080));

  const record: CameraFocal = {
    f: F_TRUE,
    cameraKey: key,
    method: 'manual',
    bootstrapDistanceCm: 47,
    faceWidthCm: 14.2,
    measuredAt: new Date().toISOString(),
  };
  check('saves', saveFocal(record));
  check('loads back under its own key', loadFocal(key)?.f === F_TRUE);
  check('refuses to load under another camera key',
    loadFocal(cameraKey('9999999999999999zzz', 1920, 1080)) === null,
    'a focal length from other optics is worse than none');
  check('refuses to save an implausible focal length',
    !saveFocal({ ...record, f: 99 }));

  const zoomedKey = cameraKey('abcdef0123456789xyz', 1920, 1080, { zoom: 1.5 });
  check('stores a second optical profile without overwriting the first',
    saveFocal({ ...record, cameraKey: zoomedKey, f: F_TRUE * 1.5 }) &&
      loadFocal(key)?.f === F_TRUE && loadFocal(zoomedKey)?.f === F_TRUE * 1.5);
  clearFocal(zoomedKey);
  check('clears only the selected optical profile',
    loadFocal(zoomedKey) === null && loadFocal(key)?.f === F_TRUE);

  clearFocal();
  check('clears', loadFocal(key) === null);

  // Cross-check against a fresh measurement.
  check('agrees with itself', checkFocalAgainst(record, F_TRUE).ok);
  const smallDrift = F_TRUE * (1 + FOCAL_DRIFT_TOLERANCE / 2);
  check('tolerates drift within the bootstrap uncertainty',
    checkFocalAgainst(record, smallDrift).ok,
    'the blind spot carries ±11.5% of its own');
  const bigDrift = F_TRUE * 1.6;
  const flagged = checkFocalAgainst(record, bigDrift);
  check('flags a gross mismatch', !flagged.ok, flagged.message.slice(0, 60) + '…');
  check('no cached value means nothing to disagree with',
    checkFocalAgainst(null, F_TRUE).ok);
}

console.log('\nopaque OS framing policy\n');

{
  check('macOS focal cache is session-only', !canPersistFocalForPlatform('macOS'));
  check('legacy MacIntel platform is session-only', !canPersistFocalForPlatform('MacIntel'));
  check('iPad desktop-class browser is session-only', !canPersistFocalForPlatform('iPad'));
  check('a fixed Linux UVC camera keeps persistent profiles', canPersistFocalForPlatform('Linux x86_64'));
}

console.log(failures ? `\n${failures} failure(s)\n` : '\nall camera-focal tests passed\n');
process.exit(failures ? 1 : 0);
