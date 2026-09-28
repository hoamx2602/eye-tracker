/**
 * Checks that tell the researcher when a measurement should not be trusted.
 * The paper assumes controlled capture (20 cm, fixed lighting, 3241 x 2545);
 * uploads are not, so every result carries these flags.
 */
import type { Circle, EyeGeometry, Point, QualityFlag } from './types';

/** Below this iris radius in the source image the sclera vessels are a few pixels wide at best. */
const MIN_SOURCE_IRIS_RADIUS = 30;
/** Pupil edge jump (0..255) under which the pupil circle is a guess - typical of dark irises in visible light. */
const MIN_PUPIL_CONTRAST = 15;
const MAX_GLARE_FRACTION = 0.1;
/** Palpebral opening height over iris diameter; below this the lids cover much of the iris and sclera. */
const MIN_OPENING_RATIO = 0.6;
const MIN_SCLERA_PIXELS = 1500;

export interface QualityInput {
  geometry: EyeGeometry;
  iris: Circle;
  eyelid: Point[];
  eye: Uint8Array;
  sclera: Uint8Array;
  pupilContrast: number;
  irisRefined: boolean;
  /** ROI width, to locate mask pixels. */
  width: number;
}

export function assessQuality(input: QualityInput): QualityFlag[] {
  const { geometry, iris, eyelid, eye, sclera, pupilContrast, irisRefined, width } = input;
  const flags: QualityFlag[] = [];
  if (geometry.iris.r < MIN_SOURCE_IRIS_RADIUS) {
    flags.push({
      code: 'low_resolution',
      message: `Iris radius is ${geometry.iris.r.toFixed(0)} px in the photo (want >= ${MIN_SOURCE_IRIS_RADIUS}). Use a closer or higher-resolution photo.`,
    });
  }
  const ys = eyelid.map((p) => p.y);
  const opening = (Math.max(...ys) - Math.min(...ys)) / (2 * iris.r);
  if (opening < MIN_OPENING_RATIO) {
    flags.push({ code: 'eye_not_open', message: `Eye opening is ${(opening * 100).toFixed(0)}% of the iris diameter; ask for eyes wide open.` });
  }
  if (!irisRefined) {
    flags.push({ code: 'iris_refine_failed', message: 'No clear iris/sclera edge; the iris circle comes straight from the landmarks or clicks.' });
  }
  if (pupilContrast < MIN_PUPIL_CONTRAST) {
    flags.push({
      code: 'pupil_low_contrast',
      message: `Pupil edge is faint (contrast ${pupilContrast.toFixed(0)}); the pupil/iris ratio is unreliable. Common with dark irises in visible light.`,
    });
  }
  const glareFraction = glareShare(eye, sclera, iris, width);
  if (glareFraction > MAX_GLARE_FRACTION) {
    flags.push({ code: 'glare', message: `${(glareFraction * 100).toFixed(0)}% of the sclera is specular glare and was excluded.` });
  }
  const scleraCount = sclera.reduce((sum, v) => sum + v, 0);
  if (scleraCount < MIN_SCLERA_PIXELS) {
    flags.push({ code: 'small_sclera', message: `Only ${scleraCount} sclera pixels after normalisation; redness features are noisy.` });
  }
  return flags;
}

/** Share of the eye opening outside the iris that was dropped from the sclera as glare. */
function glareShare(eye: Uint8Array, sclera: Uint8Array, iris: Circle, width: number): number {
  let candidates = 0;
  let kept = 0;
  for (let i = 0; i < eye.length; i++) {
    if (!eye[i]) continue;
    const x = (i % width) + 0.5;
    const y = Math.floor(i / width) + 0.5;
    if (Math.hypot(x - iris.cx, y - iris.cy) <= iris.r + 1) continue;
    candidates++;
    kept += sclera[i];
  }
  return candidates === 0 ? 0 : 1 - kept / candidates;
}
