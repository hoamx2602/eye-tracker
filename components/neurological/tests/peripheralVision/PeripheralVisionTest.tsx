'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTestRunner } from '../../TestRunnerContext';
import { useNeuroGaze } from '../../NeuroGazeContext';
import {
  DEFAULT_MAX_DELAY_MS,
  DEFAULT_MIN_DELAY_MS,
  DEFAULT_STIMULUS_DURATION_MS,
  DEFAULT_TRIAL_COUNT,
  GAZE_SAMPLE_INTERVAL_MS,
  RESPONSE_WINDOW_MS,
  type PeripheralZone,
} from './constants';
import { generateTrialZones, getStimulusPosition } from './utils';
import { neuroLiveGazeRef } from '@/lib/neuroLiveGaze';

export interface PeripheralVisionTrialResult {
  stimulusOnsetTime: number;
  stimulusPosition: PeripheralZone;
  spacePressedTime?: number;
  rtMs?: number;
  hit: boolean;
  gazeSamples: Array<{ t: number; x: number; y: number }>;
}

export interface PeripheralVisionResult {
  startTime: number;
  endTime: number;
  trials: PeripheralVisionTrialResult[];
  viewportWidth?: number;
  viewportHeight?: number;
  metrics?: {
    avgRT?: number;
    accuracy?: number;
    centerStability?: number;
  };
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

  const zones = useMemo(() => generateTrialZones(trialCount), [trialCount]);
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
  const zone = zones[trialIndex];
  const stimulusPos = useMemo(
    () => (zone ? getStimulusPosition(zone, viewport.w, viewport.h) : { x: 0, y: 0 }),
    [zone, viewport.w, viewport.h]
  );

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

    const zone = zones[trialIndex];
    if (!zone) return;

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
          const onset = stimulusOnsetRef.current;
          const pressed = spacePressedThisTrialRef.current;
          const responseDeadline = onset + stimulusDurationMs + RESPONSE_WINDOW_MS;
          const hit = pressed !== null && pressed >= onset && pressed <= responseDeadline;
          trialsResultsRef.current.push({
            stimulusOnsetTime: onset,
            stimulusPosition: zone,
            spacePressedTime: pressed ?? undefined,
            rtMs: hit && pressed != null ? pressed - onset : undefined,
            hit,
            gazeSamples: [...trialGazeRef.current],
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

            completeTestRef.current({
              testId: 'peripheral_vision',
              startTime: startTimeRef.current,
              endTime: endTime,
              trials,
              viewportWidth: viewport.w,
              viewportHeight: viewport.h,
              metrics: { avgRT, accuracy, centerStability },
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
    }, GAZE_SAMPLE_INTERVAL_MS);

    return () => {
      if (delayTimeoutRef.current) clearTimeout(delayTimeoutRef.current);
      if (stimulusTimeoutRef.current) clearTimeout(stimulusTimeoutRef.current);
      if (responseEndTimeoutRef.current) clearTimeout(responseEndTimeoutRef.current);
      if (itiTimeoutRef.current) clearTimeout(itiTimeoutRef.current);
      clearInterval(gazeInterval);
    };
  }, [trialIndex, trialCount, zones, minDelayMs, maxDelayMs, stimulusDurationMs]);

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
