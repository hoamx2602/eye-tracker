'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CARD_ASPECT,
  cardWidthPxFromPxPerCm,
  isPlausibleScale,
  loadScreenScale,
  pxPerCmFromCardWidth,
  saveScreenScale,
  type ScreenScale,
} from '@/lib/screenScale';
import {
  BLIND_SPOT_ECCENTRICITY_DEG,
  aggregateBlindSpotTrials,
  calibrate,
  checkDistance,
  distanceFromFace,
  faceScale as toFaceScale,
  type DistanceCalibration,
} from '@/lib/viewingDistance';

/**
 * Put the participant at the distance the admin config asks for, and prove it.
 *
 * Three steps, each doing exactly one thing:
 *
 *   1. Card    — the screen's physical scale, which the next step needs.
 *   2. Blind spot — the real eye-to-screen distance, right now.
 *   3. Position   — move until that real distance matches the configured
 *                   target, and only then continue.
 *
 * Step 3 is the point of the whole screen. Steps 1 and 2 exist because you
 * cannot hold someone to 40 cm without first being able to measure 40 cm.
 *
 * Blind-spot procedure follows Li, Joo, Yeatman & Reinecke (2020), Scientific
 * Reports (https://www.nature.com/articles/s41598-019-57204-1): right eye
 * covered, 30 px red dot sweeping right to left across a 30 px fixation square
 * and repeating, five measurements, distance = separation / tan(13.5°).
 *
 * Two deliberate departures, both because the paper's setup is not guaranteed
 * here:
 *
 *   Trials are combined by median rather than mean. One late keypress would
 *   otherwise bias every distance the session reports afterwards.
 *
 *   The square is centred only when centring leaves enough travel. The dot must
 *   get d·tan(13.5°) to its left — 534 px at 40 cm, 800 px at 60 cm — and on a
 *   narrow window half the width is not enough, in which case the square slides
 *   right. The geometry only uses the separation at the moment the dot vanishes,
 *   so where the square sits does not enter the result.
 */

type Step = 'card' | 'blindspot' | 'position';

/** Paper values. */
const TRIALS = 5;
const DOT_PX = 30;
const SQUARE_PX = 30;
/** Not specified in the paper; jsPsych's default of 3 px/frame at 60 Hz. */
const SWEEP_PX_PER_SEC = 180;

export interface DistanceCalibrationScreenProps {
  /** Target distance (cm) from the admin config — what this screen enforces. */
  targetDistanceCm: number;
  /** Live normalised face width from the tracking loop, or null when no face. */
  faceWidthNorm: number | null;
  /** Live head yaw (radians) — corrects the foreshortening of a turned head. */
  yawRad: number;
  onComplete: (calibration: DistanceCalibration) => void;
}

