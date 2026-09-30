/**
 * MediaPipe Face Landmarker in IMAGE mode for still uploads. Separate from the
 * VIDEO-mode instance in services/eyeTrackingService.ts: one landmarker cannot
 * switch running mode cheaply, and the IOP tool must not disturb a live
 * tracking session. Runs on the CPU delegate so no GPU is required.
 */
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { geometryFromLandmarks } from './eyeGeometry';
import type { EyeGeometry, RgbImage } from './types';

// Same assets the gaze pipeline loads, so the browser cache is shared.
const WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm';
const MODEL_PATH = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

let landmarkerPromise: Promise<FaceLandmarker> | null = null;

function getLandmarker(): Promise<FaceLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = FilesetResolver.forVisionTasks(WASM_PATH).then((fileset) =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' },
        runningMode: 'IMAGE',
        numFaces: 1,
      }),
    );
    landmarkerPromise.catch(() => {
      landmarkerPromise = null;
    });
  }
  return landmarkerPromise;
}

/** Landmarks are normalised, so detection runs on a copy no larger than this; the eye itself is measured at full size. */
const DETECTION_MAX_SIDE = 1600;

/**
 * Detects the face and returns geometry for each eye found (0, 1 or 2), in
 * the full-resolution pixel frame of `source`. An eye close-up with no face
 * around it returns [] - use manual points then.
 */
export async function detectEyes(source: HTMLCanvasElement): Promise<EyeGeometry[]> {
  const landmarker = await getLandmarker();
  const shrink = Math.min(1, DETECTION_MAX_SIDE / Math.max(source.width, source.height));
  let input = source;
  if (shrink < 1) {
    input = document.createElement('canvas');
    input.width = Math.round(source.width * shrink);
    input.height = Math.round(source.height * shrink);
    input.getContext('2d')?.drawImage(source, 0, 0, input.width, input.height);
  }
  const face = landmarker.detect(input).faceLandmarks[0];
  if (!face) return [];
  return geometryFromLandmarks(face, source.width, source.height);
}

/** Reads a decoded image into the pipeline's RGB format at full resolution. */
export function imageToRgb(image: HTMLImageElement): { rgb: RgbImage; canvas: HTMLCanvasElement } {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D context unavailable');
  context.drawImage(image, 0, 0);
  const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const data = new Uint8ClampedArray(canvas.width * canvas.height * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    data[j] = rgba[i];
    data[j + 1] = rgba[i + 1];
    data[j + 2] = rgba[i + 2];
  }
  return { rgb: { width: canvas.width, height: canvas.height, data }, canvas };
}
