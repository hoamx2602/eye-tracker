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
   * Allowed in-plane drift, in face widths. An adult face is ~15 cm across, so
   * 0.2 is about 3 cm — roughly where parallax starts to matter at 40 cm.
   */
  driftFaceWidths: number;
  /** Allowed head rotation change, degrees. */
  rotationDeg: number;
}

export const DEFAULT_ANCHOR_TOLERANCE: AnchorTolerance = {
  depthPct: 8,
  driftFaceWidths: 0.2,
  rotationDeg: 10,
};

/** Typical adult bizygomatic width, used only to phrase drift in cm when unmeasured. */
export const NOMINAL_FACE_WIDTH_CM = 15;

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
 * Depth is checked first and rotation last, deliberately: depth drift breaks the
 * mapping most and is the least obvious to the participant, whereas a head that
 * has merely turned is often about to turn back on its own.
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

  const depthLimit = tol.depthPct / 100;
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

  const rot = Math.max(Math.abs(dev.yawDeg), Math.abs(dev.pitchDeg), Math.abs(dev.rollDeg));
  if (rot > tol.rotationDeg) {
    return { fault: 'turned', ok: false, message: 'Face the Screen', deviation: dev };
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

/** Sanity band for a measured face width — bizygomatic width across adults and children. */
export function isPlausibleFaceWidthCm(cm: number): boolean {
  return Number.isFinite(cm) && cm >= 10 && cm <= 20;
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
