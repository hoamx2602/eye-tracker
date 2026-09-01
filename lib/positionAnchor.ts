/**
 * Position anchor — lock where the participant was when the session was set up,
 * and stop the test when they leave it.
 *
 * What actually corrupts a gaze mapping is not being at some absolute distance;
 * it is *moving away from where calibration happened*. The mapping bakes in the
 * head position it was fitted at, so every centimetre of drift is roughly a
 * centimetre of screen error. That makes displacement from an anchor the right
 * thing to police, and it is a far easier quantity to measure than absolute
 * position:
 *
 *   Lateral and vertical drift are **exact in centimetres** whenever the
 *   physical face width is known, because a known-size object in the same plane
 *   as the movement cancels the camera's focal length out of the ratio. No field
 *   of view assumption survives into the answer.
 *
 *   Depth drift is **exact as a ratio** — w_anchor / w_live — with no
 *   assumptions at all. Converting that ratio to centimetres is the only step
 *   that needs an absolute distance, and the gate does not need it: a ±8% depth
 *   band means the same thing whether the participant was set up at 30 cm or 60.
 *
 * This is why the check below is expressed in ratios and face-width units
 * internally and only rendered as centimetres when the numbers are genuinely
 * available. The alternative — the hand-tuned normalised face-width band this
 * replaces — silently assumed a camera field of view, an average face size, and
 * a head that never turns.
 */

/** Landmark-derived signature of where the head is. All normalised to frame width. */
export interface HeadSignature {
  /** Rotation-corrected face width, fraction of frame width. */
  faceScale: number;
  /** Face centre, normalised frame coordinates (0–1). */
  cx: number;
  cy: number;
  /** Head orientation, radians. */
  yaw: number;
  pitch: number;
  roll: number;
}

export interface PositionAnchor extends HeadSignature {
  /**
   * Physical face width in cm, from the card-at-face step. When present,
   * lateral and vertical drift come out in exact centimetres.
   */
  faceWidthCm?: number;
  /** Absolute distance at setup, when it was measured rather than assumed. */
  distanceCm?: number;
  distanceSource?: 'blind-spot' | 'manual' | 'assumed' | 'camera-focal';
  capturedAt: string;
}

export interface PositionDeviation {
  /** >1 = further away than at setup. Exact; no camera assumptions. */
  depthRatio: number;
  /** Depth change in cm — null unless the anchor carries an absolute distance. */
  depthCm: number | null;
  /** In-plane drift in units of the participant's own face width. Always exact. */
  lateralFaceWidths: number;
  verticalFaceWidths: number;
  /** The same drift in cm — null until the card-at-face step has run. */
  lateralCm: number | null;
  verticalCm: number | null;
  /** Head rotation change since setup, degrees. */
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
}

export interface AnchorTolerance {
  /** Allowed depth change, percent of the setup distance. */
  depthPct: number;
  /**
   * Floor on the depth allowance in centimetres, whichever is larger.
   *
   * The percentage alone shrinks as the participant sits closer: 8% is 4.4 cm at
   * 55 cm but only 2.4 cm at 30 cm. Postural sway does not shrink to match — it
   * is 2–3 cm peak in young adults and 3–4 cm in older ones — so a purely
   * proportional band becomes unsatisfiable at exactly the distances the flow
   * now asks for, for exactly the participants least able to hold still.
   */
  depthFloorCm: number;
  /**
   * Allowed in-plane drift, in face widths — where a "face width" is the outer
   * canthal distance, about 9 cm in adults. 0.31 is therefore about 2.8 cm,
   * roughly where parallax starts to matter at 40 cm.
   */
  driftFaceWidths: number;
  /**
   * Allowed head rotation change, degrees, per axis.
   *
   * One number for all three was wrong, because the three do not cost the same.
   *
   *   yaw    the far eye foreshortens and eventually occludes, and the iris
   *          ellipse compresses horizontally. Information is genuinely lost.
   *
   *   pitch  the upper lid covers more or less of the iris, which drags the
   *          fitted iris centre vertically — the fastest-changing of the three.
   *          Its estimator is also the least trustworthy: faceCenterY comes from
   *          HEAD_TOP, which sits on the hairline and moves with hair.
   *
   *   roll   purely in-plane. Nothing is occluded and nothing is foreshortened;
   *          the iris-offset vector simply rotates in image coordinates, and the
   *          regressor carries a roll feature to absorb it. Its estimator is the
   *          soundest of the three, being an atan2 on two well-separated points.
   *
   * So roll gets far more room than the other two. Policing a head tilt as
   * harshly as a head turn rejects participants for the one movement that costs
   * almost nothing.
   *
   * Constant per-person bias in these estimates does not matter here: the check
   * is live-against-anchor, so a deviated septum or an asymmetric hairline
   * cancels. Only noise and scale error survive, which is why the two heuristic
   * axes are not given the tightest bounds.
   */
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
}

