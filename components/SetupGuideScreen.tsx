'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import EyeSpinner from './ui/EyeSpinner';

type SetupStep = 'camera' | 'lighting' | 'posture';

type SetupGuideScreenProps = {
  onComplete: () => void;
  onBack: () => void;
  sittingDistanceCm?: number;
};

// ────────────────────────────────────────────────────────────────
// Camera step
// ────────────────────────────────────────────────────────────────
function CameraStep({
  onGranted,
  onDenied,
}: {
  onGranted: () => void;
  onDenied: (reason: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<'idle' | 'requesting' | 'granted' | 'denied'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const requestCamera = useCallback(async () => {
    setStatus('requesting');
    setErrorMsg(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStatus('granted');
      onGranted();
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Camera access was blocked. Please allow camera access in your browser settings and try again.'
          : err instanceof DOMException && err.name === 'NotFoundError'
          ? 'No camera found. Please connect a camera and try again.'
          : 'Could not access camera. Please check your device and try again.';
      setErrorMsg(msg);
      setStatus('denied');
      onDenied(msg);
    }
  }, [onGranted, onDenied]);

  // Stop stream on unmount
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="flex flex-col items-center gap-6">
      {/* Camera icon / preview */}
      <div className="relative w-full max-w-xs aspect-video rounded-2xl overflow-hidden bg-gray-800 border border-gray-700 flex items-center justify-center">
        <video
          ref={videoRef}
          className={`w-full h-full object-cover scale-x-[-1] ${status === 'granted' ? 'block' : 'hidden'}`}
          muted
          playsInline
        />

        {status !== 'granted' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-500 bg-gray-800">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-12 h-12">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
            </svg>
            <span className="text-sm">Camera preview</span>
          </div>
        )}

        {status === 'granted' && (
          <div className="absolute bottom-2 right-2 flex items-center gap-1.5 bg-black/60 rounded-full px-2.5 py-1">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs text-green-300 font-medium">Live</span>
          </div>
        )}
      </div>

      {/* Status message */}
      {status === 'idle' && (
        <p className="text-sm text-gray-400 text-center leading-relaxed max-w-xs">
          We need access to your camera to track your eye movements. Your video is processed
          entirely on-device and is never uploaded.
        </p>
      )}

      {status === 'requesting' && (
        <div className="flex justify-center">
          <EyeSpinner size="md" label="Waiting for camera permission…" />
        </div>
      )}

      {status === 'granted' && (
        <p className="text-sm text-green-400 text-center font-medium">
          ✓ Camera access granted — you're all set!
        </p>
      )}

      {status === 'denied' && errorMsg && (
        <p className="text-sm text-red-400 text-center leading-relaxed max-w-xs bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-3">
          {errorMsg}
        </p>
      )}

      {/* Action button */}
      {status !== 'granted' && (
        <button
          onClick={requestCamera}
          disabled={status === 'requesting'}
          className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/40 text-white text-sm font-semibold transition-colors"
        >
          {status === 'requesting' ? 'Requesting…' : status === 'denied' ? 'Try Again' : 'Allow Camera Access'}
        </button>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Lighting step
// ────────────────────────────────────────────────────────────────
const LIGHTING_TIPS = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
        <circle cx="12" cy="12" r="4" />
        <path strokeLinecap="round" d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    ),
    label: 'Face a window or lamp',
    desc: 'Position a light source in front of you to evenly illuminate your face.',
    good: true,
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    label: 'Avoid backlit windows',
    desc: "Don't sit with a bright window behind you — it creates shadows on your face.",
    good: false,
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    label: 'No harsh overhead light',
    desc: 'Ceiling lights directly above cast shadows over your eyes — reduce or tilt them.',
    good: false,
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    ),
    label: 'Consistent lighting',
    desc: 'Keep your lighting steady — flickering lights or changing conditions affect accuracy.',
    good: true,
  },
];

