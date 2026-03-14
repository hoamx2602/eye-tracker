'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useTestRunner } from '../../TestRunnerContext';
import { useNeuroHeadPose } from '../../NeuroHeadPoseContext';
import {
  DEFAULT_DURATION_PER_DIRECTION_SEC,
  DEFAULT_HEAD_ORIENTATION_ORDER,
  DIRECTION_LABELS,
  type HeadOrientationDirection,
} from './constants';

const SAMPLE_INTERVAL_MS = 50; // ~20 Hz head samples

export default function HeadOrientationTest() {
  const { config, completeTest } = useTestRunner();
  const { headPose } = useNeuroHeadPose();
  const headPoseRef = useRef(headPose);
  headPoseRef.current = headPose;

  const durationSec = Math.max(1, Math.min(10, Number(config.durationPerDirectionSec) || DEFAULT_DURATION_PER_DIRECTION_SEC));
  const order = (config.order as HeadOrientationDirection[] | undefined) ?? [...DEFAULT_HEAD_ORIENTATION_ORDER];

  const startTimeRef = useRef<number>(0);
  const [directionIndex, setDirectionIndex] = useState(0);
  const phaseStartTimeRef = useRef<number>(0);
  const phasesRef = useRef<Array<{ direction: string; startTime: number; endTime: number; headSamples: Array<{ t: number; yaw: number; pitch: number; roll: number }> }>>([]);
  const currentSamplesRef = useRef<Array<{ t: number; yaw: number; pitch: number; roll: number }>>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [phaseElapsedSec, setPhaseElapsedSec] = useState(0);

  // Start test on mount
  useEffect(() => {
    startTimeRef.current = performance.now();
    phaseStartTimeRef.current = performance.now();
    setDirectionIndex(0);
    phasesRef.current = [];
    currentSamplesRef.current = [];

    const sampleInterval = setInterval(() => {
      const pose = headPoseRef.current;
      if (!pose) return;
      const t = (performance.now() - phaseStartTimeRef.current) / 1000;
      currentSamplesRef.current.push({
        t,
        yaw: pose.yaw,
        pitch: pose.pitch,
        roll: pose.roll,
      });
    }, SAMPLE_INTERVAL_MS);
    intervalRef.current = sampleInterval;

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Per-phase timer: after durationSec, advance to next direction or finish
  useEffect(() => {
    if (directionIndex >= order.length) return;

    const phaseStart = phaseStartTimeRef.current;
    const endAt = phaseStart + durationSec * 1000;

    const tick = () => {
      const now = performance.now();
      setPhaseElapsedSec(Math.min(durationSec, (now - phaseStart) / 1000));
    };
    const tickInterval = setInterval(tick, 100);

    timerRef.current = setTimeout(() => {
      clearInterval(tickInterval);
      const now = performance.now();
      phasesRef.current.push({
        direction: order[directionIndex],
        startTime: phaseStart,
        endTime: now,
        headSamples: [...currentSamplesRef.current],
      });
      currentSamplesRef.current = [];

      if (directionIndex + 1 >= order.length) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        completeTest({
          startTime: startTimeRef.current,
          endTime: performance.now(),
          phases: phasesRef.current,
        });
        return;
      }

      phaseStartTimeRef.current = performance.now();
      setDirectionIndex((i) => i + 1);
      setPhaseElapsedSec(0);
    }, durationSec * 1000);

    return () => {
      clearInterval(tickInterval);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [directionIndex, order, durationSec, completeTest, config]);

  if (directionIndex >= order.length) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950">
        <p className="text-gray-400">Test complete. Saving…</p>
      </div>
    );
  }

  const direction = order[directionIndex];
  const label = DIRECTION_LABELS[direction] ?? direction;
  const remaining = Math.max(0, Math.ceil(durationSec - phaseElapsedSec));

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gray-950 p-6"
      role="region"
      aria-live="polite"
      aria-label={`Head orientation: ${label}`}
    >
      <p className="text-xl font-bold text-white mb-2">{label}</p>
      <p className="text-4xl font-black text-blue-400 tabular-nums">{remaining}</p>
      <p className="text-gray-500 text-sm mt-2">seconds</p>
      {!headPose && (
        <p className="text-amber-400 text-sm mt-4">Position your face in the camera view.</p>
      )}
    </div>
  );
}