export const DEFAULT_ANCHOR_TOLERANCE: AnchorTolerance = {
  depthPct: 8,
  depthFloorCm: 3,
  // 0.31, not the 0.2 it was, and this is not a loosening.
  //
  // The unit changed underneath it. Drift is expressed in face widths, and the
  // face width moved from the silhouette (~14 cm) to the outer canthal distance
  // (~9 cm) when the distance model stopped using a measurement that grows when
  // the head turns. Left at 0.2 the same number would have meant 1.8 cm instead
  // of 2.8 — a 36% tightening nobody asked for, arriving silently as a side
  // effect of an unrelated fix.
  //
  // 0.2 × 14.2 = 2.84 cm. 0.31 × 9.1 = 2.84 cm. The physical tolerance is
  // exactly what it was.
  driftFaceWidths: 0.31,
  // These are in ESTIMATOR degrees, not anatomical ones, and the two are not
  // the same number.
  //
  // calculateGeometricHeadPose reads yaw from how far the nose sits off the
  // line between the face-edge landmarks, scaled by 2π. Those landmarks sit on
  // the sides of the head, several centimetres behind the nose tip, so the
  // ratio is large and the estimate over-reads: a simulated 10° head turn comes
  // out as 26°, a factor of about 2.6. A "12°" gate was therefore stopping
  // people at roughly 4.6° of real rotation — which is about as still as a
  // person can be asked to sit.
  //
  // The scale is deliberately NOT corrected inside the estimator. It feeds the
  // regression feature vector as well as this check, the true factor depends on
  // how far an individual's nose protrudes past their own cheekbones, and the
  // pose telemetry now printing to the console will measure it better than any
  // anthropometric table. So the estimator keeps its units and the thresholds
  // are stated in them.
  //
  // Real degrees now, not estimator units.
  //
  // These used to be stated in the geometric heuristic's own scale because that
  // scale was wrong by a per-person factor — 2.6× in simulation, nearly 4× for
  // one participant, whose 12° head turn was reported as 49°. A threshold in
  // units that mean a different thing for every face cannot be set correctly for
  // anyone.
  //
  // eyeTrackingService.headPose now reads MediaPipe's transformation matrix,
  // which the landmarker has always been producing, so these are degrees of
  // actual head rotation. Twenty of them is a deliberate glance away, not a
  // shift in the chair.
  //
  // They can also afford to be generous because rotation no longer corrupts
  // anything else: the cos(yaw) correction is gone from faceScale, and rotation
  // is judged before depth, so a turn that slips past here cannot resurface as a
  // bogus distance instruction.
  yawDeg: 20,
  pitchDeg: 20,
  rollDeg: 25,
};

/**
 * Typical adult outer canthal distance, used only to phrase drift in cm when it
 * was never measured. Matches the segment `faceScale` is built on.
 */
export const NOMINAL_FACE_WIDTH_CM = 9;

export function captureAnchor(
  sig: HeadSignature,
  extra: Pick<PositionAnchor, 'faceWidthCm' | 'distanceCm' | 'distanceSource'> = {},
): PositionAnchor {
  return { ...sig, ...extra, capturedAt: new Date().toISOString() };
}

