'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CARD_ASPECT,
  CARD_WIDTH_MM,
  MAX_PX_PER_CM,
  MIN_PX_PER_CM,
  loadScreenScale,
  saveScreenScale,
  type ScreenScale,
} from '@/lib/screenScale';
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

type Step = 'screen' | 'manual' | 'position';

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
 * Physical-geometry setup with two explicit sources of truth:
 *
 * 1. Match an ISO ID-1 card directly against an on-screen rectangle. This gives
 *    CSS pixels per physical centimetre without depending on camera framing.
 * 2. Enter the measured eye-to-screen distance while the camera records the
 *    participant-specific face and iris scale at that pose.
 *
 * The participant measures from their eye to the middle of the screen and types
 * that value. At that pose we capture the apparent face and iris scale:
 *
 *     K_face = distance × faceScale
 *     K_iris = distance × irisScale
 *
 * Every later frame derives distance from those session-specific constants.
 * The card is never detected by the camera, so Center Stage, card tilt and
 * bounding-box dragging cannot corrupt the display measurement.
 */
export default function DistanceCalibrationScreen({
  targetDistanceCm,
  faceWidthNorm,
  irisDiameterNorm,
  distanceTolerance,
  cameraKey,
  onComplete,
}: DistanceCalibrationScreenProps) {
  const [step, setStep] = useState<Step>('screen');
  const [calibration, setCalibration] = useState<DistanceCalibration | null>(null);
  const [savedScreenScale] = useState(() => loadScreenScale());
  const [screenScale, setScreenScale] = useState<ScreenScale | null>(null);
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

  const applyScreenMeasurement = useCallback((cardWidthPx: number): boolean => {
    const measured = saveScreenScale(cardWidthPx);
    if (!measured) return false;
    setScreenScale(measured);
    setStep('manual');
    return true;
  }, []);

  const applyMeasurement = useCallback(
    (distanceCm: number): boolean => {
      if (!screenScale) return false;
      const faceScale = median(faceSamplesRef.current, liveScale);
      const irisScale = median(irisSamplesRef.current, irisDiameterNorm);
      const cal = calibrate({
        distanceCm,
        faceScale,
        ...(Number.isFinite(irisScale) ? { irisScale } : {}),
        cameraKey,
        pxPerCm: screenScale.pxPerCm,
        screenScaleMeasured: true,
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

  const remeasureScreen = useCallback(() => {
    faceSamplesRef.current = [];
    irisSamplesRef.current = [];
    setCalibration(null);
    setScreenScale(null);
    setStep('screen');
  }, []);

  const title = step === 'screen'
    ? 'Screen Scale'
    : step === 'manual'
      ? 'Viewing Distance'
      : 'Sit At The Target';
  const subtitle = step === 'screen'
    ? 'Match an on-screen rectangle to a bank or ID card'
    : step === 'manual'
      ? 'Enter the actual distance from your eye to the middle of the screen'
      : `Move until you are ${targetDistanceCm} cm from the screen`;

  return (
    <div className="fixed inset-0 z-[200] bg-gray-950 flex flex-col items-center justify-center gap-6 p-4 sm:p-8">
      <div className="text-center">
        <h2 className="text-xl font-bold text-white uppercase tracking-widest">{title}</h2>
        <p className="text-sm text-gray-500 mt-1">{subtitle}</p>
      </div>

      {step === 'screen' && (
        <CardScaleStep
          initialWidthPx={savedScreenScale?.cardWidthPx}
          onDone={applyScreenMeasurement}
        />
      )}

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
          onRemeasureScreen={remeasureScreen}
          onCorrect={applyMeasurement}
          onDone={() => onComplete(calibration, null)}
        />
      )}
    </div>
  );
}

function CardScaleStep({
  initialWidthPx,
  onDone,
}: {
  initialWidthPx?: number;
  onDone: (cardWidthPx: number) => boolean;
}) {
  const physicalCardWidthCm = CARD_WIDTH_MM / 10;
  const minWidthPx = Math.ceil(physicalCardWidthCm * MIN_PX_PER_CM);
  const viewportMax = typeof window !== 'undefined' ? window.innerWidth - 48 : 760;
  const maxWidthPx = Math.max(minWidthPx, Math.min(760, viewportMax, physicalCardWidthCm * MAX_PX_PER_CM));
  const initial = initialWidthPx ?? Math.min(430, maxWidthPx);
  const [widthPx, setWidthPx] = useState(Math.max(minWidthPx, Math.min(maxWidthPx, initial)));
  const [invalid, setInvalid] = useState(false);

  const setClampedWidth = (next: number) => {
    setInvalid(false);
    setWidthPx(Math.max(minWidthPx, Math.min(maxWidthPx, next)));
  };

  const confirm = () => {
    if (!onDone(widthPx)) setInvalid(true);
  };

  return (
    <div className="w-full max-w-4xl flex flex-col items-center gap-5">
      <div className="text-center max-w-2xl text-sm text-gray-300 leading-relaxed">
        Hold a bank card or ID-1 identity card flat against the screen. Line its
        left edge up with the left edge of the rectangle, then adjust the width
        until the right edges meet. Do not show the card to the camera.
      </div>

      <div className="w-full min-h-64 rounded-2xl border border-gray-800 bg-black/70 flex items-center justify-center p-6 overflow-hidden">
        <div
          className="relative rounded-xl border-2 border-dashed border-cyan-400 bg-cyan-400/10 shadow-[0_0_28px_rgba(34,211,238,0.12)]"
          style={{ width: `${widthPx}px`, aspectRatio: CARD_ASPECT }}
          aria-label="Resizable bank-card reference rectangle"
        >
          <div className="absolute inset-y-0 left-0 w-0.5 bg-cyan-300" />
          <div className="absolute inset-y-0 right-0 w-0.5 bg-cyan-300" />
          <div className="absolute inset-0 flex items-center justify-center text-center px-8 text-cyan-100/70 text-xs font-semibold uppercase tracking-[0.18em]">
            Match physical card edges
          </div>
        </div>
      </div>

      <div className="w-full max-w-2xl rounded-xl border border-gray-800 bg-gray-900/90 px-5 py-4">
        <input
          type="range"
          min={minWidthPx}
          max={maxWidthPx}
          step="0.5"
          value={widthPx}
          onChange={(event) => setClampedWidth(Number(event.target.value))}
          className="w-full accent-cyan-500"
          aria-label="Adjust the on-screen card width"
        />
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          {[-10, -1, 1, 10].map((delta) => (
            <button
              key={delta}
              type="button"
              onClick={() => setClampedWidth(widthPx + delta)}
              className="min-w-14 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 font-mono text-sm text-gray-200 hover:border-cyan-500 hover:text-white"
            >
              {delta > 0 ? '+' : ''}{delta}px
            </button>
          ))}
        </div>
        <p className="mt-3 text-center text-xs text-gray-500">
          Use the slider to get close, then ±1 px to finish. Keep this display and
          this zoom level until the assessment is over.
        </p>
        {invalid && (
          <p className="mt-2 text-center text-xs text-red-400">
            That size is outside the range of a real display. Match the card again.
          </p>
        )}
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={confirm}
            className="rounded-lg bg-cyan-600 px-8 py-2 text-sm font-bold uppercase tracking-wider text-white hover:bg-cyan-500"
          >
            Card Matches — Continue
          </button>
        </div>
      </div>
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
  onRemeasureScreen,
  onCorrect,
  onDone,
}: {
  calibration: DistanceCalibration;
  liveScale: number | null;
  liveIrisScale: number | null;
  targetDistanceCm: number;
  tolerance: number;
  onRemeasure: () => void;
  onRemeasureScreen: () => void;
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
        <p className="text-gray-500 text-[11px] mt-1 font-mono">
          display scale · {calibration.pxPerCm.toFixed(2)} px/cm
        </p>

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
            <button
              type="button"
              onClick={onRemeasureScreen}
              className="text-xs text-gray-500 hover:text-gray-300 underline"
            >
              Recheck card
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
