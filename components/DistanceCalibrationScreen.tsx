'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CARD_ASPECT,
  CARD_WIDTH_MM,
  cardWidthPxFromPxPerCm,
  isPlausibleScale,
  loadScreenScale,
  pxPerCmFromCardWidth,
  saveScreenScale,
  viewportWidthCm,
  type ScreenScale,
} from '@/lib/screenScale';
import { faceWidthCmFromCard, isPlausibleFaceWidthCm } from '@/lib/positionAnchor';
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
 * Measure how far the participant actually is from the screen.
 *
 * Two tasks, following Li, Joo, Yeatman & Reinecke (2020): match a bank card to
 * get the screen's physical scale, then find the blind spot to get an absolute
 * distance. The camera is already running behind this screen, so face size is
 * sampled at the same moment — pairing the two gives the constant that converts
 * face size to centimetres for the rest of the session.
 */

type Step = 'card' | 'faceCard' | 'choice' | 'blindspot' | 'result';

const TRIALS = 5;
/** Sweep speed. Slow enough that a late keypress costs little, fast enough not to bore. */
const BALL_SPEED_PX_PER_SEC = 180;
const BALL_RADIUS = 9;
const FIXATION_SIZE = 22;
/** Fixation sits near the right edge so the ball has room to sweep left. */
const FIXATION_RIGHT_FRACTION = 0.92;

export interface DistanceCalibrationScreenProps {
  /** Configured target distance (cm) the participant should end up at. */
  targetDistanceCm: number;
  /** Live normalised face width from the tracking loop, or null when no face. */
  faceWidthNorm: number | null;
  /** Live head yaw (radians) — corrects the foreshortening of a turned head. */
  yawRad: number;
  /** Shared camera element, drawn into the card-at-face step. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Physical face width in cm — the number that makes drift readings exact. */
  onFaceWidthCm: (cm: number) => void;
  onComplete: (calibration: DistanceCalibration | null) => void;
  /** Continue without a measurement; the old face-width band is used instead. */
  onSkip: () => void;
}

