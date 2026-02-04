import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';

interface HeatmapLayerProps {
  x: number;
  y: number;
  enabled: boolean;
}

export interface HeatmapRef {
  reset: () => void;
}

const HeatmapLayer = forwardRef<HeatmapRef, HeatmapLayerProps>(({ x, y, enabled }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shadowCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const paletteRef = useRef<Uint8ClampedArray | null>(null);
  const animationFrameRef = useRef<number>(0);

  // Configuration
  const RADIUS = 25; // Size of the heat point (relative to downscaled canvas)
  const INTENSITY = 0.05; // How fast heat builds up (0-1)
  const SCALE_FACTOR = 0.25; // Downscale factor for performance (0.25 = 1/16th pixels to process)

  // 1. Initialize Gradients and Shadow Canvas
  useEffect(() => {
    if (!canvasRef.current) return;

    // Create Gradient Palette (256 colors)
    const createPalette = () => {
      const c = document.createElement('canvas');
      c.width = 1;
      c.height = 256;
      const ctx = c.getContext('2d');
      if (!ctx) return null;

      const grad = ctx.createLinearGradient(0, 0, 0, 256);
      // Heatmap Gradient: Blue (Cold) -> Cyan -> Green -> Yellow -> Red (Hot)
      grad.addColorStop(0.0, 'transparent');
      grad.addColorStop(0.2, 'blue');
      grad.addColorStop(0.4, 'cyan');
      grad.addColorStop(0.6, 'lime');
      grad.addColorStop(0.8, 'yellow');
      grad.addColorStop(1.0, 'red');

      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 1, 256);
      return ctx.getImageData(0, 0, 1, 256).data;
    };

    paletteRef.current = createPalette();

    // Setup Dimensions
    const width = Math.ceil(window.innerWidth * SCALE_FACTOR);
    const height = Math.ceil(window.innerHeight * SCALE_FACTOR);

    // Visible Canvas
    canvasRef.current.width = width;
    canvasRef.current.height = height;

    // Shadow Canvas (Accumulator)
    const shadow = document.createElement('canvas');
    shadow.width = width;
    shadow.height = height;
    shadowCanvasRef.current = shadow;

  }, []);

  // 2. Handle Reset
  useImperativeHandle(ref, () => ({
    reset: () => {
      if (canvasRef.current && shadowCanvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        const sCtx = shadowCanvasRef.current.getContext('2d');
        ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        sCtx?.clearRect(0, 0, shadowCanvasRef.current.width, shadowCanvasRef.current.height);
      }
    }
  }));

  // 3. Add Points Loop
  useEffect(() => {
    if (!enabled || !shadowCanvasRef.current) return;

    // Draw the "hit" onto the shadow canvas (Grayscale accumulation)
    const ctx = shadowCanvasRef.current.getContext('2d');
    if (!ctx) return;

    // Scale coordinates to match the downscaled canvas
    const scaledX = x * SCALE_FACTOR;
    const scaledY = y * SCALE_FACTOR;

    // Draw a radial gradient (alpha accumulation)
    const grad = ctx.createRadialGradient(scaledX, scaledY, 0, scaledX, scaledY, RADIUS);
    grad.addColorStop(0, `rgba(0,0,0,${INTENSITY})`); // Inner (darker = higher alpha value in memory)
    grad.addColorStop(1, 'rgba(0,0,0,0)'); // Outer transparent

    ctx.fillStyle = grad;
    ctx.fillRect(scaledX - RADIUS, scaledY - RADIUS, RADIUS * 2, RADIUS * 2);

  }, [x, y, enabled]);

  // 4. Colorization Loop (The Render)
  useEffect(() => {
    const render = () => {
      if (!canvasRef.current || !shadowCanvasRef.current || !paletteRef.current) {
        animationFrameRef.current = requestAnimationFrame(render);
        return;
      }

      const ctx = canvasRef.current.getContext('2d');
      const shadowCtx = shadowCanvasRef.current.getContext('2d');
      
      if (!ctx || !shadowCtx) return;

      const width = canvasRef.current.width;
      const height = canvasRef.current.height;

      // Get pixel data
      const shadowImage = shadowCtx.getImageData(0, 0, width, height);
      const shadowData = shadowImage.data;
      
      const targetImage = ctx.createImageData(width, height);
      const targetData = targetImage.data;
      const palette = paletteRef.current;

      // Colorize: Map Alpha of shadow to RGB of palette
      // Optimization: This loop runs ~500k times per frame at 0.25 scale (960x540 -> 240x135)
      // Actually 1920x1080 * 0.25 = 480x270 = 129k pixels. Very fast.
      for (let i = 0; i < shadowData.length; i += 4) {
        const alpha = shadowData[i + 3]; // Use alpha channel from shadow

        if (alpha > 0) {
          // Map 0-255 alpha to 0-255 palette index (x4 for R,G,B,A)
          const offset = alpha * 4;

          targetData[i] = palette[offset];     // R
          targetData[i + 1] = palette[offset + 1]; // G
          targetData[i + 2] = palette[offset + 2]; // B
          targetData[i + 3] = alpha < 10 ? 0 : alpha + 50; // A (Add base visibility)
        }
      }

      ctx.putImageData(targetImage, 0, 0);
      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => cancelAnimationFrame(animationFrameRef.current);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`fixed inset-0 pointer-events-none z-0 transition-opacity duration-500 ${enabled ? 'opacity-100' : 'opacity-0'}`}
      style={{
        width: '100vw',
        height: '100vh',
        filter: 'blur(4px)' // Extra CSS smoothing
      }}
    />
  );
});

export default HeatmapLayer;