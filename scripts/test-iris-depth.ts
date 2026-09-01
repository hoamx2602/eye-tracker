/** Behaviour tests for MediaPipe Depth-from-Iris integration. */
import {
  POPULATION_IRIS_DIAMETER_CM,
  distanceFromIris,
  fuseViewingDistance,
  irisDiameterNorm,
  irisKFromCalibration,
  irisKFromFocal,
} from '../lib/irisDepth';
import { calibrate, distanceFromFace } from '../lib/viewingDistance';

let failures = 0;
const close = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance;
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\niris landmark geometry\n');

{
  const aspect = 16 / 9;
  const landmarks = Array.from({ length: 478 }, () => ({ x: 0, y: 0 }));
  // A circle with a 0.02-frame-width diameter. Y is normalised by frame height,
  // so the same physical radius is multiplied by the aspect in landmark space.
  const putIris = (indices: number[], cx: number) => {
    const r = 0.01;
    landmarks[indices[0]] = { x: cx + r, y: 0.5 };
    landmarks[indices[1]] = { x: cx, y: 0.5 + r * aspect };
    landmarks[indices[2]] = { x: cx - r, y: 0.5 };
    landmarks[indices[3]] = { x: cx, y: 0.5 - r * aspect };
  };
  putIris([469, 470, 471, 472], 0.4);
  putIris([474, 475, 476, 477], 0.6);
  check('recovers diameter in frame-width units',
    close(irisDiameterNorm(landmarks, aspect), 0.02, 1e-12));
  check('rejects a mesh without iris landmarks', Number.isNaN(irisDiameterNorm([], aspect)));
}

console.log('\ndepth algebra and fusion\n');

{
  const focal = 0.8;
  const trueDistance = 40;
  const projectedIris = focal * POPULATION_IRIS_DIAMETER_CM / trueDistance;
  const populationK = irisKFromFocal(focal);
  check('population prior round-trips pinhole depth',
    close(distanceFromIris(populationK, projectedIris), trueDistance, 1e-12));

  const subjectK = irisKFromCalibration(47, 0.021);
  check('subject anchor round-trips', close(distanceFromIris(subjectK, 0.021), 47, 1e-12));

  const fused = fuseViewingDistance(40, 44);
  check('nearby independent estimates use geometric fusion',
    fused.source === 'face+iris' && close(fused.distanceCm, Math.sqrt(40 * 44), 1e-12));
  const rejected = fuseViewingDistance(40, 70);
  check('gross iris outlier falls back to the face anchor',
    rejected.source === 'face' && rejected.distanceCm === 40);

  const cal = calibrate({
    distanceCm: 40,
    faceScale: 0.2,
    irisScale: 0.02,
    pxPerCm: 55,
    method: 'manual',
  })!;
  check('viewing-distance calibration stores a subject iris constant',
    cal.irisK != null && close(cal.irisK, 0.8, 1e-12));
  check('fused live distance tracks a coherent move',
    close(distanceFromFace(cal, 0.16, 0.016), 50, 1e-12));
}

console.log(failures ? `\n${failures} failure(s)\n` : '\nall iris-depth tests passed\n');
process.exit(failures ? 1 : 0);
