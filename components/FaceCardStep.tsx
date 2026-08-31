'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  cardLongSidePx,
  faceWidthCmFromCard,
  isPlausibleCardBox,
  isPlausibleFaceWidthCm,
} from '@/lib/positionAnchor';
import { CARD_WIDTH_MM } from '@/lib/screenScale';

/**
 * Physical face width, from a card held flat against the cheek.
 *
 * The card and the face are then the same distance from the camera, so their
 * pixel widths stand in exactly the same ratio as their real widths and the
 * focal length cancels:
 *
 *     W_face = W_card · (w_face / w_card)
 *
 * This is the only measurement in the whole setup that needs no assumption about
 * the camera at all. It is what turns drift readings from ratios into
 * centimetres, and — combined with one absolute distance ever — what lets the
 * camera's focal length be measured once instead of once per participant.
 *
 * Against the cheek, at eye level, specifically. The width being measured is the
 * span between the outer eye corners, so the cancellation above only holds if
 * the card sits at that same depth. The forehead is 1–2 cm forward of it, which
 * is a 2.5–5% error in W_face and therefore in every distance derived from it —
 * and, once F is cached, in every later session on this machine too.
 *
 * The card is located by dragging a box rather than by detecting it. Bank cards
 * are a hostile detection target — holograms, dark cards on dark backgrounds,
 * printed patterns, specular glare — and a detector that fails silently on one
 * in twenty would corrupt those sessions in a way nothing downstream could
 * notice. Dragging takes ten seconds, cannot fail silently, and permits the
 * aspect-ratio check below, which an automatic box would still have needed.
 */

const CARD_WIDTH_CM = CARD_WIDTH_MM / 10;

export interface FaceCardStepProps {
  /** Live camera feed — read once, at the moment of capture. */
  videoRef: React.RefObject<HTMLVideoElement>;
  /** Face width as a fraction of frame width, from the tracking loop. */
  faceWidthNorm: number | null;
  onDone: (faceWidthCm: number) => void;
  onSkip?: () => void;
}

type Point = { x: number; y: number };

