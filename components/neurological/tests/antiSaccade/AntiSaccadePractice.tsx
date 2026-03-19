'use client';

import React, { useEffect, useRef, useState } from 'react';
import { usePracticeGate } from '../../PracticeGate';
import {
  DEFAULT_MOVEMENT_DURATION_MS,
  OPPOSITE_DIRECTION,
  PRACTICE_TRIALS,
  RECT_HALF_PX,
  TRAVEL_DISTANCE_PX,
  STIMULUS_SHAPE_OPTIONS,
  type AntiSaccadeDirection,
  type AntiSaccadeRectColor,
  type AntiSaccadeStimulusShape,
} from './constants';
import StimulusShape from './StimulusShape';
import { generateTrialDirections } from './utils';

const BOX_SIZE = 360;
const CENTER = BOX_SIZE / 2;

function offset(d: AntiSaccadeDirection, progress: number, travel: number): { x: number; y: number } {
  const dpx = progress * travel;
  switch (d) {
    case 'left': return { x: -dpx, y: 0 };
    case 'right': return { x: dpx, y: 0 };
    case 'up': return { x: 0, y: -dpx };
    case 'down': return { x: 0, y: dpx };
    default: return { x: 0, y: 0 };
  }
}

const DEFAULT_RESTART_DELAY_SEC = 3;
const RESTART_DELAY_MIN = 1;
const RESTART_DELAY_MAX = 4;

function getRestartDelaySec(config?: Record<string, unknown>): number {
  const v = Number(config?.practiceRestartDelaySec);
  if (!Number.isFinite(v)) return DEFAULT_RESTART_DELAY_SEC;
  return Math.max(RESTART_DELAY_MIN, Math.min(RESTART_DELAY_MAX, Math.round(v)));
}

/** Duration (ms) per movement step: prefer speed (px/s), fallback to legacy duration. */
function getMovementDurationMs(config?: Record<string, unknown>, travelPx: number = TRAVEL_DISTANCE_PX): number {
  const speed = Number(config?.movementSpeedPxPerSec);
  if (Number.isFinite(speed) && speed > 0) {
    return Math.max(300, Math.min(15000, (1000 * travelPx) / speed));
  }
  const v = Number(config?.movementDurationMs);
  if (!Number.isFinite(v) || v < 500) return DEFAULT_MOVEMENT_DURATION_MS;
  return Math.min(10000, v);
}

const DIM_OPACITY_MIN = 0;
const DIM_OPACITY_MAX = 0.9;
const DIM_OPACITY_DEFAULT = 0.1;

function getDimRectOpacity(config?: Record<string, unknown>): number {
  const v = Number(config?.dimRectOpacity);
  if (!Number.isFinite(v)) return DIM_OPACITY_DEFAULT;
  return Math.max(DIM_OPACITY_MIN, Math.min(DIM_OPACITY_MAX, v));
}

function isHorizontalDirection(d: AntiSaccadeDirection): boolean {
  return d === 'left' || d === 'right';
}

const VALID_SHAPES = new Set(STIMULUS_SHAPE_OPTIONS.map((o) => o.value));

function getStimulusShape(config?: Record<string, unknown>): AntiSaccadeStimulusShape {
  const v = String(config?.stimulusShape ?? 'rectangle').toLowerCase();
  return VALID_SHAPES.has(v as AntiSaccadeStimulusShape) ? (v as AntiSaccadeStimulusShape) : 'rectangle';
}

function getRectColor(
  config: Record<string, unknown> | undefined,
  key: string,
  defaultColor: AntiSaccadeRectColor
): AntiSaccadeRectColor {
  const v = String(config?.[key] ?? defaultColor).toLowerCase();
  if (v === 'red' || v === 'blue') return v;
  return defaultColor;
}

/**
 * Practice: a few anti-saccade trials, same visual, no recording.
 * After 3 trials, count down practiceRestartDelaySec (from config, 1–4 s) then auto-restart.
 */
