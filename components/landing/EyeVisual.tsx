'use client';

import { useEffect, useRef } from 'react';
import { createIrisTexture, drawEye } from './eyeArtwork';
import styles from './Landing.module.css';

export default function EyeVisual({ paused }: { paused: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<HTMLButtonElement>(null);
  const textureRef = useRef<HTMLCanvasElement | null>(null);
  const elapsed = useRef(0);
  const gaze = useRef({ x: 0, y: 0 });
  const reactionStart = useRef(-10);

  useEffect(() => {
    const canvas = canvasRef.current;
    const scene = sceneRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !scene) return;
    const iris = textureRef.current ?? createIrisTexture();
    textureRef.current = iris;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduced = media.matches;
    let visible = true;
    let frame = 0;
    let previous = 0;
    let width = 0;
    let height = 0;
    let lastPointerTime = -10;
    const target = { ...gaze.current };

    const paint = () => {
      if (!width || !height) return;
      ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
      drawEye(ctx, iris, elapsed.current, gaze.current, (elapsed.current - reactionStart.current) / 1.8, width, height);
    };
    const tick = (now: number) => {
      frame = 0;
      if (paused || reduced || !visible || document.hidden) return;
      if (!previous) previous = now;
      const delta = now - previous;
      if (delta >= 1000 / 30) {
        elapsed.current += Math.min(delta, 80) / 1000;
        previous = now;
        const following = elapsed.current - lastPointerTime < 3;
        const x = following ? target.x : Math.sin(elapsed.current * .35) * 12;
        const y = following ? target.y : Math.cos(elapsed.current * .27) * 5;
        gaze.current.x += (x - gaze.current.x) * .09;
        gaze.current.y += (y - gaze.current.y) * .09;
        paint();
      }
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      previous = 0;
      paint();
      if (!paused && !reduced && visible && !document.hidden) frame = requestAnimationFrame(tick);
    };
    const resize = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width;
      height = entry.contentRect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      sync();
    });
    const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
    const motionChange = () => { reduced = media.matches; sync(); };
    const pointAt = (x: number, y: number) => {
      const rect = canvas.getBoundingClientRect();
      target.x = Math.max(-32, Math.min(32, (x - rect.left - width / 2) / width * 75));
      target.y = Math.max(-17, Math.min(17, (y - rect.top - height * .46) / height * 40));
      lastPointerTime = elapsed.current;
    };
    const pointerMove = (event: PointerEvent) => {
      if (paused || reduced || !visible || !width || !height || event.pointerType === 'touch') return;
      pointAt(event.clientX, event.clientY);
    };
    const interact = (event: MouseEvent) => {
      if (paused || reduced || !visible || !width || !height) return;
      if (event.detail > 0) pointAt(event.clientX, event.clientY);
      else { target.x = 0; target.y = 0; lastPointerTime = elapsed.current; }
      reactionStart.current = elapsed.current;
    };
    resize.observe(canvas);
    intersection.observe(canvas);
    media.addEventListener('change', motionChange);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('pointermove', pointerMove, { passive: true });
    scene.addEventListener('click', interact);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect(); intersection.disconnect();
      media.removeEventListener('change', motionChange);
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('pointermove', pointerMove);
      scene.removeEventListener('click', interact);
    };
  }, [paused]);

  return <button ref={sceneRef} type="button" className={styles.eyeScene} aria-label="Interact with the eye" title="Click or tap to focus the eye">
    <canvas ref={canvasRef} className={styles.eyeCanvas} aria-hidden="true" />
  </button>;
}
