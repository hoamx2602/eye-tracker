
import React from 'react';
import { CalibrationPoint, CalibrationPhase, CalibrationMethod } from '../types';
import { useVoiceRepeat } from '@/lib/voice/VoiceProvider';

/** How often the short spoken reminder repeats while dots are being shown. */
const VOICE_CUE_INTERVAL_MS = 25000;

/**
 * Timer-mode dot: appears large and shrinks to a small point.
 *
 * A change in size pulls the eye to the dot without any instruction, and as
 * it contracts the eye is drawn to its centre — the spot the dot's screen
 * coordinates actually label. A static 32 px dot lets the eye land anywhere on
 * it. The shrink (DOT_SHRINK_MS) also covers the saccade and settling time, so
 * by the time the gaze-contingent collector (lib/fixationSampling) accepts
 * frames the dot is already small. Same idea as the iOS / Tobii calibration dot.
 */
const DOT_START_PX = 44;
const DOT_END_SCALE = 0.32; // ≈ 14 px
const DOT_SHRINK_MS = 700;

interface CalibrationLayerProps {
  points: CalibrationPoint[];
  currentPointIndex: number;
  isCapturing: boolean;
  phase: CalibrationPhase;
  method: CalibrationMethod;
  progress: number; // 0 to 1
  onPointMouseDown: () => void;
  onPointMouseUp: () => void;
  /**
   * Silences this screen's cue while something is layered over it.
   *
   * The break screen appears on top without unmounting this one, so without
   * the flag the calibration cue carries on firing underneath and talks over
   * the break's own guidance.
   */
  voicePaused?: boolean;
}

const CalibrationLayer: React.FC<CalibrationLayerProps> = ({ 
  points, 
  currentPointIndex, 
  isCapturing, 
  phase, 
  method,
  progress,
  onPointMouseDown,
  onPointMouseUp,
  voicePaused = false,
}) => {
  // Format phase string for display (e.g., "INITIAL_MAPPING" -> "Mapping")
  const phaseLabel = phase === CalibrationPhase.INITIAL_MAPPING ? "Initial Mapping" : 
                     phase === CalibrationPhase.EXERCISES ? "Eye Exercises" :
                     phase === CalibrationPhase.FINE_TUNING ? "Fine Tuning" : 
                     "Validation";
  
  const instruction = method === CalibrationMethod.TIMER 
    ? "Stare at the red dot. Do not move your head." 
    : "Click and HOLD the dot until it turns green.";

  // Function to interpolate color from Red to Green based on progress
  const getProgressColor = () => {
    // Red: 239, 68, 68
    // Green: 34, 197, 94
    const r = Math.round(239 + (34 - 239) * progress);
    const g = Math.round(68 + (197 - 68) * progress);
    const b = Math.round(68 + (94 - 68) * progress);
    return `rgb(${r}, ${g}, ${b})`;
  };

  const cursorClass = method === CalibrationMethod.CLICK_HOLD ? 'cursor-pointer' : 'cursor-none';

  // Dots are already appearing, so the voice says what to do with them and
  // keeps saying it — not why calibration exists, which was covered on the
  // overview screen and is no use to someone mid-task.
  //
  // No replay button here: this screen is a task, and the only thing on it a
  // participant should be looking at is the dot. The full explanation was
  // given on the screen before, and the cue below repeats the instruction.
  const voiceKey = phase === CalibrationPhase.VALIDATION ? 'calib.validation' : 'calib.intro';
  useVoiceRepeat(voiceKey, VOICE_CUE_INTERVAL_MS, !voicePaused, { immediate: true });

  return (
    <div className={`absolute inset-0 z-50 bg-black bg-opacity-95 flex items-center justify-center ${cursorClass}`}>
      <div className="absolute top-10 left-0 right-0 text-center text-gray-400 font-mono pointer-events-none select-none">
        <h2 className="text-xl font-bold mb-2">Calibration Mode</h2>
        <p className="text-sm text-blue-400 font-bold uppercase tracking-widest mb-2">{phaseLabel}</p>
        <p className="text-sm">{instruction}</p>
        <p className="text-xs mt-1 opacity-70">Progress: {currentPointIndex + 1} / {points.length}</p>
      </div>

      {points.map((point, idx) => {
        // Only show current point
        if (idx !== currentPointIndex) return null;

        // Visual State Logic
        let bgColor = 'bg-red-500';
        let shadow = 'shadow-[0_0_10px_rgba(255,0,0,0.5)]';

        if (method === CalibrationMethod.TIMER) {
            // No expanding ring while capturing: it pulled attention outwards
            // exactly when the gaze has to stay on the centre.
            if (isCapturing) {
                bgColor = 'bg-red-600';
                shadow = 'shadow-[0_0_12px_rgba(255,0,0,0.9)]';
            }
            return (
              <div
                // Keyed on the presentation, so a re-queued dot shrinks again.
                key={`${point.id}-${currentPointIndex}`}
                className={`absolute rounded-full flex items-center justify-center pointer-events-none ${bgColor} ${shadow}`}
                style={{
                  left: `${point.x}%`,
                  top: `${point.y}%`,
                  width: DOT_START_PX,
                  height: DOT_START_PX,
                  border: '4px solid white',
                  transform: `translate(-50%, -50%) scale(${DOT_END_SCALE})`,
                  animation: `calib-dot-shrink ${DOT_SHRINK_MS}ms cubic-bezier(0.2, 0.7, 0.3, 1) both`,
                  ['--calib-dot-end' as string]: DOT_END_SCALE,
                }}
              >
                {/* Inner pupil dot — the point the eye should end on */}
                <div className="w-2 h-2 bg-black rounded-full"></div>
              </div>
            );
        }

        // Click & Hold: grows slightly and turns green as the hold completes.
        // (Scale is inline: a Tailwind class built at runtime is never generated.)
        const holdScale = 1 + progress * 0.25;
        const dynamicStyle = progress > 0
            ? { backgroundColor: getProgressColor(), boxShadow: `0 0 25px ${getProgressColor()}` }
            : {};

        return (
          <div
            key={point.id}
            onMouseDown={onPointMouseDown}
            onMouseUp={onPointMouseUp}
            onMouseLeave={onPointMouseUp} // Handle dragging out
            className={`absolute w-8 h-8 rounded-full flex items-center justify-center transition-all duration-75 ease-linear
              ${bgColor} ${shadow}
            `}
            style={{
              left: `${point.x}%`,
              top: `${point.y}%`,
              transform: `translate(-50%, -50%) scale(${holdScale})`,
              border: '4px solid white',
              ...dynamicStyle
            }}
          >
            {/* Inner pupil dot */}
            <div className="w-1.5 h-1.5 bg-black rounded-full pointer-events-none"></div>
          </div>
        );
      })}
    </div>
  );
};

export default CalibrationLayer;
