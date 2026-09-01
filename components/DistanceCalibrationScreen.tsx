'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CSS_REFERENCE_PX_PER_CM } from '@/lib/resultScoring';
import { loadScreenScale } from '@/lib/screenScale';
import {
  calibrate,
  checkDistance,
  distanceFromFace,
  faceScale as toFaceScale,
  type DistanceCalibration,
} from '@/lib/viewingDistance';

/** Bounds on a hand-measured eye-to-screen distance. */
const MIN_MANUAL_CM = 15;
const MAX_MANUAL_CM = 120;
const SAMPLE_WINDOW = 30;

type Step = 'manual' | 'position';

export interface DistanceCalibrationScreenProps {
  /** Target distance (cm) from the admin config — what this screen enforces. */
  targetDistanceCm: number;
  /** Live outer-eye-corner span as a fraction of frame width. */
  faceWidthNorm: number | null;
  /** Live MediaPipe iris diameter in fractions of frame width. */
  irisDiameterNorm: number | null;
  /** The same distance-band multiplier used by the head-positioning gate. */
  distanceTolerance: number;
  /** Camera/framing identity recorded with the session calibration. */
  cameraKey: string;
  onComplete: (calibration: DistanceCalibration, faceWidthCm: number | null) => void;
}

/** Median of a short rolling window, so one noisy landmark frame cannot anchor K. */
function median(values: number[], fallback: number | null | undefined): number {
  if (!values.length) return fallback ?? NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Viewing-distance setup with one explicit source of truth: a real measurement.
 *
 * The participant measures from their eye to the middle of the screen and types
 * that value. At that pose we capture the apparent face and iris scale:
 *
 *     K_face = distance × faceScale
 *     K_iris = distance × irisScale
 *
 * Every later frame derives distance from those session-specific constants.
 * There is no card, population face-size assumption, cached focal length, or
 * hidden Center Stage dependency in this flow.
 */
export default function DistanceCalibrationScreen({
  targetDistanceCm,
  faceWidthNorm,
  irisDiameterNorm,
  distanceTolerance,
  cameraKey,
  onComplete,
}: DistanceCalibrationScreenProps) {
  const [step, setStep] = useState<Step>('manual');
  const [calibration, setCalibration] = useState<DistanceCalibration | null>(null);
  const [screenScale] = useState(() => loadScreenScale());
  const faceSamplesRef = useRef<number[]>([]);
  const irisSamplesRef = useRef<number[]>([]);

  const liveScale = faceWidthNorm != null ? toFaceScale(faceWidthNorm) : null;

  // Keep only recent frames. This continues on the position screen so a user
  // correcting the value is paired with their current pose, not the old pose.
  useEffect(() => {
    if (liveScale != null && liveScale > 0) {
      faceSamplesRef.current.push(liveScale);
      if (faceSamplesRef.current.length > SAMPLE_WINDOW) faceSamplesRef.current.shift();
    }
    if (irisDiameterNorm != null && irisDiameterNorm > 0) {
      irisSamplesRef.current.push(irisDiameterNorm);
      if (irisSamplesRef.current.length > SAMPLE_WINDOW) irisSamplesRef.current.shift();
    }
  }, [liveScale, irisDiameterNorm]);

  const applyMeasurement = useCallback(
    (distanceCm: number): boolean => {
      const faceScale = median(faceSamplesRef.current, liveScale);
      const irisScale = median(irisSamplesRef.current, irisDiameterNorm);
      const cal = calibrate({
        distanceCm,
        faceScale,
        ...(Number.isFinite(irisScale) ? { irisScale } : {}),
        cameraKey,
        // Distance tracking does not need screen px/cm. Preserve an existing
        // display measurement; otherwise mark the reference scale as estimated
        // so reports cannot present visual angles as physically measured.
        pxPerCm: screenScale?.pxPerCm ?? CSS_REFERENCE_PX_PER_CM,
        screenScaleMeasured: screenScale != null,
        method: 'manual',
      });
      if (!cal) return false;
      setCalibration(cal);
      setStep('position');
      return true;
    },
    [cameraKey, irisDiameterNorm, liveScale, screenScale],
  );

  const remeasure = useCallback(() => {
    faceSamplesRef.current = [];
    irisSamplesRef.current = [];
    setCalibration(null);
    setStep('manual');
  }, []);

  const title = step === 'manual' ? 'Viewing Distance' : 'Sit At The Target';
  const subtitle = step === 'manual'
    ? 'Enter the actual distance from your eye to the middle of the screen'
    : `Move until you are ${targetDistanceCm} cm from the screen`;

  return (
    <div className="fixed inset-0 z-[200] bg-gray-950 flex flex-col items-center justify-center gap-6 p-4 sm:p-8">
      <div className="text-center">
        <h2 className="text-xl font-bold text-white uppercase tracking-widest">{title}</h2>
        <p className="text-sm text-gray-500 mt-1">{subtitle}</p>
      </div>

      {step === 'manual' && (
        <ManualDistanceStep
          targetDistanceCm={targetDistanceCm}
          faceAvailable={liveScale != null && liveScale > 0}
          onDone={applyMeasurement}
        />
      )}

      {step === 'position' && calibration && (
        <PositionStep
          calibration={calibration}
          liveScale={liveScale}
          liveIrisScale={irisDiameterNorm}
          targetDistanceCm={targetDistanceCm}
          tolerance={distanceTolerance}
          onRemeasure={remeasure}
          onCorrect={applyMeasurement}
          onDone={() => onComplete(calibration, null)}
        />
      )}
    </div>
  );
}

function ManualDistanceStep({
  targetDistanceCm,
  faceAvailable,
  onDone,
}: {
  targetDistanceCm: number;
  faceAvailable: boolean;
  onDone: (distanceCm: number) => boolean;
}) {
  const [text, setText] = useState(String(targetDistanceCm));
  const value = Number(text);
  const valid = Number.isFinite(value) && value >= MIN_MANUAL_CM && value <= MAX_MANUAL_CM;

  return (
    <>
      <div className="flex flex-col items-center justify-center gap-5 w-full max-w-3xl h-64 rounded-2xl border-2 border-gray-700 bg-black shadow-2xl">
        <p className="text-gray-300 text-sm max-w-lg text-center px-6 leading-relaxed">
          Measure from either eye to the middle of the screen. Stay in that
          position while entering the value so the camera can anchor your current
          face and iris size to the measured distance.
        </p>
        <div className="flex items-baseline gap-2">
          <input
            type="number"
            inputMode="decimal"
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            min={MIN_MANUAL_CM}
            max={MAX_MANUAL_CM}
            className="w-32 bg-gray-900 border-2 border-gray-700 focus:border-cyan-500 outline-none rounded-lg px-3 py-2 text-4xl font-black text-center tabular-nums text-white"
            aria-label="Actual eye-to-screen distance in centimetres"
          />
          <span className="text-2xl text-gray-500">cm</span>
        </div>
        <p className="text-xs text-gray-500">Keep your head still until you continue.</p>
        <p className="text-xs text-amber-300/80 max-w-lg text-center px-6">
          Center Stage may be on or off, but do not change camera framing after
          this measurement. If framing changes, measure again.
        </p>
      </div>

      <div className="text-center bg-gray-900/90 px-6 py-4 rounded-xl border border-gray-800 w-full max-w-lg">
        {!valid && (
          <p className="text-amber-400 text-xs mb-3">
            Enter a distance between {MIN_MANUAL_CM} and {MAX_MANUAL_CM} cm.
          </p>
        )}
        {!faceAvailable && (
          <p className="text-amber-400 text-xs mb-3">
            Looking for your face… keep both eyes visible to the camera.
          </p>
        )}
        <button
          type="button"
          disabled={!valid || !faceAvailable}
          onClick={() => onDone(value)}
          className="px-8 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-30 text-white font-bold uppercase tracking-wider text-sm"
        >
          Use This Distance
        </button>
      </div>
    </>
  );
}

function PositionStep({
  calibration,
  liveScale,
  liveIrisScale,
  targetDistanceCm,
  tolerance,
  onRemeasure,
  onCorrect,
  onDone,
}: {
  calibration: DistanceCalibration;
  liveScale: number | null;
  liveIrisScale: number | null;
  targetDistanceCm: number;
  tolerance: number;
  onRemeasure: () => void;
  onCorrect: (actualCm: number) => boolean;
  onDone: () => void;
}) {
  const [correcting, setCorrecting] = useState(false);
  const [correctionText, setCorrectionText] = useState('');
  const distanceCm = liveScale != null
    ? distanceFromFace(calibration, liveScale, liveIrisScale ?? undefined)
    : NaN;
  const check = liveScale != null
    ? checkDistance(
        calibration,
        liveScale,
        targetDistanceCm,
        tolerance,
        liveIrisScale ?? undefined,
      )
    : null;
  const onTarget = check?.verdict === 'ok';

  const instruction = !check || check.verdict === 'unknown'
    ? 'Looking for your face…'
    : check.verdict === 'too-close'
      ? 'Move Back'
      : check.verdict === 'too-far'
        ? 'Move Closer'
        : 'Hold This Position';

  const band = check?.bandCm ?? 3;
  const span = band * 4;
  const offset = Number.isFinite(distanceCm)
    ? Math.max(-1, Math.min(1, (distanceCm - targetDistanceCm) / span))
    : 0;
  const correction = Number(correctionText);
  const correctionValid = Number.isFinite(correction)
    && correction >= MIN_MANUAL_CM
    && correction <= MAX_MANUAL_CM;

  return (
    <>
      <div className="relative w-full max-w-3xl h-56 rounded-2xl border-2 border-gray-700 bg-black shadow-2xl flex flex-col items-center justify-center gap-6">
        <p className={`text-6xl font-black tabular-nums ${onTarget ? 'text-green-400' : 'text-red-400'}`}>
          {Number.isFinite(distanceCm) ? distanceCm.toFixed(0) : '—'}
          <span className="text-2xl font-normal text-gray-500 ml-2">cm</span>
        </p>
        <div className="relative w-3/4 h-2 rounded-full bg-gray-800">
          <div
            className="absolute inset-y-0 bg-green-900 rounded-full"
            style={{ left: `${50 - (band / span) * 50}%`, right: `${50 - (band / span) * 50}%` }}
          />
          <div className="absolute inset-y-[-6px] w-0.5 bg-gray-600" style={{ left: '50%' }} />
          <div
            className="absolute w-4 h-4 rounded-full border-2 border-gray-950 -top-1 -ml-2 transition-[left] duration-150"
            style={{ left: `${50 + offset * 50}%`, backgroundColor: onTarget ? '#4ade80' : '#f87171' }}
          />
        </div>
        <div className="flex justify-between w-3/4 font-mono text-[11px] text-gray-600 tabular-nums">
          <span>closer</span>
          <span>target {targetDistanceCm} cm</span>
          <span>further</span>
        </div>
      </div>

      <div className="text-center bg-gray-900/90 px-6 py-4 rounded-xl border border-gray-800 w-full max-w-lg">
        <p className={`text-xl font-bold ${onTarget ? 'text-green-400' : 'text-red-400'}`}>
          {instruction}
        </p>
        <p className="text-cyan-300 text-sm mt-2 font-mono tabular-nums">
          measured by hand · {calibration.distanceCm.toFixed(1)} cm
          {calibration.irisK != null ? ' · face + iris' : ' · face'}
        </p>
        {!calibration.screenScaleMeasured && (
          <p className="text-gray-600 text-[11px] mt-1">
            Display px/cm was not measured; physical visual-angle scores will remain unavailable.
          </p>
        )}

        {!correcting ? (
          <div className="flex items-center justify-center gap-4 mt-3">
            <button
              type="button"
              onClick={() => setCorrecting(true)}
              className="text-xs text-amber-400/80 hover:text-amber-300 underline"
            >
              Change actual distance
            </button>
            <button
              type="button"
              onClick={onRemeasure}
              className="text-xs text-gray-500 hover:text-gray-300 underline"
            >
              Measure again
            </button>
          </div>
        ) : (
          <div className="mt-3 flex flex-col items-center gap-2">
            <p className="text-xs text-gray-400">
              Stay in place and enter the current eye-to-screen distance.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                inputMode="decimal"
                autoFocus
                value={correctionText}
                onChange={(e) => setCorrectionText(e.target.value)}
                className="w-24 bg-gray-900 border-2 border-gray-700 focus:border-amber-500 outline-none rounded-lg px-2 py-1 text-2xl font-black text-center tabular-nums text-white"
                aria-label="Corrected eye-to-screen distance"
              />
              <span className="text-gray-500">cm</span>
              <button
                type="button"
                disabled={!correctionValid}
                onClick={() => {
                  if (onCorrect(correction)) setCorrecting(false);
                }}
                className="px-4 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-30 text-white font-bold uppercase tracking-wider text-xs"
              >
                Apply
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          disabled={!onTarget}
          onClick={onDone}
          className="mt-4 px-8 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-30 text-white font-bold uppercase tracking-wider text-sm"
        >
          Continue
        </button>
      </div>
    </>
  );
}