export default function DistanceCalibrationScreen({
  targetDistanceCm,
  faceWidthNorm,
  yawRad,
  onComplete,
}: DistanceCalibrationScreenProps) {
  const [saved] = useState<ScreenScale | null>(() => loadScreenScale());
  const [step, setStep] = useState<Step>(saved ? 'blindspot' : 'card');
  const [pxPerCm, setPxPerCm] = useState<number | null>(saved?.pxPerCm ?? null);
  const [calibration, setCalibration] = useState<DistanceCalibration | null>(null);

  const liveScale = faceWidthNorm != null ? toFaceScale(faceWidthNorm, yawRad) : null;

  // Face size during the blind-spot task, so the distance it measures can be
  // paired with the face size observed at that same moment.
  const scaleSamplesRef = useRef<number[]>([]);
  useEffect(() => {
    if (step === 'blindspot' && liveScale != null && liveScale > 0) {
      scaleSamplesRef.current.push(liveScale);
    }
  }, [step, liveScale]);

  const finishBlindSpot = useCallback(
    (offsetsPx: number[]) => {
      if (pxPerCm == null) return;
      const agg = aggregateBlindSpotTrials(offsetsPx, pxPerCm);
      const samples = [...scaleSamplesRef.current].sort((a, b) => a - b);
      const cal = calibrate({
        distanceCm: agg.distanceCm,
        faceScale: samples.length ? samples[samples.length >> 1] : liveScale ?? 0,
        pxPerCm,
        method: 'blind-spot',
        spreadCm: agg.spreadCm,
      });
      if (!cal) {
        scaleSamplesRef.current = [];
        return; // unusable trials — the task simply repeats
      }
      setCalibration(cal);
      setStep('position');
    },
    [pxPerCm, liveScale],
  );

  const title =
    step === 'card' ? 'Screen Size' : step === 'blindspot' ? 'Viewing Distance' : 'Sit At The Target';
  const subtitle =
    step === 'card'
      ? 'Hold a bank card against the screen and match the rectangle'
      : step === 'blindspot'
        ? 'Cover your right eye and stare at the white square'
        : `Move until you are ${targetDistanceCm} cm from the screen`;

  return (
    <div className="fixed inset-0 z-[200] bg-gray-950 flex flex-col items-center justify-center gap-6 p-8">
      <div className="text-center">
        <h2 className="text-xl font-bold text-white uppercase tracking-widest">{title}</h2>
        <p className="text-sm text-gray-500 mt-1">{subtitle}</p>
      </div>

      {step === 'card' && (
        <CardStep
          initialPxPerCm={pxPerCm}
          onDone={(v) => {
            setPxPerCm(v);
            saveScreenScale(cardWidthPxFromPxPerCm(v));
            scaleSamplesRef.current = [];
            setStep('blindspot');
          }}
        />
      )}

      {step === 'blindspot' && pxPerCm != null && (
        <BlindSpotStep
          onDone={finishBlindSpot}
          pxPerCm={pxPerCm}
          targetDistanceCm={targetDistanceCm}
        />
      )}

      {step === 'position' && calibration && (
        <PositionStep
          calibration={calibration}
          liveScale={liveScale}
          targetDistanceCm={targetDistanceCm}
          onDone={() => onComplete(calibration)}
        />
      )}
    </div>
  );
}

// ─── Step 1: card ────────────────────────────────────────────────────────────

function CardStep({
  initialPxPerCm,
  onDone,
}: {
  initialPxPerCm: number | null;
  onDone: (pxPerCm: number) => void;
}) {
  // Start near a typical laptop panel so the rectangle is already in the right
  // neighbourhood before the participant touches anything.
  const [widthPx, setWidthPx] = useState(() => cardWidthPxFromPxPerCm(initialPxPerCm ?? 55));
  const pxPerCm = pxPerCmFromCardWidth(widthPx);
  const ok = isPlausibleScale(pxPerCm);

  // Arrow keys for the last millimetre, where dragging a slider is too coarse.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      setWidthPx((w) => w + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 5 : 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <div className="flex items-center justify-center w-full max-w-3xl aspect-video rounded-2xl border-2 border-gray-700 bg-black shadow-2xl">
        <div
          className="rounded-lg border-2 border-cyan-400 bg-gray-800"
          style={{ width: widthPx, height: widthPx / CARD_ASPECT }}
        />
      </div>

      <div className="text-center bg-gray-900 bg-opacity-90 px-6 py-3 rounded-xl border border-gray-800 w-full max-w-lg">
        <input
          type="range"
          min={Math.round(cardWidthPxFromPxPerCm(15))}
          max={Math.round(cardWidthPxFromPxPerCm(120))}
          step={1}
          value={Math.round(widthPx)}
          onChange={(e) => setWidthPx(Number(e.target.value))}
          className="w-full accent-cyan-500 h-1 bg-gray-700 rounded-lg"
          aria-label="Card width"
        />
        <p className="text-cyan-300 text-sm mt-3 font-mono tabular-nums">
          {widthPx.toFixed(0)} px · {pxPerCm.toFixed(1)} px/cm
        </p>
        <p className="text-gray-500 text-xs mt-1">Arrow keys for fine steps</p>
        <button
          type="button"
          disabled={!ok}
          onClick={() => onDone(pxPerCm)}
          className="mt-4 px-8 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white font-bold uppercase tracking-wider text-sm"
        >
          Continue
        </button>
      </div>
    </>
  );
}

// ─── Step 2: blind spot ──────────────────────────────────────────────────────