export default function DistanceCalibrationScreen({
  targetDistanceCm,
  faceWidthNorm,
  yawRad,
  videoRef,
  onFaceWidthCm,
  onComplete,
  onSkip,
}: DistanceCalibrationScreenProps) {
  const [step, setStep] = useState<Step>('card');
  const [saved] = useState<ScreenScale | null>(() => loadScreenScale());
  const [pxPerCm, setPxPerCm] = useState<number | null>(saved?.pxPerCm ?? null);
  const [calibration, setCalibration] = useState<DistanceCalibration | null>(null);
  const [trialsCm, setTrialsCm] = useState<number[]>([]);
  const [faceCm, setFaceCm] = useState<number | null>(null);

  // Live face scale, sampled continuously so the blind-spot step can pair its
  // distance with the face size observed at that same moment.
  const scaleSamplesRef = useRef<number[]>([]);
  const liveScale = faceWidthNorm != null ? toFaceScale(faceWidthNorm, yawRad) : null;

  useEffect(() => {
    if (step === 'blindspot' && liveScale != null && liveScale > 0) {
      scaleSamplesRef.current.push(liveScale);
    }
  }, [step, liveScale]);

  const finishBlindSpot = useCallback(
    (offsetsPx: number[]) => {
      if (pxPerCm == null) return;
      const agg = aggregateBlindSpotTrials(offsetsPx, pxPerCm);
      setTrialsCm(agg.perTrialCm);

      const samples = [...scaleSamplesRef.current].sort((a, b) => a - b);
      const medianScale = samples.length
        ? samples[samples.length >> 1]
        : liveScale ?? 0;

      const cal = calibrate({
        distanceCm: agg.distanceCm,
        faceScale: medianScale,
        pxPerCm,
        method: 'blind-spot',
        spreadCm: agg.spreadCm,
      });
      setCalibration(cal);
      setStep('result');
    },
    [pxPerCm, liveScale],
  );

  const restart = useCallback(() => {
    scaleSamplesRef.current = [];
    setCalibration(null);
    setTrialsCm([]);
    setStep('blindspot');
  }, []);

  const STEP_LABEL: Record<Step, string> = {
    card: 'Measure your screen',
    faceCard: 'Measure your face',
    choice: 'Distance reference',
    blindspot: 'Measure your distance',
    result: 'Distance measured',
  };
  const STEP_NUMBER: Record<Step, number> = { card: 1, faceCard: 2, choice: 3, blindspot: 3, result: 3 };

  return (
    <div className="fixed inset-0 z-[200] bg-slate-950 text-slate-100 overflow-y-auto">
      <div className="min-h-full flex flex-col items-center justify-center gap-6 p-8">
        <header className="text-center">
          <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-cyan-400">
            Step {STEP_NUMBER[step]} of 3 · target {targetDistanceCm} cm
          </p>
          <h2 className="text-2xl font-bold mt-2">{STEP_LABEL[step]}</h2>
        </header>

        {step === 'card' && (
          <CardStep
            initialPxPerCm={pxPerCm}
            savedScale={saved}
            onDone={(v) => {
              setPxPerCm(v);
              saveScreenScale(cardWidthPxFromPxPerCm(v));
              scaleSamplesRef.current = [];
              setStep('faceCard');
            }}
          />
        )}

        {step === 'faceCard' && (
          <FaceCardStep
            videoRef={videoRef}
            faceWidthNorm={faceWidthNorm}
            onDone={(cm) => {
              setFaceCm(cm);
              onFaceWidthCm(cm);
              setStep('choice');
            }}
            onSkip={() => setStep('choice')}
          />
        )}

        {step === 'choice' && (
          <ChoiceStep
            faceCm={faceCm}
            targetDistanceCm={targetDistanceCm}
            onBlindSpot={() => { scaleSamplesRef.current = []; setStep('blindspot'); }}
            onUseTarget={() => {
              // Anchor on where they are sitting right now and call it the
              // target. The absolute number is a guess, but K is pinned to the
              // face size observed at this instant, so every later deviation is
              // exact — which is what the position gate needs.
              const s = liveScale;
              onComplete(
                s && pxPerCm != null
                  ? calibrate({ distanceCm: targetDistanceCm, faceScale: s, pxPerCm, method: 'assumed' })
                  : null,
              );
            }}
            ready={liveScale != null && pxPerCm != null}
          />
        )}

        {step === 'blindspot' && pxPerCm != null && (
          <BlindSpotStep pxPerCm={pxPerCm} onDone={finishBlindSpot} faceSeen={faceWidthNorm != null} />
        )}

        {step === 'result' && (
          <ResultStep
            calibration={calibration}
            trialsCm={trialsCm}
            targetDistanceCm={targetDistanceCm}
            liveScale={liveScale}
            onRetry={restart}
            onAccept={() => calibration && onComplete(calibration)}
          />
        )}

        <button
          type="button"
          onClick={onSkip}
          className="text-xs text-slate-500 hover:text-slate-300 underline underline-offset-4"
        >
          Skip — continue without measuring (angles will be estimates)
        </button>
      </div>
    </div>
  );
}

// ─── Step 1: card ────────────────────────────────────────────────────────────