export function deviationFrom(anchor: PositionAnchor, live: HeadSignature): PositionDeviation {
  // Depth from the apparent-size ratio: a face half as wide is twice as far.
  const depthRatio = live.faceScale > 0 ? anchor.faceScale / live.faceScale : NaN;
  const depthCm =
    anchor.distanceCm != null && Number.isFinite(depthRatio)
      ? anchor.distanceCm * (depthRatio - 1)
      : null;

  // In-plane drift, measured in face widths: the face itself is the ruler, which
  // is what makes this independent of the camera. Using the *live* width means
  // the reading stays correct even if the participant has also changed depth.
  const ruler = live.faceScale > 0 ? live.faceScale : anchor.faceScale;
  const lateralFaceWidths = ruler > 0 ? (live.cx - anchor.cx) / ruler : NaN;
  const verticalFaceWidths = ruler > 0 ? (live.cy - anchor.cy) / ruler : NaN;

  const cmPerFaceWidth = anchor.faceWidthCm ?? null;
  return {
    depthRatio,
    depthCm,
    lateralFaceWidths,
    verticalFaceWidths,
    lateralCm: cmPerFaceWidth != null ? lateralFaceWidths * cmPerFaceWidth : null,
    verticalCm: cmPerFaceWidth != null ? verticalFaceWidths * cmPerFaceWidth : null,
    yawDeg: toDeg(live.yaw - anchor.yaw),
    pitchDeg: toDeg(live.pitch - anchor.pitch),
    rollDeg: toDeg(live.roll - anchor.roll),
  };
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export type AnchorFault =
  | 'ok'
  | 'too-close'
  | 'too-far'
  | 'moved-left'
  | 'moved-right'
  | 'moved-up'
  | 'moved-down'
  | 'turned'
  | 'unknown';

export interface AnchorCheck {
  fault: AnchorFault;
  ok: boolean;
  /** Instruction that undoes the fault, phrased from the participant's side. */
  message: string;
  deviation: PositionDeviation;
}

/**
 * Compare the live head against the anchor.
 *
 * Rotation is checked FIRST, and this order matters more than it looks.
 *
 * It used to be last, on the reasoning that depth drift breaks the mapping most.
 * But a turned head foreshortens the measured face width, so it *also* changes
 * the depth reading — which meant a participant who glanced sideways was told
 * "Move Back (10cm)". They were being handed a distance instruction for a
 * rotation, and following it made things worse.
 *
 * A turned head corrupts the depth measurement, so depth is not worth judging
 * until rotation is known to be within bounds. Report the cause, not the
 * symptom.
 */
export function checkAnchor(
  anchor: PositionAnchor | null,
  live: HeadSignature | null,
  tol: AnchorTolerance = DEFAULT_ANCHOR_TOLERANCE,
): AnchorCheck {
  const empty: PositionDeviation = {
    depthRatio: NaN, depthCm: null,
    lateralFaceWidths: NaN, verticalFaceWidths: NaN,
    lateralCm: null, verticalCm: null,
    yawDeg: NaN, pitchDeg: NaN, rollDeg: NaN,
  };
  if (!anchor || !live) {
    return { fault: 'unknown', ok: false, message: 'No Face Detected', deviation: empty };
  }

  const dev = deviationFrom(anchor, live);
  if (!Number.isFinite(dev.depthRatio)) {
    return { fault: 'unknown', ok: false, message: 'No Face Detected', deviation: dev };
  }

  // Per axis, and named. "Face the Screen" against a max over three axes told
  // the participant neither which way they had moved nor by how much, so a head
  // tilt and a head turn produced the same unactionable instruction.
  if (Math.abs(dev.yawDeg) > tol.yawDeg) {
    return {
      fault: 'turned',
      ok: false,
      message: dev.yawDeg > 0 ? 'Turn Back To The Left' : 'Turn Back To The Right',
      deviation: dev,
    };
  }
  if (Math.abs(dev.pitchDeg) > tol.pitchDeg) {
    return {
      fault: 'turned',
      ok: false,
      message: dev.pitchDeg > 0 ? 'Lift Your Chin' : 'Lower Your Chin',
      deviation: dev,
    };
  }
  if (Math.abs(dev.rollDeg) > tol.rollDeg) {
    return { fault: 'turned', ok: false, message: 'Straighten Your Head', deviation: dev };
  }


  // Percentage or floor, whichever is more forgiving. Below about 38 cm the
  // floor takes over, which is where a proportional band would otherwise fall
  // under the participant's own postural sway.
  const pctLimit = tol.depthPct / 100;
  const floorLimit =
    anchor.distanceCm && anchor.distanceCm > 0 ? tol.depthFloorCm / anchor.distanceCm : 0;
  const depthLimit = Math.max(pctLimit, floorLimit);
  if (dev.depthRatio > 1 + depthLimit) {
    return { fault: 'too-far', ok: false, message: withCm('Move Closer', dev.depthCm), deviation: dev };
  }
  if (dev.depthRatio < 1 - depthLimit) {
    return { fault: 'too-close', ok: false, message: withCm('Move Back', dev.depthCm), deviation: dev };
  }

  // The preview is mirrored, so a face drifting toward larger x has moved to the
  // participant's own left and must be told to move right.
  if (Math.abs(dev.lateralFaceWidths) > tol.driftFaceWidths) {
    const drift = dev.lateralCm ?? dev.lateralFaceWidths * NOMINAL_FACE_WIDTH_CM;
    return dev.lateralFaceWidths > 0
      ? { fault: 'moved-left', ok: false, message: withCm('Move Right', drift), deviation: dev }
      : { fault: 'moved-right', ok: false, message: withCm('Move Left', drift), deviation: dev };
  }
  if (Math.abs(dev.verticalFaceWidths) > tol.driftFaceWidths) {
    const drift = dev.verticalCm ?? dev.verticalFaceWidths * NOMINAL_FACE_WIDTH_CM;
    return dev.verticalFaceWidths > 0
      ? { fault: 'moved-down', ok: false, message: withCm('Sit Up', drift), deviation: dev }
      : { fault: 'moved-up', ok: false, message: withCm('Lower Your Head', drift), deviation: dev };
  }

  return { fault: 'ok', ok: true, message: 'Perfect! Hold Steady...', deviation: dev };
}

function withCm(instruction: string, cm: number | null): string {
  if (cm == null || !Number.isFinite(cm)) return instruction;
  return `${instruction} (${Math.abs(cm).toFixed(0)}cm)`;
}

// ─── Face width from the card ────────────────────────────────────────────────

/**
 * Physical face width from a card held in the plane of the face.
 *
 * Both the card and the face are the same distance from the camera, so their
 * pixel widths are in exactly the same proportion as their real widths, and the
 * focal length cancels. This is the one measurement that needs no assumption
 * about the camera at all — and it is what turns every later drift reading from
 * a ratio into centimetres.
 */
export function faceWidthCmFromCard(
  cardPxWidth: number,
  facePxWidth: number,
  cardWidthCm: number,
): number {
  if (!(cardPxWidth > 0) || !(facePxWidth > 0)) return NaN;
  return cardWidthCm * (facePxWidth / cardPxWidth);
}

/**
 * Sanity band for the measured facial width.
 *
 * The quantity is the **outer canthal distance** — corner of one eye to corner
 * of the other — not the bizygomatic width it used to be. That changed when the
 * distance model moved off the face silhouette, which is not a rigid segment and
 * grows rather than foreshortens when the head turns. Roughly 90 mm in adults,
 * 83–98 mm across the adult range, about 75 mm in young children.
 *
 * The band was 6–13 cm, which is not a sanity check: it is wider than any human
 * head and accepts a reading 30% wrong without a word. That error is not
 * hypothetical. The card is measured against the *outer eye corners*, which sit
 * back inside the orbit, so a card held forward of that plane makes the face
 * read narrow — and every distance the session reports afterwards read long — by
 * exactly the fraction the card was out of place.
 *
 * 7.5–11 cm spans young children through large adults and nothing else. It
 * catches a card held grossly out of plane, which at a 40 cm working distance
 * means about 11 cm forward or more. It cannot catch a subtler misplacement, and
 * no band on a single number can: 7 cm of error still lands inside the range of
 * real human faces. That is a limit of checking one measurement against a
 * population, not something a tighter band would fix.
 */
export function isPlausibleFaceWidthCm(cm: number): boolean {
  return Number.isFinite(cm) && cm >= 7.5 && cm <= 11;
}

/**
 * Is this box actually a card, seen square-on?
 *
 * An ID-1 card is 85.60 × 53.98 mm, so its long side is 1.586 times its short
 * one whichever way up it is held. A box whose sides do not agree with that has
 * either been drawn badly or is around a card tilted out of the frontoparallel
 * plane — and a tilted card reads narrow, which inflates the face width and
 * every distance derived from it, silently and in one direction.
 *
 * The default tolerance admits about 30° of tilt about the long axis. Tighter
 * would start rejecting honest attempts; looser stops catching the thing that
 * matters.
 */
export const CARD_LONG_OVER_SHORT = 85.6 / 53.98;

export function isPlausibleCardBox(
  widthPx: number,
  heightPx: number,
  tolerance = 0.25,
): boolean {
  const long = Math.max(widthPx, heightPx);
  const short = Math.min(widthPx, heightPx);
  if (!(short > 0) || !(long > 0)) return false;
  return Math.abs(long / short - CARD_LONG_OVER_SHORT) <= tolerance;
}

/** The card's long side in px, whichever orientation it was held in. */
export function cardLongSidePx(widthPx: number, heightPx: number): number {
  return Math.max(widthPx, heightPx);
}
