'use client';

import { useCallback, useEffect, useState } from 'react';
import { loadIopModel, type IopModel } from '@/lib/iop/classifier';
import { detectCloseUpEye } from '@/lib/iop/closeUpDetector';
import { geometryFromManualPoints, type ManualEyePoints } from '@/lib/iop/eyeGeometry';
import { detectEyes, imageToRgb } from '@/lib/iop/landmarker';
import { analyzeEye } from '@/lib/iop/pipeline';
import type { EyeAnalysis, EyeGeometry, EyeSideLabel, RgbImage } from '@/lib/iop/types';

export type IopStatus = 'idle' | 'loading-image' | 'detecting' | 'analyzing' | 'needs-manual' | 'done' | 'error';

export interface LoadedImage {
  name: string;
  url: string;
  width: number;
  height: number;
  rgb: RgbImage;
  canvas: HTMLCanvasElement;
}

/** Lets React paint the status before a long synchronous step. */
const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 30));

function decode(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('This file could not be decoded as an image.'));
    image.src = URL.createObjectURL(file);
  });
}

/**
 * Face landmarks, or none if MediaPipe cannot run here. Its graph needs WebGL
 * even on the CPU delegate; without it (GPU blocked, old driver) the photo can
 * still be a close-up the CPU-only detector handles, so this must not abort.
 */
async function detectFaceEyes(canvas: HTMLCanvasElement): Promise<EyeGeometry[]> {
  try {
    return await detectEyes(canvas);
  } catch (caught) {
    console.warn('[iop] face landmarker unavailable, trying the close-up detector', caught);
    return [];
  }
}

/**
 * Upload -> face landmarks, or for an eye close-up the close-up detector ->
 * per-eye analysis. Manual points only when both fail.
 */
export function useIopAnalysis() {
  const [status, setStatus] = useState<IopStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [eyes, setEyes] = useState<EyeAnalysis[]>([]);
  const [model, setModel] = useState<IopModel | null>(null);
  /** Why automatic detection gave up, shown above the manual picker. */
  const [autoFailure, setAutoFailure] = useState<string | null>(null);

  useEffect(() => {
    loadIopModel().then(setModel);
  }, []);

  const analyze = useCallback(async (rgb: RgbImage, geometries: EyeGeometry[]) => {
    setStatus('analyzing');
    await nextFrame();
    try {
      setEyes(geometries.map((geometry) => analyzeEye(rgb, geometry)));
      setStatus('done');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus('error');
    }
  }, []);

  const loadFile = useCallback(async (file: File) => {
    setError(null);
    setAutoFailure(null);
    setEyes([]);
    setStatus('loading-image');
    try {
      const decoded = await decode(file);
      const { rgb, canvas } = imageToRgb(decoded);
      const loaded = { name: file.name, url: decoded.src, width: rgb.width, height: rgb.height, rgb, canvas };
      setImage((previous) => {
        if (previous) URL.revokeObjectURL(previous.url);
        return loaded;
      });
      setStatus('detecting');
      await nextFrame();
      const faceEyes = await detectFaceEyes(canvas);
      if (faceEyes.length > 0) {
        await analyze(rgb, faceEyes);
        return;
      }
      // No face: most likely an eye close-up, the paper's own capture.
      const closeUp = detectCloseUpEye(rgb);
      if (closeUp.geometry) {
        await analyze(rgb, [closeUp.geometry]);
        return;
      }
      setAutoFailure(closeUp.reason ?? 'The eye could not be located automatically.');
      setStatus('needs-manual');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus('error');
    }
  }, [analyze]);

  const analyzeManual = useCallback(async (points: ManualEyePoints, side: EyeSideLabel) => {
    if (!image) return;
    setError(null);
    await analyze(image.rgb, [geometryFromManualPoints(points, side)]);
  }, [analyze, image]);

  const startManual = useCallback(() => setStatus('needs-manual'), []);

  return { status, error, image, eyes, model, autoFailure, loadFile, analyzeManual, startManual };
}