export default function FaceCardStep({
  videoRef,
  faceWidthNorm,
  onDone,
  onSkip,
}: FaceCardStepProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [frozen, setFrozen] = useState(false);
  /** Face width in frame fractions, sampled at the instant the frame was taken. */
  const [capturedFaceNorm, setCapturedFaceNorm] = useState<number | null>(null);
  const [start, setStart] = useState<Point | null>(null);
  const [end, setEnd] = useState<Point | null>(null);
  const [dragging, setDragging] = useState(false);

  /**
   * Paint one frame of the camera into the canvas.
   *
   * Mirrored, to match the preview the participant has been looking at all
   * flow. Mirroring is a reflection, so it leaves every width unchanged and the
   * measurement is unaffected.
   */
  const paint = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return false;
    if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
    if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.restore();
    return true;
  }, [videoRef]);

  /**
   * Live preview until the frame is frozen.
   *
   * The setup screen is an opaque overlay, so without this the participant is
   * asked to position a card against their cheek with no way to see whether the
   * card is even in shot. Freezing is then simply this loop stopping — the
   * pixels already on the canvas are the ones that get measured.
   */
  useEffect(() => {
    if (frozen) return;
    let raf = 0;
    const tick = () => {
      paint();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [frozen, paint]);

  const capture = useCallback(() => {
    if (!paint()) return;
    // Pair the frame with the face width from the same instant. Reading it later
    // would measure a face that has since moved, against a card that has not.
    setCapturedFaceNorm(faceWidthNorm);
    setStart(null);
    setEnd(null);
    setFrozen(true);
  }, [paint, faceWidthNorm]);

  const retake = useCallback(() => {
    setFrozen(false);
    setStart(null);
    setEnd(null);
    setCapturedFaceNorm(null);
  }, []);

  // Drag coordinates arrive in CSS pixels but the measurement has to be in the
  // canvas's own pixels, which is where the face width is expressed too.
  const toCanvasPx = useCallback((e: React.PointerEvent): Point | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }, []);

  const boxPx =
    start && end
      ? { w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y) }
      : null;

  const cardPx = boxPx ? cardLongSidePx(boxPx.w, boxPx.h) : 0;
  const facePx =
    capturedFaceNorm != null && canvasRef.current
      ? capturedFaceNorm * canvasRef.current.width
      : 0;
  const faceWidthCm = boxPx ? faceWidthCmFromCard(cardPx, facePx, CARD_WIDTH_CM) : NaN;

  const shapeOk = boxPx ? isPlausibleCardBox(boxPx.w, boxPx.h) : false;
  const valueOk = isPlausibleFaceWidthCm(faceWidthCm);
  const ok = shapeOk && valueOk;

  const problem = !boxPx
    ? null
    : !shapeOk
      ? 'That box is not card-shaped. Draw it tight to the card edges, and keep the card flat to the camera rather than tilted.'
      : !valueOk
        ? `That gives a face ${Number.isFinite(faceWidthCm) ? `${faceWidthCm.toFixed(1)} cm` : 'of unknown size'} wide, which is outside the human range. Check the box is around the card and not something else.`
        : null;

  // Draw the selection over the frozen frame without redrawing the frame itself.
  const overlayRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = overlayRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas || !start || !end) return;
    const rect = canvas.getBoundingClientRect();
    const sx = rect.width / canvas.width;
    const sy = rect.height / canvas.height;
    el.style.left = `${Math.min(start.x, end.x) * sx}px`;
    el.style.top = `${Math.min(start.y, end.y) * sy}px`;
    el.style.width = `${Math.abs(end.x - start.x) * sx}px`;
    el.style.height = `${Math.abs(end.y - start.y) * sy}px`;
  }, [start, end]);

  return (
    <>
      <div className="relative w-full max-w-3xl aspect-video rounded-2xl overflow-hidden border-2 border-gray-700 bg-black shadow-2xl">
        <canvas
          ref={canvasRef}
          className={`w-full h-full object-cover ${frozen ? 'cursor-crosshair' : ''}`}
          onPointerDown={(e) => {
            if (!frozen) return;
            const p = toCanvasPx(e);
            if (!p) return;
            (e.target as Element).setPointerCapture(e.pointerId);
            setStart(p);
            setEnd(p);
            setDragging(true);
          }}
          onPointerMove={(e) => {
            if (!dragging) return;
            const p = toCanvasPx(e);
            if (p) setEnd(p);
          }}
          onPointerUp={() => setDragging(false)}
        />

        {/* Guidance over the live preview rather than instead of it — the whole
            point of showing the feed is that they can check the card is in shot
            and square to the camera before freezing. */}
        {!frozen && (
          <div className="absolute inset-x-0 bottom-0 bg-black/70 px-6 py-3 text-center">
            <p className="text-white text-sm font-bold">Hold the card flat against your cheek</p>
            <p className="text-gray-400 text-xs mt-0.5 max-w-md mx-auto">
              At eye level, beside your eyes, flat of the card toward the camera.
              Not on your forehead — your brow sits forward of your eyes, and that
              alone is a 5% error.
            </p>
          </div>
        )}

        {frozen && start && end && (
          <div
            ref={overlayRef}
            className={`absolute border-2 pointer-events-none ${ok ? 'border-green-400' : 'border-amber-400'}`}
          />
        )}
      </div>

      <div className="text-center bg-gray-900 bg-opacity-90 px-6 py-4 rounded-xl border border-gray-800 w-full max-w-lg">
        {!frozen ? (
          <>
            <p className="text-sm text-gray-300">
              Get into position, then freeze the frame. You will draw a box around
              the card on the still image, so you do not have to hold steady while
              you do it.
            </p>
            <button
              type="button"
              onClick={capture}
              className="mt-4 px-8 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold uppercase tracking-wider text-sm"
            >
              Freeze Frame
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-300">
              Drag a box around the card — tight to its edges.
            </p>
            <p className="text-cyan-300 text-sm mt-2 font-mono tabular-nums">
              {boxPx
                ? `card ${cardPx.toFixed(0)}px · face ${facePx.toFixed(0)}px · ${Number.isFinite(faceWidthCm) ? `${faceWidthCm.toFixed(1)} cm` : '—'}`
                : 'no box drawn yet'}
            </p>
            {problem && <p className="text-amber-400 text-xs mt-2">{problem}</p>}
            <div className="flex items-center justify-center gap-3 mt-4">
              <button
                type="button"
                onClick={retake}
                className="px-5 py-2 rounded-lg border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 text-sm font-bold uppercase tracking-wider"
              >
                Retake
              </button>
              <button
                type="button"
                disabled={!ok}
                onClick={() => onDone(faceWidthCm)}
                className="px-8 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-30 text-white font-bold uppercase tracking-wider text-sm"
              >
                Continue
              </button>
            </div>
          </>
        )}
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="mt-4 block mx-auto text-xs text-gray-500 hover:text-gray-300 underline"
          >
            I don&rsquo;t have a card — skip this
          </button>
        )}
      </div>
    </>
  );
}
