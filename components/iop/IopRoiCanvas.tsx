'use client';

import React, { useEffect, useRef } from 'react';
import type { Circle, EyeAnalysis } from '@/lib/iop/types';

export interface RoiLayers {
  sclera: boolean;
  red: boolean;
  contour: boolean;
  circles: boolean;
}

interface IopRoiCanvasProps {
  eye: EyeAnalysis;
  layers: RoiLayers;
}

const tint = (pixels: Uint8ClampedArray, i: number, rgb: [number, number, number], alpha: number) => {
  for (let c = 0; c < 3; c++) pixels[i * 4 + c] = pixels[i * 4 + c] * (1 - alpha) + rgb[c] * alpha;
};

/** Normalised eye crop with the masks the features were computed on. */
export default function IopRoiCanvas({ eye, layers }: IopRoiCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const { width, height, data } = eye.roi;
    canvas.width = width;
    canvas.height = height;
    const frame = context.createImageData(width, height);
    for (let i = 0; i < width * height; i++) {
      frame.data.set([data[i * 3], data[i * 3 + 1], data[i * 3 + 2], 255], i * 4);
      if (layers.sclera && eye.scleraMask[i]) tint(frame.data, i, [59, 130, 246], 0.25);
      if (layers.contour && eye.scleraMask[i] && !eye.contourMask[i]) tint(frame.data, i, [250, 204, 21], 0.45);
      if (layers.red && eye.redMask[i]) tint(frame.data, i, [236, 72, 153], 0.85);
    }
    context.putImageData(frame, 0, 0);
    if (!layers.circles) return;
    const ring = (circle: Circle, colour: string) => {
      context.strokeStyle = colour;
      context.lineWidth = 1.5;
      context.beginPath();
      context.arc(circle.cx, circle.cy, circle.r, 0, Math.PI * 2);
      context.stroke();
    };
    ring(eye.iris, '#3b82f6');
    ring(eye.pupil, '#ef4444');
    context.strokeStyle = '#22c55e';
    context.beginPath();
    eye.eyelid.forEach((p, k) => (k === 0 ? context.moveTo(p.x, p.y) : context.lineTo(p.x, p.y)));
    context.closePath();
    context.stroke();
  }, [eye, layers]);

  return <canvas ref={canvasRef} className="w-full h-auto rounded bg-black [image-rendering:pixelated]" />;
}
