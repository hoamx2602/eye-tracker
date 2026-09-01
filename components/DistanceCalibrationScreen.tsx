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
  assessBlindSpot,
  calibrate,
  checkDistance,
  distanceFromFace,
  faceScale as toFaceScale,
  type DistanceCalibration,
} from '@/lib/viewingDistance';
import {
  APPROACH_TOLERANCE,
  approximateDistanceCm,
  calibrateFromFocal,
  focalFromCalibration,
  fovDegFromFocal,
  isPlausibleFocal,
  loadFocal,
  saveFocal,
  clearFocal,
  type CameraFocal,
} from '@/lib/cameraFocal';
import FaceCardStep from '@/components/FaceCardStep';

/**
 * Put the participant at the distance the admin config asks for, and prove it.
 *
 * The last step is the point of the whole screen; everything before it exists
 * because you cannot hold someone to 40 cm without first being able to measure
 * 40 cm. What that costs the participant depends on what has been measured
 * before:
 *
 *   card       the screen's physical scale. Per display, cached — usually
 *              already done and skipped.
 *   face-card  the participant's physical face width, from a card at the cheek.
 *              Ten seconds, and the only per-person step in the common case.
 *   approach   get roughly to the target BEFORE measuring, guided by a coarse
 *              estimate from a nominal camera. Skipped when the camera is
 *              already known, since then nothing is about to be measured.
 *   bootstrap  one absolute distance, by tape measure or the blind-spot task,
 *              taken near the target. ONLY when this camera has never been
 *              calibrated. See lib/cameraFocal.ts — K = F · W_face splits into a
 *              camera term and a person term, so F is measured once per device
 *              and reused for everyone afterwards.
 *   position   hold the measured distance to the configured band.
 *
 * The approach step is not cosmetic. The blind-spot layout is computed for the
 * target distance and runs out of headroom around 54 cm, so measuring from 65 cm
 * can be impossible rather than merely imprecise; and because the camera sits
 * above the screen rather than in it, K quietly inherits the distance it was
 * measured at and passes that on through the cached focal length.
 *
 * So the first participant on a new machine does the full sequence once; every
 * one after them does card-at-cheek and nothing else.
 *
 * Blind-spot procedure follows Li, Joo, Yeatman & Reinecke (2020), Scientific
 * Reports (https://www.nature.com/articles/s41598-019-57204-1): right eye
 * covered, 30 px red dot sweeping right to left across a 30 px fixation square
 * and repeating, five measurements, distance = separation / tan(13.5°).
 *
 * Three deliberate departures, all because the paper's setup is not guaranteed
 * here:
 *
 *   Trials are combined by median rather than mean. One late keypress would
 *   otherwise bias every distance the session reports afterwards.
 *
 *   Each trial reads the same edge from both directions and averages, which
 *   cancels reaction time — a one-directional bias worth ~4 cm that repetition
 *   cannot remove. See BlindSpotStep.
 *
 *   The square is centred only when centring leaves enough travel. The dot must
 *   get d·tan(13.5°) to its left — 528 px at 40 cm, 792 px at 60 cm — and on a
 *   narrow window half the width is not enough, in which case the square slides
 *   right. The off-axis error that introduces stays under 1.5% at every window
 *   width and target this flow supports.
 */

type Step = 'card' | 'face-card' | 'approach' | 'blindspot' | 'manual' | 'position';

/** Legs of one there-and-back trial. See BlindSpotStep for why there are two. */
type Phase = 'sweep-out' | 'to-reversal' | 'sweep-in';

/** Paper values. */
const TRIALS = 5;
const DOT_PX = 30;
const SQUARE_PX = 30;
/** Not specified in the paper; jsPsych's default of 3 px/frame at 60 Hz. */
const SWEEP_PX_PER_SEC = 180;
/**
 * How far past the reported disappearance the dot travels before turning back,
 * in degrees of visual angle. Two degrees puts the reversal comfortably inside
 * an optic disc (~5.5° wide) without risking the far edge, and spaces the two
 * presses about 0.9 s apart so neither can be mistaken for a double-tap.
 */
const REVERSAL_MARGIN_DEG = 2;
/**
 * How far to the right of the square the dot starts.
 *
 * The paper sweeps in from the edge of the screen, which is fine on a display
 * only a little wider than the 13.5° it has to cover. Full-bleed on a modern
 * panel that meant a thousand pixels — five and a half seconds — of travel
 * through the *nasal* field, where by construction nothing can happen, before
 * the dot even reached fixation. Participants reasonably concluded the
 * disappearance was supposed to happen at the end of the strip.
 *
 * A short approach still crosses fixation, which cues that the trial is under
 * way, without the dead time before it.
 */
const APPROACH_PX = 150;

/** Bounds on a hand-measured distance — the same plausibility band as the task. */
const MIN_MANUAL_CM = 15;
const MAX_MANUAL_CM = 120;