function BlindSpotStep({
  onDone,
  pxPerCm,
  targetDistanceCm,
}: {
  onDone: (offsetsPx: number[]) => void;
  pxPerCm: number;
  targetDistanceCm: number;
}) {
  const [running, setRunning] = useState(false);
  const [trial, setTrial] = useState(0);
  const [dotX, setDotX] = useState(0);
  const [squareX, setSquareX] = useState(0);
  const [reach, setReach] = useState<{ needPx: number; havePx: number } | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const offsetsRef = useRef<number[]>([]);
  const stateRef = useRef({ x: 0, squareX: 0, lastT: 0, active: false });

  /**
   * Where the fixation square has to sit for the blind spot to be reachable.
   *
   * The dot has to travel `d · tan(13.5°)` to the left of the square before it
   * enters the blind spot — 534 px at 40 cm on a typical panel, 800 px at 60 cm.
   * The strip was previously capped at 1024 px with the square centred, leaving
   * 512 px of travel: the dot ran off the end and restarted before it could
   * vanish, which is not something the participant can tell apart from "my blind
   * spot is not there".
   *
   * The paper puts the square at screen centre, which works because the geometry
   * only cares about the *separation* at the moment it disappears, not where the
   * square is. So centre it when that leaves enough room, and slide it right
   * when it does not.
   */
  const layoutFor = useCallback(
    (stripWidth: number) => {
      const needPx = targetDistanceCm * Math.tan((BLIND_SPOT_ECCENTRICITY_DEG * Math.PI) / 180) * pxPerCm;
      // Headroom: the participant may be further back than the target, and
      // individual blind spots sit out to about 15°.
      const wanted = needPx * 1.35;
      const x = Math.min(stripWidth - DOT_PX * 2, Math.max(stripWidth / 2, wanted));
      return { squareX: x, needPx, havePx: x };
    },
    [pxPerCm, targetDistanceCm],
  );

  const restartSweep = useCallback(() => {
    const strip = stripRef.current;
    if (!strip) return false;
    const w = strip.clientWidth;
    const { squareX: sx, needPx, havePx } = layoutFor(w);
    setSquareX(sx);
    setReach({ needPx, havePx });
    stateRef.current = {
      x: w - DOT_PX,
      squareX: sx,
      lastT: performance.now(),
      active: true,
    };
    setDotX(w - DOT_PX);
    return true;
  }, [layoutFor]);

  // Start only once the strip is in the DOM. Calling restartSweep straight from
  // the button handler read a ref that did not exist yet, left the sweep
  // inactive, and parked the dot at x=0 — visibly frozen at the left edge.
  useEffect(() => {
    if (running) restartSweep();
  }, [running, restartSweep]);

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    const tick = (t: number) => {
      const s = stateRef.current;
      if (s.active) {
        const dt = (t - s.lastT) / 1000;
        s.lastT = t;
        s.x -= SWEEP_PX_PER_SEC * dt;
        // Swept the whole strip with no response: sweep again rather than
        // record a position the participant never reacted to.
        if (s.x < 0) restartSweep();
        else setDotX(s.x);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, restartSweep]);

  const record = useCallback(() => {
    const s = stateRef.current;
    if (!s.active) return;
    offsetsRef.current = [...offsetsRef.current, Math.abs(s.squareX - s.x)];
    const done = offsetsRef.current.length;
    setTrial(done);
    if (done >= TRIALS) {
      s.active = false;
      onDone(offsetsRef.current);
    } else {
      restartSweep();
    }
  }, [onDone, restartSweep]);

  useEffect(() => {
    if (!running) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      e.preventDefault();
      record();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, record]);

  // How far out the dot currently is, in degrees of visual angle — the quantity
  // that has to reach ~13.5° for the blind spot to be found at all.
  const eccentricityDeg =
    (Math.atan(Math.abs(squareX - dotX) / pxPerCm / Math.max(targetDistanceCm, 1)) * 180) / Math.PI;

  return (
    <>
      {/* Full-bleed: the dot needs every pixel of travel it can get, and capping
          this at a centred 1024 px was what stopped the blind spot being
          reachable at all. Escapes the parent's padding on purpose. */}
      <div
        ref={stripRef}
        className="relative w-screen h-56 border-y-2 border-gray-800 bg-black overflow-hidden"
      >
        {running && (
          <>
            <div
              className="absolute bg-white"
              style={{
                width: SQUARE_PX,
                height: SQUARE_PX,
                left: squareX,
                top: '50%',
                transform: 'translate(-50%, -50%)',
              }}
            />
            <div
              className="absolute rounded-full bg-red-500"
              style={{
                width: DOT_PX,
                height: DOT_PX,
                left: dotX,
                top: '50%',
                transform: 'translateY(-50%)',
              }}
            />
          </>
        )}
      </div>

      <div className="text-center bg-gray-900 bg-opacity-90 px-6 py-4 rounded-xl border border-gray-800 w-full max-w-lg">
        {!running ? (
          <>
            <ol className="text-sm text-gray-300 space-y-1.5 text-left list-decimal list-inside">
              <li>Sit the way you will sit for the test.</li>
              <li>Cover your <strong>right eye</strong> with your hand.</li>
              <li>Stare at the white square. Do not follow the dot.</li>
              <li>Press <kbd className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-600 font-mono text-xs">Space</kbd> the instant the dot vanishes.</li>
            </ol>
            <button
              type="button"
              onClick={() => setRunning(true)}
              className="mt-4 px-8 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold uppercase tracking-wider text-sm"
            >
              Start
            </button>
          </>
        ) : (
          <>
            <p className="text-xl font-bold text-white">
              Press <kbd className="px-2 py-0.5 rounded bg-gray-800 border border-gray-600 font-mono text-base">Space</kbd> when it vanishes
            </p>
            {/* Current separation in degrees. If this never climbs past ~13°
                the dot cannot reach the blind spot on this display, which is
                otherwise indistinguishable from "it just never vanishes". */}
            <p className="text-cyan-300 text-sm mt-2 font-mono tabular-nums">
              {trial} / {TRIALS} measurements · {eccentricityDeg.toFixed(1)}°
            </p>
            {reach && reach.havePx < reach.needPx && (
              <p className="text-amber-400 text-xs mt-2">
                This display is too narrow to reach the blind spot at {targetDistanceCm} cm —
                the dot can only get {(reach.havePx / reach.needPx * BLIND_SPOT_ECCENTRICITY_DEG).toFixed(1)}° out.
                Use a wider window, or lower the target distance.
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
}

// ─── Step 3: sit at the configured distance ──────────────────────────────────

/**
 * The step the other two exist to make possible: hold the participant to the
 * distance the admin config specifies, with a live reading rather than a guess.
 */
function PositionStep({
  calibration,
  liveScale,
  targetDistanceCm,
  onDone,
}: {
  calibration: DistanceCalibration;
  liveScale: number | null;
  targetDistanceCm: number;
  onDone: () => void;
}) {
  const distanceCm = liveScale != null ? distanceFromFace(calibration, liveScale) : NaN;
  const check = liveScale != null ? checkDistance(calibration, liveScale, targetDistanceCm) : null;
  const onTarget = check?.verdict === 'ok';

  const instruction = !check || check.verdict === 'unknown'
    ? 'Looking for your face…'
    : check.verdict === 'too-close'
      ? 'Move Back'
      : check.verdict === 'too-far'
        ? 'Move Closer'
        : 'Hold This Position';

  // A bar centred on the target: the marker sits left when too close, right when
  // too far, and the shaded middle is the accepted band. Easier to act on than a
  // number, because it shows which way and how far in one glance.
  const band = check?.bandCm ?? 3;
  const span = band * 4;
  const offset = Number.isFinite(distanceCm)
    ? Math.max(-1, Math.min(1, (distanceCm - targetDistanceCm) / span))
    : 0;

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

      <div className="text-center bg-gray-900 bg-opacity-90 px-6 py-3 rounded-xl border border-gray-800 w-full max-w-lg">
        <p className={`text-xl font-bold ${onTarget ? 'text-green-400' : 'text-red-400'}`}>{instruction}</p>
        <p className="text-cyan-300 text-sm mt-2 font-mono tabular-nums">
          measured {calibration.distanceCm.toFixed(1)}cm ±{(calibration.spreadCm ?? 0).toFixed(1)} ·
          blind spot {BLIND_SPOT_ECCENTRICITY_DEG}° · {calibration.pxPerCm.toFixed(1)} px/cm
        </p>
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