export default function AntiSaccadePractice({ config }: { config?: Record<string, unknown> }) {
  const practiceGate = usePracticeGate();
  const practiceGateRef = useRef(practiceGate);
  practiceGateRef.current = practiceGate;
  const restartDelaySec = getRestartDelaySec(config);
  const movementDurationMs = getMovementDurationMs(config, TRAVEL_DISTANCE_PX);
  const dimOpacity = getDimRectOpacity(config);
  const showDimRect = dimOpacity > 0;
  const stimulusShape = getStimulusShape(config);
  const primaryRectColor = getRectColor(config, 'primaryRectColor', 'red');
  const dimRectColor = getRectColor(config, 'dimRectColor', 'blue');

  const primaryColorLabel = primaryRectColor === 'red' ? 'red' : 'blue';
  const dimColorLabel = dimRectColor === 'red' ? 'red' : 'blue';

  const directionsRef = useRef(generateTrialDirections(PRACTICE_TRIALS));
  const [trialIndex, setTrialIndex] = useState(0);
  const [visualStarted, setVisualStarted] = useState(false);
  const [restartIn, setRestartIn] = useState<number | null>(null);
  const direction = directionsRef.current[trialIndex];
  const primaryEnd = direction ? offset(direction, 1, TRAVEL_DISTANCE_PX) : { x: 0, y: 0 };
  const dimEnd = direction ? offset(OPPOSITE_DIRECTION[direction], 1, TRAVEL_DISTANCE_PX) : { x: 0, y: 0 };

  // High-frequency animation is handled by CSS transition (GPU-friendly).
  // We only toggle visualStarted twice per trial (start -> animate), not every frame.
  useEffect(() => {
    if (restartIn !== null) return;

    setVisualStarted(false);
    const raf = requestAnimationFrame(() => setVisualStarted(true));

    const t = window.setTimeout(() => {
      if (trialIndex + 1 >= PRACTICE_TRIALS) {
        practiceGateRef.current?.markPracticeDone();
        setRestartIn(restartDelaySec);
      } else {
        setTrialIndex((i) => i + 1);
      }
    }, movementDurationMs);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [trialIndex, restartIn, movementDurationMs, restartDelaySec]);

  // Countdown then restart
  useEffect(() => {
    if (restartIn === null || restartIn <= 0) return;
    const t = setInterval(() => {
      setRestartIn((prev) => {
        if (prev === null || prev <= 0) return null;
        const next = prev - 1;
        if (next === 0) {
          directionsRef.current = generateTrialDirections(PRACTICE_TRIALS);
          setTrialIndex(0);
          setVisualStarted(false);
          return null;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [restartIn]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[300px]">
      {restartIn !== null ? (
        <p className="text-gray-400 text-sm mb-4">
          Simulation will restart in <strong className="text-amber-400">{restartIn}</strong> seconds…
        </p>
      ) : (
        <p className="text-gray-400 text-sm mb-4">
          Look in the opposite direction from the <strong className="text-slate-300">{primaryColorLabel}</strong> square
          {showDimRect ? (
            <>
              . Follow the <strong className="text-slate-300">{dimColorLabel}</strong> square instead.
            </>
          ) : null}
        </p>
      )}
      <div className="relative rounded-xl overflow-hidden bg-gray-900" style={{ width: BOX_SIZE, height: BOX_SIZE }}>
        {(!visualStarted && direction && showDimRect) ? (
          <StimulusShape
            shape={stimulusShape}
            left={isHorizontalDirection(direction) ? CENTER - RECT_HALF_PX : CENTER - RECT_HALF_PX / 2}
            top={isHorizontalDirection(direction) ? CENTER - RECT_HALF_PX / 2 : CENTER - RECT_HALF_PX}
            width={isHorizontalDirection(direction) ? RECT_HALF_PX * 2 : RECT_HALF_PX}
            height={isHorizontalDirection(direction) ? RECT_HALF_PX : RECT_HALF_PX * 2}
            isPrimary={false}
            primaryColor={primaryRectColor}
            dimColor={dimRectColor}
            opacity={dimOpacity}
          />
        ) : null}

        {direction ? (
          <>
            <StimulusShape
              shape={stimulusShape}
              left={CENTER - RECT_HALF_PX / 2}
              top={CENTER - RECT_HALF_PX / 2}
              width={RECT_HALF_PX}
              height={RECT_HALF_PX}
              isPrimary={true}
              primaryColor={primaryRectColor}
              dimColor={dimRectColor}
              opacity={visualStarted ? 1 : 0}
              style={{
                transition: visualStarted ? `transform ${movementDurationMs}ms linear` : 'none',
                transform: `translate(${visualStarted ? primaryEnd.x : 0}px, ${visualStarted ? primaryEnd.y : 0}px)`,
              }}
            />
            {showDimRect && (
              <StimulusShape
                shape={stimulusShape}
                left={CENTER - RECT_HALF_PX / 2}
                top={CENTER - RECT_HALF_PX / 2}
                width={RECT_HALF_PX}
                height={RECT_HALF_PX}
                isPrimary={false}
                primaryColor={primaryRectColor}
                dimColor={dimRectColor}
                opacity={visualStarted ? dimOpacity : 0}
                style={{
                  transition: visualStarted ? `transform ${movementDurationMs}ms linear` : 'none',
                  transform: `translate(${visualStarted ? dimEnd.x : 0}px, ${visualStarted ? dimEnd.y : 0}px)`,
                }}
              />
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
