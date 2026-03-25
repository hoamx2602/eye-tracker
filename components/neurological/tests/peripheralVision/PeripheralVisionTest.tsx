'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTestRunner } from '../../TestRunnerContext';
import { useNeuroGaze } from '../../NeuroGazeContext';
import {
  DEFAULT_MAX_DELAY_MS,
  DEFAULT_MIN_DELAY_MS,
  DEFAULT_STIMULUS_DURATION_MS,
  DEFAULT_TRIAL_COUNT,
  GAZE_SAMPLE_INTERVAL_MS,
  RESPONSE_WINDOW_MS,
} from './constants';
import { randomPeripheralStimulusPosition } from './utils';
import { neuroLiveGazeRef } from '@/lib/neuroLiveGaze';

export interface PeripheralVisionTrialResult {
  /** performance.now() lúc bắt đầu trial (delay). `t` trong gazeSamples tính từ đây. */
  trialStartTime?: number;
  stimulusOnsetTime: number;
  /** Tâm stimulus (px, viewport). Run mới luôn có; run cũ có thể chỉ có `stimulusPosition`. */
  stimulusX?: number;
  stimulusY?: number;
  /** @deprecated Chỉ run cũ (4 hướng cố định). */
  stimulusPosition?: import('./constants').PeripheralZone;
  spacePressedTime?: number;
  rtMs?: number;
  hit: boolean;
  gazeSamples: Array<{ t: number; x: number; y: number }>;
  /** Khoảng cách trung bình tới tâm màn hình trong giai đoạn delay (trước flash) — px. */
  centeringMeanDistancePx?: number;
  /** Độ lệch chuẩn khoảng cách tới tâm trong delay — px (nhỏ hơn = ổn định hơn). */
  centeringStdDistancePx?: number;
}

export type PeripheralScanningPoint = { t: number; x: number; y: number };

export interface PeripheralVisionResult {
  startTime: number;
  endTime: number;
  trials: PeripheralVisionTrialResult[];
  scanningPath?: PeripheralScanningPoint[];
  gazePath?: PeripheralScanningPoint[];
  /** Thời gian hiển thị stimulus (ms) — dùng replay flash. */
  stimulusDurationMs?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  metrics?: {
    avgRT?: number;
    accuracy?: number;
    /** Trung bình khoảng cách gaze→tâm trên toàn bộ mẫu (legacy). */
    centerStability?: number;
    /** Trung bình (theo trial) của centeringMeanDistancePx — ổn định nhìn tâm trong delay. */
    avgCenteringDistancePx?: number;
    /** Trung bình độ lệch chuẩn theo trial trong delay. */
    avgCenteringStdPx?: number;
  };
}

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function std(nums: number[]): number {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  return Math.sqrt(nums.reduce((s, v) => s + (v - m) ** 2, 0) / (nums.length - 1));
}

/** Gộp mẫu gaze; `t` = giây từ `startTime` của bài test. */
export function buildPeripheralScanningPath(
  trials: PeripheralVisionTrialResult[],
  testStartMs: number
): PeripheralScanningPoint[] {
  const out: PeripheralScanningPoint[] = [];
  for (const tr of trials) {
    const startMs = tr.trialStartTime ?? tr.stimulusOnsetTime;
    const offsetSec = (startMs - testStartMs) / 1000;
    for (const s of tr.gazeSamples ?? []) {
      out.push({ t: offsetSec + s.t, x: s.x, y: s.y });
    }
  }
  return out;
}