export interface DistanceCalibrationScreenProps {
  /** Target distance (cm) from the admin config — what this screen enforces. */
  targetDistanceCm: number;
  /** Live normalised face width from the tracking loop, or null when no face. */
  faceWidthNorm: number | null;
  /** Live head yaw (radians) — corrects the foreshortening of a turned head. */
  yawRad: number;
  /**
   * Multiplier on the distance band, from the admin config.
   *
   * Passed in rather than defaulted so this screen and the head-positioning gate
   * cannot drift apart: they used to hold the participant to ±4 cm here and then
   * accept ±8 cm one screen later, which is where the anchor is actually locked.
   */
  distanceTolerance: number;
  /** Camera feed, for the card-at-cheek frame grab. */
  videoRef: React.RefObject<HTMLVideoElement>;
  /** Identity of this camera and framing — which cached focal length applies. */
  cameraKey: string;
  onComplete: (calibration: DistanceCalibration, faceWidthCm: number | null) => void;
}

export default function DistanceCalibrationScreen({
  targetDistanceCm,
  faceWidthNorm,
  yawRad,
  distanceTolerance,
  videoRef,
  cameraKey,
  onComplete,
}: DistanceCalibrationScreenProps) {
  const [saved] = useState<ScreenScale | null>(() => loadScreenScale());
  const [step, setStep] = useState<Step>(saved ? 'face-card' : 'card');
  const [pxPerCm, setPxPerCm] = useState<number | null>(saved?.pxPerCm ?? null);
  /** Physical face width from the card step; null when it was skipped. */
  const [faceWidthCm, setFaceWidthCm] = useState<number | null>(null);
  /** Focal length in use — cached from a previous session, or measured here. */
  const [focal, setFocal] = useState<CameraFocal | null>(null);
  const [calibration, setCalibration] = useState<DistanceCalibration | null>(null);
  /** Why the last blind-spot attempt was thrown away, shown before retrying. */
  const [rejection, setRejection] = useState<string | null>(null);
  /** True only while a sweep is actually running — see the sampling effect. */
  const [measuring, setMeasuring] = useState(false);

  const liveScale = faceWidthNorm != null ? toFaceScale(faceWidthNorm) : null;

  /**
   * Face size *at the moment the distance is being measured*.
   *
   * K = d₀ · s₀ only holds if the two factors come from the same pose, so the
   * window this samples over has to be the window the participant is actually
   * doing the task in. Sampling from the start of the step instead swept in the
   * time they spent reading the instructions — which people typically do leaning
   * toward the screen, then sit back for the task — and the median came out of a
   * mixture of two distances.
   */
  const scaleSamplesRef = useRef<number[]>([]);
  const sampling = measuring || step === 'manual' || step === 'face-card' || step === 'approach';
  useEffect(() => {
    if (sampling && liveScale != null && liveScale > 0) {
      scaleSamplesRef.current.push(liveScale);
    }
  }, [sampling, liveScale]);

  /** Median face size over the measurement window, or the live value if empty. */
  const anchorScale = useCallback(() => {
    const samples = [...scaleSamplesRef.current].sort((a, b) => a - b);
    return samples.length ? samples[samples.length >> 1] : liveScale ?? 0;
  }, [liveScale]);

  /**
   * The card step is done — decide whether an absolute measurement is still owed.
   *
   * If this camera has a focal length on file, it is not: K = F · W_face
   * reconstructs the participant's constant from hardware already characterised,
   * and they go straight to positioning. That is the whole reason the card step
   * exists, and it is what the blind-spot task stops being for everyone after
   * the first person on a machine.
   */
  const finishFaceCard = useCallback(
    (measuredFaceWidthCm: number | null) => {
      setFaceWidthCm(measuredFaceWidthCm);
      if (pxPerCm == null) return;

      if (measuredFaceWidthCm != null) {
        const cached = loadFocal(cameraKey);
        if (cached) {
          const cal = calibrateFromFocal({
            f: cached.f,
            faceWidthCm: measuredFaceWidthCm,
            faceScale: anchorScale(),
            pxPerCm,
          });
          if (cal) {
            setFocal(cached);
            setCalibration(cal);
            setStep('position');
            return;
          }
        }
      }
      // No usable focal length: somebody has to measure one absolute distance.
      //
      // That happens on the seat step, not on a screen after it. The seat step is
      // where the approximate reading is shown, so it is where anyone can see the
      // reading is wrong — and a correction belongs where the error is visible,
      // not two screens later. They are the same act anyway: sit somewhere,
      // measure, type it. Splitting it across two screens added a screen.
      setStep(measuredFaceWidthCm != null ? 'approach' : 'manual');
    },
    [pxPerCm, cameraKey, anchorScale],
  );

  /**
   * One absolute distance has been obtained — bank it, and split out the camera.
   *
   * Deriving F here is what makes the measurement worth more than this session:
   * `F = K / W_face` strips the participant out of the constant and leaves a
   * number describing the optics, which every later session on this device can
   * reuse. It is only possible when the card step actually ran; without a face
   * width the session still works, it just cannot pay the saving forward.
   */
  const completeBootstrap = useCallback(
    (
      distanceCm: number,
      method: 'blind-spot' | 'manual',
      spreadCm?: number,
    ): boolean => {
      if (pxPerCm == null) return false;
      const cal = calibrate({
        distanceCm,
        faceScale: anchorScale(),
        pxPerCm,
        method,
        spreadCm,
        ...(faceWidthCm != null ? { faceWidthCm } : {}),
      });
      if (!cal) return false;

      if (faceWidthCm != null) {
        const f = focalFromCalibration(cal.k, faceWidthCm);
        if (isPlausibleFocal(f)) {
          const record: CameraFocal = {
            f,
            cameraKey,
            method,
            bootstrapDistanceCm: distanceCm,
            faceWidthCm,
            measuredAt: new Date().toISOString(),
          };
          if (saveFocal(record)) setFocal(record);
        }
      }

      setRejection(null);
      setCalibration(cal);
      setStep('position');
      return true;
    },
    [pxPerCm, anchorScale, faceWidthCm, cameraKey],
  );

  const finishBlindSpot = useCallback(
    (offsetsPx: number[]) => {
      if (pxPerCm == null) return;
      const agg = aggregateBlindSpotTrials(offsetsPx, pxPerCm);

      // K multiplies every distance the session reports afterwards — and, once
      // it becomes F, every distance on this machine afterwards — so a run that
      // does not hold up is rejected outright rather than quietly used. Without
      // this the screen also had a dead end: a run that produced no usable
      // distance left the sweep stopped, the counter at 5/5 and no way forward.
      const quality = assessBlindSpot(agg);
      if (!quality.ok) {
        scaleSamplesRef.current = [];
        setRejection(quality.reason);
        return;
      }
      if (!completeBootstrap(agg.distanceCm, 'blind-spot', agg.spreadCm)) {
        scaleSamplesRef.current = [];
        setRejection('That measurement could not be paired with a face size.');
      }
    },
    [pxPerCm, completeBootstrap],
  );

  const finishManual = useCallback(
    (distanceCm: number) => {
      completeBootstrap(distanceCm, 'manual');
    },
    [completeBootstrap],
  );

  /**
   * Re-derive the camera constant from a distance the participant just measured.
   *
   * The face size on screen right now and a real distance are between them the
   * whole of a bootstrap — F = K / W_face with K = actual · faceScale — so a
   * wrong reading can be corrected where it is noticed rather than by restarting
   * the flow. It also logs the factor it was out by, which is the one number
   * that says whether this was a stale focal length or something structural.
   */
  const correctFromMeasurement = useCallback(
    (actualCm: number) => {
      if (pxPerCm == null || faceWidthCm == null) return;
      const s = anchorScale();
      const cal = calibrate({ distanceCm: actualCm, faceScale: s, pxPerCm, method: 'manual', faceWidthCm });
      if (!cal) return;
      const f = focalFromCalibration(cal.k, faceWidthCm);
      if (!isPlausibleFocal(f)) return;
      const previous = focal;
      const record: CameraFocal = {
        f,
        cameraKey,
        method: 'manual',
        bootstrapDistanceCm: actualCm,
        faceWidthCm,
        measuredAt: new Date().toISOString(),
      };
      if (previous) {
        console.log(
          `[distance] corrected: the cached focal length was ${(previous.f / f).toFixed(2)}× ` +
          `too large (${fovDegFromFocal(previous.f).toFixed(0)}° → ` +
          `${fovDegFromFocal(f).toFixed(0)}° FOV), measured ${previous.measuredAt}`,
        );
      }
      if (saveFocal(record)) setFocal(record);
      setCalibration(cal);
    },
    [pxPerCm, faceWidthCm, anchorScale, cameraKey, focal],
  );

  /** Throw away the cached optics and measure them again from scratch. */
  const remeasureCamera = useCallback(() => {
    clearFocal();
    setFocal(null);
    setCalibration(null);
    scaleSamplesRef.current = [];
    setStep('manual');
  }, []);

  const TITLES: Record<Step, [string, string]> = {
    card: ['Screen Size', 'Hold a bank card against the screen and match the rectangle'],
    'face-card': ['Face Size', 'Hold the same card flat against your cheek'],
    approach: ['Take Your Seat', 'Sit where you like, measure once, and the camera is calibrated for good'],
    blindspot: ['Viewing Distance', 'Cover your right eye and stare at the white square'],
    manual: ['Calibrate This Camera', 'One measurement, once per machine — every later session reuses it'],
    position: ['Sit At The Target', `Move until you are ${targetDistanceCm} cm from the screen`],
  };
  const [title, subtitle] = TITLES[step];

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
            setStep('face-card');
          }}
        />
      )}

      {step === 'face-card' && (
        <FaceCardStep
          videoRef={videoRef}
          faceWidthNorm={faceWidthNorm}
          onDone={finishFaceCard}
          onSkip={() => finishFaceCard(null)}
        />
      )}

      {step === 'approach' && (
        <ApproachStep
          faceWidthCm={faceWidthCm}
          liveScale={liveScale}
          targetDistanceCm={targetDistanceCm}
          onMeasured={(actualCm) => completeBootstrap(actualCm, 'manual')}
          onUseBlindSpot={() => {
            scaleSamplesRef.current = [];
            setStep('blindspot');
          }}
        />
      )}

      {step === 'blindspot' && pxPerCm != null && (
        <BlindSpotStep
          onDone={finishBlindSpot}
          onMeasuringChange={setMeasuring}
          onFallbackManual={() => {
            scaleSamplesRef.current = [];
            setStep('manual');
          }}
          pxPerCm={pxPerCm}
          targetDistanceCm={targetDistanceCm}
          rejection={rejection}
        />
      )}

      {step === 'manual' && pxPerCm != null && (
        <ManualStep
          onDone={finishManual}
          onUseBlindSpot={() => {
            scaleSamplesRef.current = [];
            setRejection(null);
            setStep('blindspot');
          }}
          targetDistanceCm={targetDistanceCm}
          willBeCached={faceWidthCm != null}
        />
      )}

      {step === 'position' && calibration && (
        <PositionStep
          calibration={calibration}
          focal={focal}
          liveScale={liveScale}
          targetDistanceCm={targetDistanceCm}
          tolerance={distanceTolerance}
          onRemeasureCamera={remeasureCamera}
          onCorrect={correctFromMeasurement}
          onDone={() => onComplete(calibration, faceWidthCm)}
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

// ─── Step 1b: take your seat, and measure once ───────────────────────────────

/**
 * Get roughly to the target before anything absolute is measured.
 *
 * The estimate shown here is knowingly rough — the face width is measured but
 * the camera is not, and across the common webcam range that is about ±22%. It
 * is labelled as approximate for that reason, and the gate around it is loose
 * enough that the uncertainty cannot trap anyone.
 *
 * It earns its place because the measurement that follows is not
 * distance-neutral. The blind-spot layout runs out of travel around 54 cm, so
 * from 65 cm the dot may never reach the blind spot at all; and K inherits the
 * distance it was measured at, then passes that on through the cached focal
 * length to every later participant on this machine.
 */
function ApproachStep({
  faceWidthCm,
  liveScale,
  targetDistanceCm,
  onMeasured,
  onUseBlindSpot,
}: {
  faceWidthCm: number | null;
  liveScale: number | null;
  targetDistanceCm: number;
  /** The measured distance IS the bootstrap — see the note above. */
  onMeasured: (actualCm: number) => void;
  onUseBlindSpot: () => void;
}) {
  const approx = liveScale != null ? approximateDistanceCm(faceWidthCm, liveScale) : NaN;
  const known = Number.isFinite(approx);
  const [text, setText] = useState('');
  const typed = Number(text);
  const valid = Number.isFinite(typed) && typed >= MIN_MANUAL_CM && typed <= MAX_MANUAL_CM;

  return (
    <>
      <div className="relative w-full max-w-3xl h-56 rounded-2xl border-2 border-gray-700 bg-black shadow-2xl flex flex-col items-center justify-center gap-3">
        <p className="text-6xl font-black tabular-nums text-amber-400">
          ≈{known ? approx.toFixed(0) : '—'}
          <span className="text-2xl font-normal text-gray-500 ml-2">cm</span>
        </p>
        <p className="text-gray-500 text-xs max-w-md text-center px-6">
          A guess, not a measurement — this camera has not been calibrated yet, so
          it can be out by a fifth either way.
        </p>
        {known && valid && (
          <p className="text-gray-600 text-xs font-mono">
            guess is {(approx / typed).toFixed(2)}× your real distance
          </p>
        )}
      </div>

      <div className="text-center bg-gray-900 bg-opacity-90 px-6 py-4 rounded-xl border border-gray-800 w-full max-w-lg">
        <p className="text-sm text-gray-300">
          Sit however you like. Measure from your eye to the middle of the screen,
          stay exactly there, and type it in.
        </p>
        <div className="flex items-center justify-center gap-2 mt-3">
          <input
            type="number"
            inputMode="decimal"
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            min={MIN_MANUAL_CM}
            max={MAX_MANUAL_CM}
            className="w-28 bg-gray-900 border-2 border-gray-700 focus:border-cyan-500 outline-none rounded-lg px-2 py-2 text-3xl font-black text-center tabular-nums text-white"
            aria-label="Measured distance in centimetres"
          />
          <span className="text-xl text-gray-500">cm</span>
        </div>
        <button
          type="button"
          disabled={!valid || liveScale == null}
          onClick={() => onMeasured(typed)}
          className="mt-4 px-8 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-30 text-white font-bold uppercase tracking-wider text-sm"
        >
          Use This Measurement
        </button>
        <p className="text-[11px] text-gray-500 mt-3 leading-snug">
          Once per machine. Every later session on this computer reuses it, and
          nobody has to measure anything again.
        </p>
        <button
          type="button"
          onClick={onUseBlindSpot}
          className="mt-3 block mx-auto text-xs text-gray-500 hover:text-gray-300 underline"
        >
          No tape measure — use the blind-spot task instead
        </button>
      </div>
    </>
  );
}

// ─── Step 2: blind spot ──────────────────────────────────────────────────────

/**
 * One trial is a there-and-back pass, not a single sweep.
 *
 * The reason is reaction time. The dot travels 180 px/s, which at a typical
 * 55 px/cm is 3.3 cm/s, and the participant can only press *after* they notice
 * it has gone. At a 300 ms reaction time the dot is already ~1 cm past the true
 * edge of the blind spot, and 1 cm of offset is 4 cm of reported distance —
 * +10% at a 40 cm target, comparable to the entire error budget of the method.
 * The bias is one-directional, so repeating the sweep does not help and taking
 * the median of five identically-biased trials does not either.
 *
 * The classical fix is the method of limits with paired ascending and
 * descending series (Gescheider, Psychophysics: The Fundamentals). Applied here:
 *
 *   sweep-out     dot moves away from fixation; press when it VANISHES.
 *                 Recorded offset is too large by v·RT.
 *   to-reversal   dot keeps going a further ~2° so the turn happens safely
 *                 inside the blind spot rather than on its edge.
 *   sweep-in      dot moves back toward fixation; press when it REAPPEARS.
 *                 Recorded offset is too small by v·RT.
 *
 * The trial is the mean of the two, in which v·RT cancels to first order. It is
 * the same physical boundary — the nasal edge of the optic disc — read from both
 * sides, so averaging is meaningful rather than merely convenient.
 *
 * Turning around just past where the participant said it vanished, rather than
 * at a precomputed offset, is what makes the inward leg safe: the reversal point
 * is guaranteed to be inside *this* participant's blind spot, and no assumption
 * about where their optic disc sits has to hold for the trial to work.
 */
function BlindSpotStep({
  onDone,
  onMeasuringChange,
  onFallbackManual,
  pxPerCm,
  targetDistanceCm,
  rejection,
}: {
  /** Per-trial offsets in px, each already the mean of its outward and inward legs. */
  onDone: (offsetsPx: number[]) => void;
  /** True while a sweep is actually running — gates face-scale sampling upstream. */
  onMeasuringChange: (measuring: boolean) => void;
  onFallbackManual: () => void;
  pxPerCm: number;
  targetDistanceCm: number;
  /** Set when the previous attempt was rejected; explains why before retrying. */
  rejection: string | null;
}) {
  const [running, setRunning] = useState(false);
  const [trial, setTrial] = useState(0);
  const [leg, setLeg] = useState<Phase>('sweep-out');
  /**
   * The first pass is a rehearsal and is thrown away.
   *
   * Almost nobody has knowingly seen their own blind spot, so on the first
   * attempt they are simultaneously learning what "vanishes" feels like and
   * being measured on it. That first trial is reliably the worst one, and it is
   * the one that teaches the participant the task is impossible when it goes
   * wrong. Spending one pass on practice costs about twelve seconds.
   */
  const [practice, setPractice] = useState(true);
  const practiceRef = useRef(true);
  /** Sweeps that ran their whole length with no response. */
  const [misses, setMisses] = useState(0);
  const [dotX, setDotX] = useState(0);
  const [squareX, setSquareX] = useState(0);
  const [reach, setReach] = useState<{ needPx: number; havePx: number } | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const offsetsRef = useRef<number[]>([]);
  const stateRef = useRef({
    x: 0,
    squareX: 0,
    lastT: 0,
    active: false,
    phase: 'sweep-out' as Phase,
    /** Outward-leg offset for the trial in progress. */
    outPx: 0,
    /** x at which the dot turns around, fixed at the moment of the outward press. */
    reverseAt: 0,
  });

  useEffect(() => {
    onMeasuringChange(running);
    return () => onMeasuringChange(false);
  }, [running, onMeasuringChange]);

  /**
   * Where the fixation square has to sit for the blind spot to be reachable.
   *
   * The dot has to travel `d · tan(13.5°)` to the left of the square before it
   * enters the blind spot — 528 px at 40 cm on a typical panel, 792 px at 60 cm.
   * The strip was previously capped at 1024 px with the square centred, leaving
   * 512 px of travel: the dot ran off the end and restarted before it could
   * vanish, which is not something the participant can tell apart from "my blind
   * spot is not there".
   *
   * The paper puts the square at screen centre, which works because the geometry
   * only cares about the *separation* at the moment it disappears, not where the
   * square is. So centre it when that leaves enough room, and slide it right
   * when it does not — the resulting off-axis error stays under 1.5% at every
   * window width and target this flow supports.
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
    const startX = Math.min(w - DOT_PX, sx + APPROACH_PX);
    stateRef.current = {
      x: startX,
      squareX: sx,
      lastT: performance.now(),
      active: true,
      phase: 'sweep-out',
      outPx: 0,
      reverseAt: 0,
    };
    setDotX(startX);
    setLeg('sweep-out');
    return true;
  }, [layoutFor]);

  // Start only once the strip is in the DOM. Calling restartSweep straight from
  // the button handler read a ref that did not exist yet, left the sweep
  // inactive, and parked the dot at x=0 — visibly frozen at the left edge.
  useEffect(() => {
    if (!running) return;
    practiceRef.current = true;
    setPractice(true);
    setMisses(0);
    restartSweep();
  }, [running, restartSweep]);

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    const tick = (t: number) => {
      const s = stateRef.current;
      if (s.active) {
        const dt = (t - s.lastT) / 1000;
        s.lastT = t;
        const step = SWEEP_PX_PER_SEC * dt;

        if (s.phase === 'sweep-in') {
          s.x += step;
          // Back at fixation with no response: the dot never reappeared where
          // the participant could report it, so the pair is unusable. Better to
          // repeat the trial than to keep half of it.
          if (s.x >= s.squareX) {
            setMisses((m) => m + 1);
            restartSweep();
          } else setDotX(s.x);
        } else {
          s.x -= step;
          if (s.x < 0) {
            // Swept the whole strip with no response: sweep again rather than
            // record a position the participant never reacted to. Counting it
            // matters — a silent restart from the far side is indistinguishable
            // from the task being broken, which is exactly how it read.
            setMisses((m) => m + 1);
            restartSweep();
          } else {
            if (s.phase === 'to-reversal' && s.x <= s.reverseAt) {
              s.phase = 'sweep-in';
              setLeg('sweep-in');
            }
            setDotX(s.x);
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, restartSweep]);

  const record = useCallback(() => {
    const s = stateRef.current;
    if (!s.active) return;

    if (s.phase === 'sweep-out') {
      // The blind spot is temporal, which for the fixating left eye is to the
      // *left* of the square. A press while the dot is still approaching from
      // the right cannot be a disappearance — it is a startle, a stray key or
      // someone pressing to see what happens — and accepting it would record an
      // offset on the wrong side of fixation as though it were a measurement.
      if (s.x >= s.squareX) return;
      s.outPx = Math.abs(s.squareX - s.x);
      // Carry on past the reported edge before turning, so the reversal happens
      // inside the blind spot rather than on its boundary — and so the two
      // presses are far enough apart in time that one cannot be mistaken for
      // two. ~2° of visual angle at the target distance.
      const marginPx =
        targetDistanceCm * Math.tan((REVERSAL_MARGIN_DEG * Math.PI) / 180) * pxPerCm;
      s.reverseAt = Math.max(0, s.x - marginPx);
      s.phase = 'to-reversal';
      setLeg('to-reversal');
      return;
    }

    // Ignore presses while the dot is still travelling to the reversal point:
    // the participant has already reported the disappearance and the dot has not
    // reappeared yet, so anything here is a double-tap.
    if (s.phase === 'to-reversal') return;

    const inPx = Math.abs(s.squareX - s.x);

    // The rehearsal proves the participant can do the task; it is not evidence
    // about where their optic disc is, because they were still working out what
    // they were looking for while it ran.
    if (practiceRef.current) {
      practiceRef.current = false;
      setPractice(false);
      setMisses(0);
      restartSweep();
      return;
    }

    // The mean is the whole point: the outward leg overshoots the true edge by
    // the reaction time and the inward leg undershoots it by the same amount.
    offsetsRef.current = [...offsetsRef.current, (s.outPx + inPx) / 2];
    const done = offsetsRef.current.length;
    setTrial(done);
    // A completed pair means they have the task; the earlier warning has served
    // its purpose and leaving it up just nags.
    setMisses(0);
    if (done >= TRIALS) {
      s.active = false;
      const measured = offsetsRef.current;
      offsetsRef.current = [];
      setTrial(0);
      setRunning(false);
      onDone(measured);
    } else {
      restartSweep();
    }
  }, [onDone, restartSweep, pxPerCm, targetDistanceCm]);

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
  //
  // Signed, and floored at zero for display. During the short approach the dot
  // is on the *nasal* side, where its distance from fixation is not progress
  // toward anything; an unsigned value made the bar run backwards to zero and
  // then forwards again, which reads as the task undoing itself.
  const eccentricityDeg = Math.max(
    0,
    (Math.atan((squareX - dotX) / pxPerCm / Math.max(targetDistanceCm, 1)) * 180) / Math.PI,
  );

  const prompt =
    leg === 'sweep-in'
      ? 'Press the moment it COMES BACK'
      : leg === 'to-reversal'
        ? 'Keep staring at the square…'
        : 'Press the moment it VANISHES';

  /** Roughly where the disappearance is due, in cm along the screen. */
  const expectedCm =
    (targetDistanceCm * Math.tan((BLIND_SPOT_ECCENTRICITY_DEG * Math.PI) / 180));

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
            {rejection && (
              <p className="text-amber-400 text-sm mb-3 text-left">
                {rejection} Let&rsquo;s take the measurements again.
              </p>
            )}
            <ol className="text-sm text-gray-300 space-y-1.5 text-left list-decimal list-inside">
              <li>Sit the way you will sit for the test.</li>
              <li>Cover your <strong>right eye</strong> with your hand.</li>
              <li>
                Lock your left eye on the white square and <strong>keep it there</strong>.
                Do not look at the dot — you should only sense it out of the corner
                of your eye.
              </li>
              <li>Press <kbd className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-600 font-mono text-xs">Space</kbd> when the dot <strong>vanishes</strong>.</li>
              <li>It carries on, turns around and comes back. Press again the moment it <strong>reappears</strong>.</li>
            </ol>
            {/* The single most common way this task fails is the participant not
                knowing roughly when to expect anything, deciding nothing is going
                to happen, and watching the dot instead of the square. Naming the
                delay costs nothing — it is a detection task, and knowing that it
                takes a few seconds cannot tell them *where* the edge is. */}
            <p className="text-gray-400 text-xs mt-3 text-left">
              The dot passes the square first and nothing happens for about{' '}
              <strong>{Math.max(1, Math.round(expectedCm * pxPerCm / SWEEP_PX_PER_SEC))} seconds</strong>.
              Your blind spot is roughly {expectedCm.toFixed(0)} cm to the left of the
              square — it will not vanish before that, so keep staring and wait.
            </p>
            <p className="text-gray-500 text-xs mt-2 text-left">
              The first pass is practice and does not count. Then{' '}
              {TRIALS} measurements, two presses each — reading the same edge from
              both directions cancels out how long you take to react.
            </p>
            <button
              type="button"
              onClick={() => setRunning(true)}
              className="mt-4 px-8 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold uppercase tracking-wider text-sm"
            >
              {rejection ? 'Try Again' : 'Start'}
            </button>
          </>
        ) : (
          <>
            {practice && (
              <p className="text-amber-400 text-xs mb-2 uppercase tracking-widest font-bold">
                Practice — this one does not count
              </p>
            )}
            <p className={`text-xl font-bold ${leg === 'sweep-in' ? 'text-green-400' : 'text-white'}`}>
              {prompt}
            </p>
            {/* Current separation in degrees, against the ~13.5° it has to reach.
                Showing the target as well as the current value is what turns
                "nothing is happening" into "it is two thirds of the way there" —
                without it, a dot three seconds from the blind spot and a dot that
                will never get there look exactly the same. */}
            <p className="text-cyan-300 text-sm mt-2 font-mono tabular-nums">
              {practice ? 'practice' : `${trial} / ${TRIALS} measurements`} ·{' '}
              {eccentricityDeg.toFixed(1)}° of ~{BLIND_SPOT_ECCENTRICITY_DEG}°
            </p>
            <div className="relative mx-auto mt-2 h-1 w-3/4 rounded-full bg-gray-800">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-cyan-600 transition-[width] duration-100"
                style={{ width: `${Math.min(100, (eccentricityDeg / BLIND_SPOT_ECCENTRICITY_DEG) * 100)}%` }}
              />
            </div>
            {/* A sweep that ran its whole length is the one outcome the
                participant cannot interpret: the dot silently reappears at the
                other side and the task looks broken. It is almost always the
                same cause, so say so rather than letting them guess. */}
            {misses > 0 && (
              <p className="text-amber-400 text-xs mt-3">
                {misses === 1 ? 'That pass finished without a press.' : `${misses} passes finished without a press.`}{' '}
                The usual cause is your eye following the dot — if it does, the dot
                can never enter your blind spot. Keep your eye locked on the square.
                Also check your right eye is properly covered.
              </p>
            )}
            {reach && reach.havePx < reach.needPx && (
              <p className="text-amber-400 text-xs mt-2">
                This display is too narrow to reach the blind spot at {targetDistanceCm} cm —
                the dot can only get {(reach.havePx / reach.needPx * BLIND_SPOT_ECCENTRICITY_DEG).toFixed(1)}° out.
                Use a wider window, or lower the target distance.
              </p>
            )}
          </>
        )}
        <button
          type="button"
          onClick={onFallbackManual}
          className="mt-4 block mx-auto text-xs text-gray-500 hover:text-gray-300 underline"
        >
          I can&rsquo;t do this task — let me measure with a tape instead
        </button>
      </div>
    </>
  );
}

