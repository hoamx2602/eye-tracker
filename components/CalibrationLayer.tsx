
import React from 'react';
import { CalibrationPoint, CalibrationPhase, CalibrationMethod } from '../types';

interface CalibrationLayerProps {
  points: CalibrationPoint[];
  currentPointIndex: number;
  isCapturing: boolean;
  phase: CalibrationPhase;
  method: CalibrationMethod;
  progress: number; // 0 to 1
  onPointMouseDown: () => void;
  onPointMouseUp: () => void;
}

const CalibrationLayer: React.FC<CalibrationLayerProps> = ({ 
  points, 
  currentPointIndex, 
  isCapturing, 
  phase, 
  method,
  progress,
  onPointMouseDown,
  onPointMouseUp
}) => {
  // Format phase string for display (e.g., "INITIAL_MAPPING" -> "Mapping")
  const phaseLabel = phase === CalibrationPhase.INITIAL_MAPPING ? "Initial Mapping" : 
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
        let scale = 'scale-100';
        let bgColor = 'bg-red-500';
        let shadow = 'shadow-[0_0_10px_rgba(255,0,0,0.5)]';

        if (method === CalibrationMethod.TIMER) {
            if (isCapturing) {
                scale = 'scale-125';
                bgColor = 'bg-red-600';
                shadow = 'shadow-[0_0_25px_rgba(255,0,0,1)]';
            }
        } else {
             // Click & Hold Visuals
             bgColor = 'bg-red-500'; // Default base
             if (progress > 0) {
                 scale = `scale-${100 + (progress * 25)}`; // Grow slightly
                 shadow = `shadow-[0_0_25px_${getProgressColor()}]`;
             }
        }

        const dynamicStyle = method === CalibrationMethod.CLICK_HOLD && progress > 0
            ? { backgroundColor: getProgressColor() } 
            : {};

        return (
          <div
            key={point.id}
            onMouseDown={onPointMouseDown}
            onMouseUp={onPointMouseUp}
            onMouseLeave={onPointMouseUp} // Handle dragging out
            className={`absolute w-8 h-8 rounded-full flex items-center justify-center transition-all duration-75 ease-linear
              ${scale} ${bgColor} ${shadow}
            `}
            style={{
              left: `${point.x}%`,
              top: `${point.y}%`,
              transform: 'translate(-50%, -50%)',
              border: '4px solid white',
              ...dynamicStyle
            }}
          >
            {/* Inner pupil dot */}
            <div className="w-1.5 h-1.5 bg-black rounded-full pointer-events-none"></div>
            
            {/* Timer Loading Ring */}
            {method === CalibrationMethod.TIMER && isCapturing && (
              <div className="absolute inset-0 border-2 border-white rounded-full animate-ping opacity-75 pointer-events-none"></div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default CalibrationLayer;