function getCenter(): { x: number; y: number } {
  if (typeof window === 'undefined') return { x: 960, y: 540 };
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

function getViewport(): { w: number; h: number } {
  if (typeof window === 'undefined') return { w: 1920, h: 1080 };
  return { w: window.innerWidth, h: window.innerHeight };
}

export default function PeripheralVisionTest() {
  const { config, completeTest } = useTestRunner();
  useNeuroGaze();
  const completeTestRef = useRef(completeTest);
  completeTestRef.current = completeTest;

  const trialCount = Math.max(8, Math.min(40, Number(config.trialCount) ?? DEFAULT_TRIAL_COUNT));
  const stimulusDurationMs = Math.max(100, Number(config.stimulusDurationMs) ?? DEFAULT_STIMULUS_DURATION_MS);
  const minDelayMs = Math.max(0, Number(config.minDelayMs) ?? DEFAULT_MIN_DELAY_MS);
  const maxDelayMs = Math.max(minDelayMs, Number(config.maxDelayMs) ?? DEFAULT_MAX_DELAY_MS);
  const centerDotSizePx = Math.max(4, Math.min(64, Number(config.centerDotSizePx) ?? 8));
  const centerDotColor = /^#[0-9A-Fa-f]{6}$/.test(String(config.centerDotColor ?? '')) ? String(config.centerDotColor) : '#f59e0b';
  const stimulusDotSizePx = Math.max(8, Math.min(64, Number(config.stimulusDotSizePx) ?? 16));
  const stimulusDotColor = /^#[0-9A-Fa-f]{6}$/.test(String(config.stimulusDotColor ?? '')) ? String(config.stimulusDotColor) : '#ffffff';
  const gazeIntervalMs = Math.max(16, Number(config.gazeSampleIntervalMs) || GAZE_SAMPLE_INTERVAL_MS);

  const startTimeRef = useRef(0);
  const [trialIndex, setTrialIndex] = useState(0);
  const [phase, setPhase] = useState<'delay' | 'stimulus' | 'response' | 'iti'>('delay');
  const [showStimulus, setShowStimulus] = useState(false);
  const trialStartRef = useRef(0);
  const stimulusOnsetRef = useRef(0);
  const delayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stimulusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const responseEndTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trialGazeRef = useRef<Array<{ t: number; x: number; y: number }>>([]);
  const trialsResultsRef = useRef<PeripheralVisionTrialResult[]>([]);
  const spacePressedThisTrialRef = useRef<number | null>(null);
  const itiTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const viewport = getViewport();
  const center = getCenter();
  const [stimulusPos, setStimulusPos] = useState({ x: 0, y: 0 });

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      e.preventDefault();
      if (phase !== 'stimulus' && phase !== 'response') return;
      if (spacePressedThisTrialRef.current !== null) return;
      const now = performance.now();
      const responseDeadline = stimulusOnsetRef.current + stimulusDurationMs + RESPONSE_WINDOW_MS;
      if (now >= stimulusOnsetRef.current && now <= responseDeadline) {
        spacePressedThisTrialRef.current = now;
      }
    },
    [phase]
  );

  useEffect(() => {
    startTimeRef.current = performance.now();
    trialsResultsRef.current = [];
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (trialIndex >= trialCount) return;

    const pos = randomPeripheralStimulusPosition(viewport.w, viewport.h);
    setStimulusPos(pos);

    trialStartRef.current = performance.now();
    trialGazeRef.current = [];
    spacePressedThisTrialRef.current = null;
    setPhase('delay');
    setShowStimulus(false);

    const delayMs = minDelayMs + Math.random() * (maxDelayMs - minDelayMs);
    delayTimeoutRef.current = setTimeout(() => {
      stimulusOnsetRef.current = performance.now();
      setShowStimulus(true);
      setPhase('stimulus');

      stimulusTimeoutRef.current = setTimeout(() => {
        setShowStimulus(false);
        setPhase('response');

        responseEndTimeoutRef.current = setTimeout(() => {
          const trialStartMs = trialStartRef.current;
          const onset = stimulusOnsetRef.current;
          const pressed = spacePressedThisTrialRef.current;
          const responseDeadline = onset + stimulusDurationMs + RESPONSE_WINDOW_MS;
          const hit = pressed !== null && pressed >= onset && pressed <= responseDeadline;
          const delaySec = (onset - trialStartMs) / 1000;
          const c = getCenter();
          const centerSamples = trialGazeRef.current.filter((s) => s.t < delaySec - 1e-6);
          const dists = centerSamples.map((s) => Math.hypot(s.x - c.x, s.y - c.y));
          const centeringMeanDistancePx = dists.length ? mean(dists) : undefined;
          const centeringStdDistancePx = dists.length >= 2 ? std(dists) : undefined;
          trialsResultsRef.current.push({
            trialStartTime: trialStartMs,
            stimulusOnsetTime: onset,
            stimulusX: pos.x,
            stimulusY: pos.y,
            spacePressedTime: pressed ?? undefined,
            rtMs: hit && pressed != null ? pressed - onset : undefined,
            hit,
            gazeSamples: [...trialGazeRef.current],
            centeringMeanDistancePx,
            centeringStdDistancePx,
          });

          if (trialIndex + 1 >= trialCount) {
            const endTime = performance.now();
            const trials = trialsResultsRef.current;
            const c = getCenter();
            const hits = trials.filter((t) => t.hit);
            const avgRT =
              hits.length > 0
                ? hits.reduce((s, t) => s + (t.rtMs ?? 0), 0) / hits.length
                : undefined;
            const accuracy = trials.length > 0 ? (hits.length / trials.length) * 100 : undefined;
            let centerStability = 0;
            let totalSamples = 0;
            trials.forEach((tr) => {
              tr.gazeSamples.forEach((s) => {
                centerStability += Math.hypot(s.x - c.x, s.y - c.y);
                totalSamples++;
              });
            });
            centerStability = totalSamples > 0 ? centerStability / totalSamples : 0;

            const centeringMeans = trials
              .map((t) => t.centeringMeanDistancePx)
              .filter((v): v is number => typeof v === 'number');
            const centeringStds = trials
              .map((t) => t.centeringStdDistancePx)
              .filter((v): v is number => typeof v === 'number');
            const avgCenteringDistancePx = centeringMeans.length ? mean(centeringMeans) : undefined;
            const avgCenteringStdPx = centeringStds.length ? mean(centeringStds) : undefined;

            const testStart = startTimeRef.current;
            const scanningPath = buildPeripheralScanningPath(trials, testStart);

            completeTestRef.current({
              testId: 'peripheral_vision',
              startTime: testStart,
              endTime: endTime,
              trials,
              scanningPath,
              gazePath: scanningPath,
              stimulusDurationMs,
              viewportWidth: viewport.w,
              viewportHeight: viewport.h,
              metrics: {
                avgRT,
                accuracy,
                centerStability,
                avgCenteringDistancePx,
                avgCenteringStdPx,
              },
            });
            return;
          }

          itiTimeoutRef.current = setTimeout(() => setTrialIndex((i) => i + 1), 600);
        }, RESPONSE_WINDOW_MS);
      }, stimulusDurationMs);
    }, delayMs);

    const gazeInterval = setInterval(() => {
      const now = performance.now();
      const t = (now - trialStartRef.current) / 1000;
      const g = neuroLiveGazeRef.current;
      trialGazeRef.current.push({ t, x: g.x, y: g.y });
    }, gazeIntervalMs);

    return () => {
      if (delayTimeoutRef.current) clearTimeout(delayTimeoutRef.current);
      if (stimulusTimeoutRef.current) clearTimeout(stimulusTimeoutRef.current);
      if (responseEndTimeoutRef.current) clearTimeout(responseEndTimeoutRef.current);
      if (itiTimeoutRef.current) clearTimeout(itiTimeoutRef.current);
      clearInterval(gazeInterval);
    };
  }, [trialIndex, trialCount, viewport.w, viewport.h, minDelayMs, maxDelayMs, stimulusDurationMs]);

  if (trialIndex >= trialCount) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950">
        <p className="text-gray-400">Test complete. Saving…</p>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-gray-950"
      role="region"
      aria-label="Peripheral vision: press SPACE when you see the flash"
    >
      <p className="text-center text-gray-400 text-sm pt-4 pb-2">
        Keep gaze on center. Press SPACE when you see the flash.
      </p>
      {/* Center fixation dot */}
      <div
        className="absolute rounded-full"
        style={{
          left: center.x - centerDotSizePx / 2,
          top: center.y - centerDotSizePx / 2,
          width: centerDotSizePx,
          height: centerDotSizePx,
          backgroundColor: centerDotColor,
        }}
        aria-hidden
      />
      {/* Peripheral stimulus */}
      {showStimulus && (
        <div
          className="absolute rounded-full shadow-lg border border-gray-300"
          style={{
            left: stimulusPos.x - stimulusDotSizePx / 2,
            top: stimulusPos.y - stimulusDotSizePx / 2,
            width: stimulusDotSizePx,
            height: stimulusDotSizePx,
            backgroundColor: stimulusDotColor,
          }}
          aria-hidden
        />
      )}
    </div>
  );
}
