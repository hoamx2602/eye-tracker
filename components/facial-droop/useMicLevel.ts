'use client';

import { useEffect, useState } from 'react';

/**
 * Live microphone level, 0..1 (RMS of the audio track, scaled for display).
 * Lets the participant see that the microphone hears them before recording.
 */
export function useMicLevel(stream: MediaStream | null, active: boolean): number {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!stream || !active || stream.getAudioTracks().length === 0) return;
    const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let frame = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const rms = Math.sqrt(sum / samples.length);
      // Speech at arm's length sits around 0.02-0.1 RMS; stretch that to the bar.
      setLevel(Math.min(1, rms * 12));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      void context.close();
      setLevel(0);
    };
  }, [stream, active]);

  return level;
}
