'use client';

import { useEyeScene } from './useEyeScene';
import styles from './Landing.module.css';

export default function EyeVisual({ paused, neural }: { paused: boolean; neural: boolean }) {
  const { sceneRef, canvasRef } = useEyeScene(paused, neural);
  return <button ref={sceneRef} type="button" className={styles.eyeScene} aria-label="Interact with the eye" title="Click or tap to send a pulse">
    <canvas ref={canvasRef} className={styles.eyeCanvas} aria-hidden="true" />
  </button>;
}