function CardStep({
  initialPxPerCm,
  savedScale,
  onDone,
}: {
  initialPxPerCm: number | null;
  savedScale: ScreenScale | null;
  onDone: (pxPerCm: number) => void;
}) {
  // Start from a typical laptop panel so the rectangle is in the right
  // neighbourhood before the participant touches anything.
  const [widthPx, setWidthPx] = useState(() =>
    cardWidthPxFromPxPerCm(initialPxPerCm ?? 55),
  );
  const pxPerCm = pxPerCmFromCardWidth(widthPx);
  const ok = isPlausibleScale(pxPerCm);

  // Arrow keys for the last millimetre, where a slider drag is too coarse.
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
    <div className="flex flex-col items-center gap-5 max-w-2xl w-full">
      <p className="text-sm text-slate-400 text-center max-w-lg">
        Hold a bank card flat against the screen and resize the rectangle until it matches
        exactly. Any card works — they are all 85.6 mm wide.
      </p>

      <div
        className="rounded-xl border-2 border-cyan-400 bg-gradient-to-br from-slate-800 to-slate-700 shadow-lg flex items-end p-3"
        style={{ width: widthPx, height: widthPx / CARD_ASPECT }}
      >
        <span className="font-mono text-[10px] tracking-widest text-slate-400">85.6 mm</span>
      </div>

      <input
        type="range"
        min={Math.round(cardWidthPxFromPxPerCm(15))}
        max={Math.round(cardWidthPxFromPxPerCm(120))}
        step={1}
        value={Math.round(widthPx)}
        onChange={(e) => setWidthPx(Number(e.target.value))}
        className="w-full max-w-lg accent-cyan-500"
        aria-label="Card width"
      />

      <div className="font-mono text-xs text-slate-400 tabular-nums">
        {widthPx.toFixed(0)} px · {pxPerCm.toFixed(1)} px/cm · screen {viewportWidthCm(pxPerCm).toFixed(1)} cm wide
        <span className="text-slate-600"> · arrow keys for fine steps</span>
      </div>

      {!ok && (
        <p className="text-xs text-amber-400">
          That size is outside the range any real display gives. Check the card is flat against
          the screen.
        </p>
      )}

      <div className="flex items-center gap-3">
        {savedScale && (
          <button
            type="button"
            onClick={() => onDone(savedScale.pxPerCm)}
            className="px-4 py-2 rounded-lg border border-slate-600 text-sm text-slate-300 hover:bg-slate-800"
          >
            Use saved ({savedScale.pxPerCm.toFixed(1)} px/cm)
          </button>
        )}
        <button
          type="button"
          disabled={!ok}
          onClick={() => onDone(pxPerCm)}
          className="px-6 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:hover:bg-cyan-600 text-white text-sm font-semibold"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

// ─── Step 2: card at the face ────────────────────────────────────────────────

/**
 * Physical face width, from a card held in the plane of the face.
 *
 * This is the one measurement that assumes nothing whatsoever about the camera.
 * The card and the face are the same distance away, so their pixel widths stand
 * in exactly the same ratio as their real widths and the focal length cancels —
 * which is what turns every later drift reading from a ratio into centimetres.
 *
 * The card is located by dragging two handles onto its edges rather than by
 * detecting it. Rectangle detection on a webcam frame fails on dark cards,
 * glare and motion blur, and a silent mis-detection here would corrupt every
 * position check for the rest of the session; two deliberate drags cannot fail
 * quietly.
 */
function FaceCardStep({
  videoRef,
  faceWidthNorm,
  onDone,
  onSkip,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  faceWidthNorm: number | null;
  onDone: (faceWidthCm: number) => void;
  onSkip: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [markers, setMarkers] = useState<[number, number]>([0.35, 0.65]);
  const [dragging, setDragging] = useState<0 | 1 | null>(null);
  /** Whether the shared video element is actually producing frames yet. */
  const [videoLive, setVideoLive] = useState(false);

  // Mirrored to match the rest of the app, so the participant's movements match
  // what they see. The distance between the handles is unaffected by the flip.
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      const live = !!(video && video.videoWidth > 0 && video.readyState >= 2);
      setVideoLive((prev) => (prev === live ? prev : live));
      if (canvas && live && video) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
          if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
          ctx.save();
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          ctx.restore();
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [videoRef]);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (dragging === null) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      setMarkers((m) => (dragging === 0 ? [x, m[1]] : [m[0], x]));
    },
    [dragging],
  );

  const cardWidthNorm = Math.abs(markers[1] - markers[0]);
  const faceCm =
    faceWidthNorm != null && cardWidthNorm > 0.01
      ? faceWidthCmFromCard(cardWidthNorm, faceWidthNorm, CARD_WIDTH_MM / 10)
      : NaN;
  const ok = isPlausibleFaceWidthCm(faceCm);

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-3xl">
      <p className="text-sm text-slate-400 text-center max-w-xl">
        Hold the card flat against your cheek, level with your eyes and facing the camera. Then
        drag the two handles onto the left and right edges of the card in the picture.
      </p>

      <div
        className="relative w-full aspect-video rounded-xl overflow-hidden border border-slate-700 bg-black select-none touch-none"
        onPointerMove={onPointerMove}
        onPointerUp={() => setDragging(null)}
        onPointerLeave={() => setDragging(null)}
      >
        <canvas ref={canvasRef} className="w-full h-full" />
        {!videoLive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6">
            <p className="text-sm font-semibold text-amber-400">Camera not running</p>
            <p className="text-xs text-slate-400 max-w-sm">
              This step needs the live picture. If it does not appear within a few seconds, check
              that camera access is still granted and that no other tab or app is holding the
              camera, then reload.
            </p>
          </div>
        )}
        {videoLive && markers.map((x, i) => (
          <div
            key={i}
            onPointerDown={() => setDragging(i as 0 | 1)}
            className="absolute top-0 bottom-0 w-8 -ml-4 cursor-ew-resize flex items-center justify-center"
            style={{ left: `${x * 100}%` }}
          >
            <div className="w-0.5 h-full bg-cyan-400" />
            <div className="absolute w-4 h-4 rounded-full bg-cyan-400 border-2 border-slate-950 shadow" />
          </div>
        ))}
      </div>

      <div className="font-mono text-xs text-slate-400 tabular-nums">
        {faceWidthNorm == null
          ? 'no face detected'
          : `card ${(cardWidthNorm * 100).toFixed(1)}% of frame · face ${(faceWidthNorm * 100).toFixed(1)}% · face width ${Number.isFinite(faceCm) ? faceCm.toFixed(1) : '—'} cm`}
      </div>

      {faceWidthNorm != null && Number.isFinite(faceCm) && !ok && (
        <p className="text-xs text-amber-400 text-center max-w-md">
          {faceCm.toFixed(1)} cm is outside the range a real face spans (10–20 cm). Check that the
          handles sit on the card edges and that the card is flat rather than angled.
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onSkip}
          className="px-4 py-2 rounded-lg border border-slate-600 text-sm text-slate-300 hover:bg-slate-800"
        >
          Skip
        </button>
        <button
          type="button"
          disabled={!ok}
          onClick={() => onDone(faceCm)}
          className="px-6 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:hover:bg-cyan-600 text-white text-sm font-semibold"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

// ─── Step 3: how to anchor the absolute distance ─────────────────────────────

function ChoiceStep({
  faceCm,
  targetDistanceCm,
  onBlindSpot,
  onUseTarget,
  ready,
}: {
  faceCm: number | null;
  targetDistanceCm: number;
  onBlindSpot: () => void;
  onUseTarget: () => void;
  ready: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-5 max-w-xl w-full">
      {faceCm != null && (
        <p className="font-mono text-xs text-emerald-400 tabular-nums">
          face width measured: {faceCm.toFixed(1)} cm
        </p>
      )}
      <p className="text-sm text-slate-400 text-center">
        Position tracking is ready either way — drift from where you sit is measured exactly from
        here on. What is left is the <em>absolute</em> distance, which only affects the units the
        results are reported in.
      </p>
      <div className="grid sm:grid-cols-2 gap-3 w-full">
        <button
          type="button"
          onClick={onBlindSpot}
          className="text-left p-4 rounded-xl border border-cyan-700 bg-cyan-950/40 hover:bg-cyan-950/70"
        >
          <p className="text-sm font-semibold text-cyan-300">Measure it (about a minute)</p>
          <p className="text-xs text-slate-400 mt-1">
            A blind-spot task gives the real distance to about ±3 cm. Worth it if results will be
            compared against published norms.
          </p>
        </button>
        <button
          type="button"
          onClick={onUseTarget}
          disabled={!ready}
          className="text-left p-4 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 disabled:opacity-40"
        >
          <p className="text-sm font-semibold text-slate-300">
            Sit where you are and call it {targetDistanceCm} cm
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Locks your current position as the reference. Drift from it is still measured exactly;
            only the absolute figure is a guess, so degrees shift by however wrong it is.
          </p>
          {!ready && <p className="text-[11px] text-amber-400 mt-2">Waiting for the camera to see your face…</p>}
        </button>
      </div>
    </div>
  );
}

// ─── Step 4: blind spot ──────────────────────────────────────────────────────

function BlindSpotStep({
  pxPerCm,
  onDone,
  faceSeen,
}: {
  pxPerCm: number;
  onDone: (offsetsPx: number[]) => void;
  faceSeen: boolean;
}) {
  const [started, setStarted] = useState(false);
  const [offsets, setOffsets] = useState<number[]>([]);
  const [ballX, setBallX] = useState(0);
  const stripRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const stateRef = useRef({ x: 0, fixX: 0, lastT: 0, running: false });

  const beginTrial = useCallback(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const w = strip.clientWidth;
    const fixX = w * FIXATION_RIGHT_FRACTION;
    stateRef.current = { x: fixX, fixX, lastT: performance.now(), running: true };
    setBallX(fixX);
  }, []);

  // The ball starts at fixation and sweeps outward, so it is visible before it
  // vanishes — a ball that starts already inside the blind spot gives nothing to
  // react to.
  useEffect(() => {
    if (!started) return;
    const tick = (t: number) => {
      const s = stateRef.current;
      if (s.running) {
        const dt = (t - s.lastT) / 1000;
        s.lastT = t;
        s.x -= BALL_SPEED_PX_PER_SEC * dt;
        if (s.x < BALL_RADIUS) {
          // Swept the whole strip without a response — void, sweep again rather
          // than record a bogus offset.
          beginTrial();
        } else {
          setBallX(s.x);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [started, beginTrial]);

  const record = useCallback(() => {
    const s = stateRef.current;
    if (!s.running) return;
    const offset = Math.abs(s.fixX - s.x);
    const next = [...offsets, offset];
    setOffsets(next);
    if (next.length >= TRIALS) {
      s.running = false;
      onDone(next);
    } else {
      beginTrial();
    }
  }, [offsets, onDone, beginTrial]);

  useEffect(() => {
    if (!started) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      e.preventDefault();
      record();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [started, record]);

  const livePreview = offsets.length
    ? aggregateBlindSpotTrials(offsets, pxPerCm).distanceCm
    : NaN;

  return (
    <div className="flex flex-col items-center gap-5 w-full max-w-5xl">
      {!started ? (
        <div className="flex flex-col items-center gap-4 max-w-xl text-center">
          <ol className="text-sm text-slate-300 space-y-2 text-left list-decimal list-inside">
            <li>Sit the way you will sit for the test, and stay still from now on.</li>
            <li><strong>Cover your right eye</strong> with your hand. Keep your left eye open.</li>
            <li>Stare at the white square. Do not follow the dot with your eye.</li>
            <li>The dot drifts left and will vanish. Press <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-600 font-mono text-xs">Space</kbd> the instant it does.</li>
          </ol>
          <p className="text-xs text-slate-500 max-w-md">
            The dot disappears because it lands on your blind spot, where the optic nerve leaves
            the retina. How far out that happens tells us how far you are from the screen.
          </p>
          {!faceSeen && (
            <p className="text-xs text-amber-400">
              No face detected yet — the camera needs to see you for this to work.
            </p>
          )}
          <button
            type="button"
            onClick={() => { setStarted(true); beginTrial(); }}
            className="px-6 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold"
          >
            Start
          </button>
        </div>
      ) : (
        <>
          <div
            ref={stripRef}
            className="relative w-full h-40 rounded-xl bg-slate-900 border border-slate-800 overflow-hidden"
          >
            <div
              className="absolute bg-white"
              style={{
                width: FIXATION_SIZE,
                height: FIXATION_SIZE,
                left: `${FIXATION_RIGHT_FRACTION * 100}%`,
                top: '50%',
                transform: 'translate(-50%, -50%)',
              }}
            />
            <div
              className="absolute rounded-full bg-red-500"
              style={{
                width: BALL_RADIUS * 2,
                height: BALL_RADIUS * 2,
                left: ballX,
                top: '50%',
                transform: 'translate(-50%, -50%)',
              }}
            />
          </div>
          <p className="text-sm text-slate-400">
            Keep staring at the square. Press <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-600 font-mono text-xs">Space</kbd> when the dot vanishes.
          </p>
          <div className="font-mono text-xs text-slate-500 tabular-nums">
            trial {offsets.length + 1} / {TRIALS}
            {Number.isFinite(livePreview) && ` · so far ≈ ${livePreview.toFixed(0)} cm`}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Step 3: result ──────────────────────────────────────────────────────────

function ResultStep({
  calibration,
  trialsCm,
  targetDistanceCm,
  liveScale,
  onRetry,
  onAccept,
}: {
  calibration: DistanceCalibration | null;
  trialsCm: number[];
  targetDistanceCm: number;
  liveScale: number | null;
  onRetry: () => void;
  onAccept: () => void;
}) {
  const live = useMemo(() => {
    if (!calibration || liveScale == null) return null;
    return {
      distanceCm: distanceFromFace(calibration, liveScale),
      check: checkDistance(calibration, liveScale, targetDistanceCm),
    };
  }, [calibration, liveScale, targetDistanceCm]);

  if (!calibration || !Number.isFinite(calibration.distanceCm)) {
    return (
      <div className="flex flex-col items-center gap-4 max-w-lg text-center">
        <p className="text-sm text-amber-400">
          None of the trials gave a usable reading. That usually means the dot was never actually
          in the blind spot — check that the right eye is covered and that you kept staring at
          the square rather than following the dot.
        </p>
        <button type="button" onClick={onRetry} className="px-6 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold">
          Try again
        </button>
      </div>
    );
  }

  const noisy = (calibration.spreadCm ?? 0) > 4;

  return (
    <div className="flex flex-col items-center gap-5 max-w-xl w-full">
      <div className="grid grid-cols-2 gap-px bg-slate-800 rounded-xl overflow-hidden w-full">
        <div className="bg-slate-900 p-4">
          <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-slate-500">Measured</p>
          <p className="text-3xl font-bold tabular-nums mt-1">{calibration.distanceCm.toFixed(1)}<span className="text-base font-normal text-slate-500"> cm</span></p>
          <p className="text-[11px] text-slate-500 mt-1">± {(calibration.spreadCm ?? 0).toFixed(1)} cm across {trialsCm.length} trials</p>
        </div>
        <div className="bg-slate-900 p-4">
          <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-slate-500">Target</p>
          <p className="text-3xl font-bold tabular-nums mt-1 text-cyan-400">{targetDistanceCm}<span className="text-base font-normal text-slate-500"> cm</span></p>
          <p className="text-[11px] text-slate-500 mt-1">from the session config</p>
        </div>
      </div>

      {live && (
        <p className={`text-sm font-semibold ${live.check.verdict === 'ok' ? 'text-emerald-400' : 'text-amber-400'}`}>
          {live.check.verdict === 'ok'
            ? `You are at ${live.distanceCm.toFixed(0)} cm — good.`
            : live.check.verdict === 'too-close'
              ? `You are at ${live.distanceCm.toFixed(0)} cm — move back to about ${targetDistanceCm} cm.`
              : `You are at ${live.distanceCm.toFixed(0)} cm — move closer to about ${targetDistanceCm} cm.`}
        </p>
      )}

      {noisy && (
        <p className="text-xs text-amber-400 text-center max-w-md">
          The trials disagreed by more than 4 cm, which usually means a few keypresses were late.
          Repeating the measurement will tighten it.
        </p>
      )}

      <p className="text-xs text-slate-500 text-center max-w-md">
        From here your distance is tracked continuously from the camera, so you can settle into
        the target before calibration starts.
      </p>

      <div className="flex items-center gap-3">
        <button type="button" onClick={onRetry} className="px-4 py-2 rounded-lg border border-slate-600 text-sm text-slate-300 hover:bg-slate-800">
          Measure again
        </button>
        <button type="button" onClick={onAccept} className="px-6 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold">
          Continue
        </button>
      </div>

      <p className="font-mono text-[10px] text-slate-700 tabular-nums">
        K = {calibration.k.toFixed(4)} · {calibration.pxPerCm.toFixed(1)} px/cm · blind spot {BLIND_SPOT_ECCENTRICITY_DEG}°
      </p>
    </div>
  );
}
