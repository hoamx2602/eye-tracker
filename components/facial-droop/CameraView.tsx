'use client';

import React, { useEffect, useRef } from 'react';

interface CameraViewProps {
  stream: MediaStream | null;
  /** Vertical space (CSS length) the rest of the screen needs; the 16:9 view fits in what is left. */
  reserve: string;
  children?: React.ReactNode;
}

/**
 * The live camera, as large as the viewport allows at 16:9, centred.
 *
 * Mirrored like a selfie camera, which is what people expect to see. The
 * mirror is CSS on this element only: MediaRecorder records the raw stream,
 * so the saved video - and the analysis, which names facial sides from the
 * subject's anatomy - is unaffected.
 */
export default function CameraView({ stream, reserve, children }: CameraViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || video.srcObject === stream) return;
    video.srcObject = stream;
    // autoPlay is not enough everywhere (Safari) once srcObject is set after mount.
    if (stream) void video.play().catch(() => undefined);
  }, [stream]);

  return (
    <div
      className="relative mx-auto aspect-video overflow-hidden rounded-2xl border border-gray-800 bg-black shadow-2xl shadow-black/40"
      style={{ width: `min(100%, calc((100dvh - ${reserve}) * 16 / 9))` }}
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="h-full w-full object-cover"
        style={{ transform: 'scaleX(-1)' }}
        aria-label="Camera preview"
      />
      {children}
    </div>
  );
}
