'use client';

/**
 * CameraFeed — clean wrapper around <video> for camera input.
 *
 * Handles camera permission, stream setup, and cleanup.
 * Passes a ref so parent (GazeProvider) can access the element.
 */

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

export interface CameraFeedProps {
  /** Target resolution. Falls back to lower if not available. Default 1280×720. */
  width?: number;
  height?: number;
  /** Called when stream is ready; receives the video element. */
  onReady?: (video: HTMLVideoElement) => void;
  /** Called when camera permission is denied or stream fails. */
  onError?: (err: string) => void;
  className?: string;
  /** Hide the video element visually (still processes frames). Default false. */
  hidden?: boolean;
}

export type CameraFeedHandle = {
  /** The underlying <video> element. */
  video: HTMLVideoElement | null;
  /** Stop all camera tracks and release the stream. */
  stop: () => void;
};

const CameraFeed = forwardRef<CameraFeedHandle, CameraFeedProps>(function CameraFeed(
  { width = 1280, height = 720, onReady, onError, className, hidden = false },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  useImperativeHandle(ref, () => ({
    get video() { return videoRef.current; },
    stop() {
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    },
  }));

  useEffect(() => {
    setStatus('loading');
    let cancelled = false;

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: width },
          height: { ideal: height },
          // Disable auto-zoom / Center Stage on Apple cameras
          advanced: [{ zoom: 1 } as MediaTrackConstraintSet],
        },
        audio: false,
      })
      .then(stream => {
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        video.onloadedmetadata = () => {
          video.play().then(() => {
            setStatus('ready');
            onReady?.(video);
          });
        };
      })
      .catch(err => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setStatus('error');
        onError?.(msg);
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <video
        ref={videoRef}
        playsInline
        muted
        className={className}
        style={hidden ? { position: 'absolute', opacity: 0, pointerEvents: 'none', width: 1, height: 1 } : undefined}
        aria-hidden={hidden}
      />
      {status === 'loading' && !hidden && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 text-white text-sm">
          Requesting camera…
        </div>
      )}
      {status === 'error' && !hidden && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-900/80 text-white text-sm text-center px-4">
          Camera unavailable. Check browser permissions.
        </div>
      )}
    </>
  );
});

export default CameraFeed;
