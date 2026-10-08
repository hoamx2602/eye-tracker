'use client';

import { useEffect, useRef } from 'react';
import { createIrisTexture, drawEye, type EyeMotion } from './eyeArtwork';

export function useEyeScene(paused: boolean, neural: boolean) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<HTMLButtonElement>(null);
  const textureRef = useRef<HTMLCanvasElement | null>(null);
  const modeRef = useRef(neural);
  const motion = useRef<EyeMotion>({ time: 0, gaze: { x: 0, y: 0 }, reaction: 2, neural: 0, intro: 0, scroll: 0, pointer: { x: 0, y: 0, visible: 0 } });
  const syncRef = useRef<() => void>(() => {});

  useEffect(() => { modeRef.current = neural; syncRef.current(); }, [neural]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const scene = sceneRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !scene) return;
    const iris = textureRef.current ?? createIrisTexture();
    textureRef.current = iris;
    const scroller = scene.closest<HTMLElement>('[data-landing-scroll]');
    const stage = scene.parentElement;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduced = media.matches;
    let visible = true;
    let frame = 0;
    let previous = 0;
    let width = 0;
    let height = 0;
    let lastPointerTime = -10;
    let hovering = false;
    let scrollTarget = 0;
    const target = { ...motion.current.gaze };
    const pointerTarget = { x: 0, y: 0 };
    const state = motion.current;

    const paint = () => {
      if (!width || !height) return;
      ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
      drawEye(ctx, iris, state, width, height);
      stage?.style.setProperty('--scene-progress', String(state.scroll));
    };
    const tick = (now: number) => {
      frame = 0;
      if (paused || reduced || !visible || document.hidden) return;
      if (!previous) previous = now;
      const delta = now - previous;
      if (delta >= 1000 / 30) {
        const seconds = Math.min(delta, 80) / 1000;
        state.time += seconds;
        state.reaction = Math.min(2, state.reaction + seconds / 2.1);
        state.intro = Math.min(1, state.intro + seconds / 1.8);
        state.neural += (Number(modeRef.current) - state.neural) * .065;
        state.scroll += (scrollTarget - state.scroll) * .12;
        previous = now;
        const following = state.time - lastPointerTime < 5;
        state.gaze.x += ((following ? target.x : Math.sin(state.time * .35) * 15) - state.gaze.x) * .085;
        state.gaze.y += ((following ? target.y : Math.cos(state.time * .27) * 6) - state.gaze.y) * .085;
        state.pointer.x += (pointerTarget.x - state.pointer.x) * .3;
        state.pointer.y += (pointerTarget.y - state.pointer.y) * .3;
        state.pointer.visible += (Number(hovering) - state.pointer.visible) * .15;
        paint();
      }
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(frame); frame = 0; previous = 0;
      if (paused || reduced) {
        state.neural = Number(modeRef.current);
        state.intro = 1;
        state.pointer.visible = 0;
        state.scroll = 0;
      }
      paint();
      if (!paused && !reduced && visible && !document.hidden) frame = requestAnimationFrame(tick);
    };
    syncRef.current = sync;
    const updateScroll = () => {
      scrollTarget = Math.max(0, Math.min(1, (scroller?.scrollTop ?? 0) / Math.max(1, height * .55)));
    };
    const resize = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width; height = entry.contentRect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      updateScroll(); sync();
    });
    const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }, { root: scroller });
    const motionChange = () => { reduced = media.matches; sync(); };
    const pointAt = (x: number, y: number) => {
      const rect = canvas.getBoundingClientRect();
      target.x = Math.max(-37, Math.min(37, (x - rect.left - width / 2) / width * 85));
      target.y = Math.max(-20, Math.min(20, (y - rect.top - height * .455) / height * 45));
      pointerTarget.x = x - rect.left; pointerTarget.y = y - rect.top;
      lastPointerTime = state.time;
    };
    const pointerMove = (event: PointerEvent) => {
      if (paused || reduced || !visible || !width || !height || event.pointerType === 'touch') return;
      pointAt(event.clientX, event.clientY); hovering = true;
    };
    const pointerLeave = () => { hovering = false; };
    const interact = (event: MouseEvent) => {
      if (paused || reduced || !visible || !width || !height) return;
      if (event.detail > 0) pointAt(event.clientX, event.clientY);
      else { target.x = 0; target.y = 0; lastPointerTime = state.time; }
      state.reaction = 0;
    };
    resize.observe(canvas); intersection.observe(canvas);
    media.addEventListener('change', motionChange);
    document.addEventListener('visibilitychange', sync);
    scroller?.addEventListener('scroll', updateScroll, { passive: true });
    scene.addEventListener('pointermove', pointerMove, { passive: true });
    scene.addEventListener('pointerleave', pointerLeave);
    scene.addEventListener('click', interact);
    return () => {
      cancelAnimationFrame(frame); resize.disconnect(); intersection.disconnect();
      media.removeEventListener('change', motionChange);
      document.removeEventListener('visibilitychange', sync);
      scroller?.removeEventListener('scroll', updateScroll);
      scene.removeEventListener('pointermove', pointerMove);
      scene.removeEventListener('pointerleave', pointerLeave);
      scene.removeEventListener('click', interact);
      syncRef.current = () => {};
    };
  }, [paused]);
  return { canvasRef, sceneRef };
}