function LightingStep() {
  return (
    <div className="flex flex-col gap-3 w-full">
      <p className="text-sm text-gray-400 text-center leading-relaxed mb-1">
        Good lighting helps the camera detect your eyes accurately.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {LIGHTING_TIPS.map((tip, i) => (
          <div
            key={i}
            className={`flex items-start gap-3 rounded-xl p-3.5 border ${
              tip.good
                ? 'bg-green-500/5 border-green-500/20'
                : 'bg-red-500/5 border-red-500/20'
            }`}
          >
            <div className={`mt-0.5 shrink-0 ${tip.good ? 'text-green-400' : 'text-red-400'}`}>
              {tip.icon}
            </div>
            <div>
              <p className={`text-sm font-semibold ${tip.good ? 'text-green-300' : 'text-red-300'}`}>
                {tip.label}
              </p>
              <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{tip.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Posture step
// ────────────────────────────────────────────────────────────────
function PostureStep({ distanceCm }: { distanceCm: number }) {
  const tips = [
    {
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M9 6h6M9 12h6M9 18h6M5 6h.01M5 12h.01M5 18h.01" />
        </svg>
      ),
      label: `Sit ~${distanceCm} cm from the screen`,
      desc: `Keep your face about ${distanceCm} cm (arm's length) from the camera for best accuracy.`,
    },
    {
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
      ),
      label: 'Head level and centred',
      desc: 'Your face should be roughly centred in the camera frame — not tilted left, right, or at an angle.',
    },
    {
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      ),
      label: 'Sit upright, relax your shoulders',
      desc: 'Sit in a comfortable, upright position. Avoid slouching or leaning in.',
    },
    {
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
      ),
      label: 'Keep glasses on if you wear them',
      desc: 'If you wear prescription glasses, keep them on throughout the assessment.',
    },
  ];

  return (
    <div className="flex flex-col gap-3 w-full">
      <p className="text-sm text-gray-400 text-center leading-relaxed mb-1">
        A comfortable, stable position improves calibration quality.
      </p>
      <div className="flex flex-col gap-2.5">
        {tips.map((tip, i) => (
          <div
            key={i}
            className="flex items-start gap-3 rounded-xl p-3.5 bg-blue-500/5 border border-blue-500/20"
          >
            <div className="mt-0.5 shrink-0 text-blue-400">{tip.icon}</div>
            <div>
              <p className="text-sm font-semibold text-blue-300">{tip.label}</p>
              <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{tip.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Main SetupGuideScreen
// ────────────────────────────────────────────────────────────────
const STEPS: { id: SetupStep; label: string }[] = [
  { id: 'camera', label: 'Camera' },
  { id: 'lighting', label: 'Lighting' },
  { id: 'posture', label: 'Posture' },
];

export default function SetupGuideScreen({
  onComplete,
  onBack,
  sittingDistanceCm = 60,
}: SetupGuideScreenProps) {
  const [step, setStep] = useState<SetupStep>('camera');
  const [cameraGranted, setCameraGranted] = useState(false);

  const currentIdx = STEPS.findIndex((s) => s.id === step);

  const canProceed = step !== 'camera' || cameraGranted;

  const handleNext = () => {
    if (step === 'camera') setStep('lighting');
    else if (step === 'lighting') setStep('posture');
    else onComplete();
  };

  const handleBack = () => {
    if (step === 'camera') onBack();
    else if (step === 'lighting') setStep('camera');
    else setStep('lighting');
  };

  const stepTitles: Record<SetupStep, string> = {
    camera: 'Camera Access',
    lighting: 'Lighting Check',
    posture: 'Posture & Position',
  };

  const stepDescriptions: Record<SetupStep, string> = {
    camera: 'Allow camera access so we can track your eye movements during the assessment.',
    lighting: 'Good lighting is essential for accurate eye tracking results.',
    posture: 'Position yourself correctly before we begin calibration.',
  };

  return (
    <div className="min-h-screen w-full bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">

        {/* Brand header */}
        <div className="flex items-center gap-3 justify-center mb-8">
          <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
            <svg viewBox="0 0 20 20" fill="none" stroke="white" strokeWidth="1.5" className="w-4.5 h-4.5">
              <circle cx="10" cy="10" r="8" />
              <circle cx="10" cy="10" r="3.5" />
              <circle cx="10" cy="10" r="1" fill="white" stroke="none" />
            </svg>
          </div>
          <span className="text-base font-semibold text-white">Eye Assessment</span>
        </div>

        {/* Step progress dots */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {STEPS.map((s, idx) => (
            <React.Fragment key={s.id}>
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                    idx < currentIdx
                      ? 'bg-blue-600 text-white'
                      : idx === currentIdx
                      ? 'bg-blue-600 text-white ring-2 ring-blue-400/50'
                      : 'bg-gray-800 text-gray-500 border border-gray-700'
                  }`}
                >
                  {idx < currentIdx ? (
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l3 3 7-7" />
                    </svg>
                  ) : (
                    idx + 1
                  )}
                </div>
                <span
                  className={`text-xs font-medium ${
                    idx === currentIdx ? 'text-blue-300' : idx < currentIdx ? 'text-gray-400' : 'text-gray-600'
                  }`}
                >
                  {s.label}
                </span>
              </div>
              {idx < STEPS.length - 1 && (
                <div
                  className={`flex-1 h-px mx-1 mb-5 transition-colors ${
                    idx < currentIdx ? 'bg-blue-600' : 'bg-gray-700'
                  }`}
                />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Card */}
        <div className="bg-gray-800 border border-gray-700 rounded-3xl shadow-2xl overflow-hidden">
          {/* Card header */}
          <div className="px-6 pt-6 pb-4 border-b border-gray-700">
            <h2 className="text-lg font-bold text-white">{stepTitles[step]}</h2>
            <p className="text-sm text-gray-400 mt-1 leading-relaxed">{stepDescriptions[step]}</p>
          </div>

          {/* Card body */}
          <div className="p-6">
            {step === 'camera' && (
              <CameraStep
                onGranted={() => setCameraGranted(true)}
                onDenied={() => setCameraGranted(false)}
              />
            )}
            {step === 'lighting' && <LightingStep />}
            {step === 'posture' && <PostureStep distanceCm={sittingDistanceCm} />}
          </div>

          {/* Card footer — navigation */}
          <div className="px-6 pb-6 flex justify-between items-center gap-3">
            <button
              onClick={handleBack}
              className="px-5 py-2.5 rounded-xl bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium transition-colors"
            >
              Back
            </button>

            <button
              onClick={handleNext}
              disabled={!canProceed}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/30 disabled:text-blue-200/40 text-white text-sm font-semibold transition-colors"
            >
              {step === 'posture' ? "Start Calibration" : "Continue"}
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8h10M9 4l4 4-4 4" />
              </svg>
            </button>
          </div>
        </div>

        {/* Step counter */}
        <p className="text-center text-xs text-gray-600 mt-4">
          Step {currentIdx + 1} of {STEPS.length}
        </p>
      </div>
    </div>
  );
}