// ─── Step 2b: measured with a tape ───────────────────────────────────────────

/**
 * The escape hatch the blind-spot task needs.
 *
 * It asks for sustained monocular fixation while judging the disappearance of a
 * peripheral target, and there are participants who cannot do it: one working
 * eye, poor fixation control, a window too narrow to reach 13.5° at the
 * configured target, or simply a task they cannot get the hang of. Without a
 * fallback those sessions either loop forever or proceed on a number nobody
 * checked.
 *
 * A tape measure from the eye to the middle of the screen is, if anything, more
 * accurate than the blind spot — it just cannot be done unsupervised at scale,
 * which is the only reason the blind spot exists. `method: 'manual'` was already
 * in the calibration type; this is the UI that finally produces one.
 */
function ManualStep({
  onDone,
  onUseBlindSpot,
  targetDistanceCm,
  willBeCached,
}: {
  onDone: (distanceCm: number) => void;
  onUseBlindSpot: () => void;
  targetDistanceCm: number;
  /** True when the card step ran, so this measurement becomes a cached focal length. */
  willBeCached: boolean;
}) {
  const [text, setText] = useState(String(targetDistanceCm));
  const value = Number(text);
  const ok = Number.isFinite(value) && value >= MIN_MANUAL_CM && value <= MAX_MANUAL_CM;

  return (
    <>
      <div className="flex flex-col items-center justify-center gap-4 w-full max-w-3xl h-56 rounded-2xl border-2 border-gray-700 bg-black shadow-2xl">
        <p className="text-gray-400 text-sm max-w-md text-center px-6">
          Measure from your eye to the middle of the screen, then sit back exactly
          where you were when you measured and type it in.
        </p>
        {willBeCached && (
          <p className="text-cyan-300 text-xs max-w-md text-center px-6">
            This is the only time this machine needs it. Once measured, the
            camera&rsquo;s optics are known and future participants skip straight
            past this step.
          </p>
        )}
        <div className="flex items-baseline gap-2">
          <input
            type="number"
            inputMode="decimal"
            value={text}
            onChange={(e) => setText(e.target.value)}
            min={MIN_MANUAL_CM}
            max={MAX_MANUAL_CM}
            className="w-32 bg-gray-900 border-2 border-gray-700 focus:border-cyan-500 outline-none rounded-lg px-3 py-2 text-4xl font-black text-center tabular-nums text-white"
            aria-label="Measured distance in centimetres"
          />
          <span className="text-2xl text-gray-500">cm</span>
        </div>
      </div>

      <div className="text-center bg-gray-900 bg-opacity-90 px-6 py-3 rounded-xl border border-gray-800 w-full max-w-lg">
        {!ok && (
          <p className="text-amber-400 text-xs">
            Enter a distance between {MIN_MANUAL_CM} and {MAX_MANUAL_CM} cm.
          </p>
        )}
        <button
          type="button"
          disabled={!ok}
          onClick={() => onDone(value)}
          className="mt-3 px-8 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-30 text-white font-bold uppercase tracking-wider text-sm"
        >
          Continue
        </button>
        <button
          type="button"
          onClick={onUseBlindSpot}
          className="mt-4 block mx-auto text-xs text-gray-500 hover:text-gray-300 underline"
        >
          No tape measure — use the blind-spot task instead
        </button>
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
  focal,
  liveScale,
  targetDistanceCm,
  tolerance,
  onRemeasureCamera,
  onCorrect,
  onDone,
}: {
  calibration: DistanceCalibration;
  focal: CameraFocal | null;
  liveScale: number | null;
  targetDistanceCm: number;
  tolerance: number;
  onRemeasureCamera: () => void;
  /** Re-derive the camera constant from a distance the participant measured. */
  onCorrect?: (actualCm: number) => void;
  onDone: () => void;
}) {
  const [correcting, setCorrecting] = useState(false);
  const [correctionText, setCorrectionText] = useState('');
  const distanceCm = liveScale != null ? distanceFromFace(calibration, liveScale) : NaN;
  // Same tolerance the head-positioning gate uses. Anything looser here is a
  // promise this flow cannot keep, since the anchor is locked against the other
  // gate a moment later.
  const check =
    liveScale != null ? checkDistance(calibration, liveScale, targetDistanceCm, tolerance) : null;
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
        {/* Say which method produced this. A hand-measured distance has no trial
            spread and no eccentricity assumption, and printing "±0.0 · blind spot
            13.5°" against one claimed a precision and a provenance it never had. */}
        <p className="text-cyan-300 text-sm mt-2 font-mono tabular-nums">
          {calibration.method === 'blind-spot'
            ? `blind spot ${BLIND_SPOT_ECCENTRICITY_DEG}° · ${calibration.distanceCm.toFixed(1)}cm ±${(calibration.spreadCm ?? 0).toFixed(1)}`
            : calibration.method === 'camera-focal'
              ? `from this camera's calibration · ${calibration.distanceCm.toFixed(1)}cm`
              : `measured by hand · ${calibration.distanceCm.toFixed(1)}cm`}
          {' · '}
          {calibration.pxPerCm.toFixed(1)} px/cm
        </p>
        {/* Provenance of the cached optics, stated rather than assumed. A stale
            focal length — someone swapped the webcam, or docked the laptop —
            produces confident distances that are all wrong by one factor, and
            the only thing standing between that and a ruined dataset is somebody
            noticing the date. So show the date, and make re-measuring one click. */}
        {focal && (
          <p className="text-gray-500 text-xs mt-2 font-mono">
            camera calibrated {new Date(focal.measuredAt).toLocaleDateString()} by{' '}
            {focal.method === 'manual' ? 'tape' : 'blind spot'} ·{' '}
            {fovDegFromFocal(focal.f).toFixed(0)}° FOV
            <button
              type="button"
              onClick={onRemeasureCamera}
              className="ml-2 underline hover:text-gray-300"
            >
              re-measure
            </button>
          </p>
        )}
        {/* The screen has been showing a number the participant can see is wrong,
            and offering them nothing to do about it but start the whole
            calibration again. One correction closes the loop: they already know
            their real distance, and from it and the face size on screen right
            now the camera constant follows directly.
            
            This is also the only way a stale focal length can be caught. It is
            cached against a key that cannot see whether the camera has started
            re-framing itself, so nothing invalidates it — except somebody
            noticing the reading is wrong, which is exactly what this captures. */}
        {onCorrect && (
          <div className="mt-3">
            {!correcting ? (
              <button
                type="button"
                onClick={() => setCorrecting(true)}
                className="text-xs text-amber-400/80 hover:text-amber-300 underline"
              >
                That&rsquo;s not my actual distance
              </button>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <p className="text-xs text-gray-400">
                  Measure eye to the middle of the screen, stay there, and type it.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    autoFocus
                    value={correctionText}
                    onChange={(e) => setCorrectionText(e.target.value)}
                    className="w-24 bg-gray-900 border-2 border-gray-700 focus:border-amber-500 outline-none rounded-lg px-2 py-1 text-2xl font-black text-center tabular-nums text-white"
                    aria-label="Actual measured distance"
                  />
                  <span className="text-gray-500">cm</span>
                  <button
                    type="button"
                    disabled={!(Number(correctionText) >= 15 && Number(correctionText) <= 120)}
                    onClick={() => {
                      onCorrect(Number(correctionText));
                      setCorrecting(false);
                    }}
                    className="px-4 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-30 text-white font-bold uppercase tracking-wider text-xs"
                  >
                    Fix
                  </button>
                </div>
                {Number.isFinite(distanceCm) && Number(correctionText) > 0 && (
                  <p className="text-[11px] text-gray-500 font-mono">
                    reading is {(distanceCm / Number(correctionText)).toFixed(2)}× your real distance
                  </p>
                )}
              </div>
            )}
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
