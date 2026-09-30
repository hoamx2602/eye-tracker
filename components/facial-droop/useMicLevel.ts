'use client';

import { useEffect, useState } from 'react';

/** Bars in the equaliser display. */
export const MIC_BANDS = 24;
/** Frequency range the bars cover: where speech energy sits. */
const LOW_HZ = 90;
const HIGH_HZ = 4000;
/**
 * Display scale, in dB above the background noise: nothing shows below
 * GATE_DB (room noise flickers inside that), and a bar is full at
 * GATE_DB + RANGE_DB.
 */
const GATE_DB = 9;
const RANGE_DB = 30;
/**
 * Speech peaks ~20-30 dB above a quiet room but dips between syllables, so
 * the mic is confirmed once frames above SPEECH_ABOVE_NOISE_DB add up to
 * SPEECH_MS - not necessarily in one run. Room noise never gets there, and a
 * single bang (~100 ms) is not enough.
 */
const SPEECH_ABOVE_NOISE_DB = 15;
const SPEECH_MS = 400;
/**
 * Noise floor = the quietest frame in this many recent frames (~2 s at 60 fps):
 * speech always has pauses, so the minimum falls back to the room noise.
 */
const FLOOR_WINDOW = 120;
/**
 * The first frames are skipped (~0.3 s): the analyser's smoothing starts from
 * near -infinity and ramps up, and a floor that saw those would sit far too
 * low. After that, the floor is trusted once it has WARM_UP_FRAMES (~0.5 s).
 */
const SKIP_FRAMES = 20;
const WARM_UP_FRAMES = 30;
/** The minimum sits below the average noise; this lifts it to where noise actually lives. */
const FLOOR_BIAS_DB = 3;
/** Anything quieter is digital silence (no audio flowing yet), not room noise. */
const DIGITAL_SILENCE_DB = -110;

export interface MicActivity {
  /** Loudness above the background noise, 0..1, smoothed. 0 in a quiet room. */
  level: number;
  /** Per-band energy above the background noise, 0..1, for the equaliser. */
  bands: number[];
  /** True once sustained speech-level sound has been heard. */
  heard: boolean;
  /** The browser is holding audio until the next click or key press. */
  suspended: boolean;
}

const SILENT: MicActivity = { level: 0, bands: new Array(MIC_BANDS).fill(0), heard: false, suspended: false };

/**
 * Background noise of one signal in dB, by minimum statistics: the quietest
 * of the last FLOOR_WINDOW frames plus a small bias. It follows the steady
 * room noise (fan, hum, mic hiss) and is not lifted by speech.
 */
class NoiseFloor {
  private readonly history = new Float32Array(FLOOR_WINDOW);
  private count = 0;
  private skipped = 0;

  push(db: number): void {
    if (this.skipped < SKIP_FRAMES) {
      this.skipped++;
      return;
    }
    this.history[this.count % FLOOR_WINDOW] = db;
    this.count++;
  }

  get ready(): boolean {
    return this.count >= WARM_UP_FRAMES;
  }

  get value(): number {
    let min = Infinity;
    for (let k = 0; k < Math.min(this.count, FLOOR_WINDOW); k++) min = Math.min(min, this.history[k]);
    return min + FLOOR_BIAS_DB;
  }
}

const aboveFloor = (value: number, floor: number) => Math.min(1, Math.max(0, (value - floor - GATE_DB) / RANGE_DB));

/**
 * Live microphone activity for the check screen, relative to the room's own
 * background noise, so the display is flat in silence and jumps with speech.
 * Chrome starts an AudioContext created outside a user gesture as suspended -
 * which is what happens after awaiting the permission prompt - so it is
 * resumed straight away and again on the next click or key press.
 */
export function useMicLevel(stream: MediaStream | null, active: boolean): MicActivity {
  const [activity, setActivity] = useState<MicActivity>(SILENT);

  useEffect(() => {
    if (!stream || !active || stream.getAudioTracks().length === 0) return;
    const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.5;
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);

    const resume = () => { if (context.state === 'suspended') void context.resume(); };
    resume();
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);

    const time = new Float32Array(analyser.fftSize);
    const freq = new Float32Array(analyser.frequencyBinCount);
    const hzPerBin = context.sampleRate / analyser.fftSize;
    // Log-spaced band edges: low frequencies get finer bars, as the ear hears them.
    const edges = Array.from({ length: MIC_BANDS + 1 }, (_, k) => Math.round((LOW_HZ * (HIGH_HZ / LOW_HZ) ** (k / MIC_BANDS)) / hzPerBin));
    const bandFloors = Array.from({ length: MIC_BANDS }, () => new NoiseFloor());
    const levelFloor = new NoiseFloor();
    let smoothed = 0;
    let speechMs = 0;
    let lastTick: number | null = null;
    let heard = false;
    let frame = 0;

    const tick = (now: number) => {
      analyser.getFloatTimeDomainData(time);
      analyser.getFloatFrequencyData(freq);
      let sum = 0;
      for (const sample of time) sum += sample * sample;
      const db = 20 * Math.log10(Math.sqrt(sum / time.length) + 1e-9);
      const flowing = db > DIGITAL_SILENCE_DB;
      if (flowing) levelFloor.push(db);
      const calibrated = flowing && levelFloor.ready;
      const level = calibrated ? aboveFloor(db, levelFloor.value) : 0;
      smoothed = level > smoothed ? level : smoothed * 0.8 + level * 0.2;
      const frameMs = lastTick === null ? 0 : Math.min(100, now - lastTick);
      lastTick = now;
      if (calibrated && db - levelFloor.value >= SPEECH_ABOVE_NOISE_DB) speechMs += frameMs;
      if (speechMs >= SPEECH_MS) heard = true;
      const bands = edges.slice(0, -1).map((from, k) => {
        const to = Math.max(from + 1, edges[k + 1]);
        let peak = -Infinity;
        for (let bin = from; bin < to && bin < freq.length; bin++) peak = Math.max(peak, freq[bin]);
        if (!flowing || !Number.isFinite(peak)) return 0;
        bandFloors[k].push(peak);
        return calibrated && bandFloors[k].ready ? aboveFloor(peak, bandFloors[k].value) : 0;
      });
      setActivity({ level: smoothed, bands, heard, suspended: context.state === 'suspended' });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
      source.disconnect();
      void context.close();
      setActivity(SILENT);
    };
  }, [stream, active]);

  return activity;
}
