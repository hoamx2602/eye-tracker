import React from 'react';
import { CalibrationPoint, CalibrationPhase } from '../types';

interface CalibrationLayerProps {
  points: CalibrationPoint[];
  currentPointIndex: number;
  isCapturing: boolean;
  phase: CalibrationPhase;
}

const CalibrationLayer: React.FC<CalibrationLayerProps> = ({ points, currentPointIndex, isCapturing, phase }) => {
  // Format phase string for display (e.g., "INITIAL_MAPPING" -> "Mapping")
  const phaseLabel = phase === CalibrationPhase.INITIAL_MAPPING ? "Initial Mapping" : 
                     phase === CalibrationPhase.FINE_TUNING ? "Fine Tuning" : 
                     "Validation";

  return (
    <div className="absolute inset-0 z-50 bg-black bg-opacity-95 flex items-center justify-center cursor-none">
      <div className="absolute top-10 left-0 right-0 text-center text-gray-400 font-mono pointer-events-none select-none">
        <h2 className="text-xl font-bold mb-2">Calibration Mode</h2>
        <p className="text-sm text-blue-400 font-bold uppercase tracking-widest mb-2">{phaseLabel}</p>
        <p className="text-sm">Stare at the red dot. Do not move your head.</p>
        <p className="text-xs mt-1 opacity-70">Progress: {currentPointIndex + 1} / {points.length}</p>
      </div>

      {points.map((point, idx) => {
        // Only show current point
        if (idx !== currentPointIndex) return null;

        return (
          <div
            key={point.id}
            className={`absolute w-8 h-8 rounded-full flex items-center justify-center transition-transform duration-300
              ${isCapturing ? 'scale-125 bg-red-600 shadow-[0_0_25px_rgba(255,0,0,1)]' : 'scale-100 bg-red-500 shadow-[0_0_10px_rgba(255,0,0,0.5)]'}
            `}
            style={{
              left: `${point.x}%`,
              top: `${point.y}%`,
              transform: 'translate(-50%, -50%)',
              border: '4px solid white'
            }}
          >
            {/* Inner pupil dot */}
            <div className="w-1.5 h-1.5 bg-black rounded-full"></div>
            
            {/* Loading Ring Effect when capturing */}
            {isCapturing && (
              <div className="absolute inset-0 border-2 border-white rounded-full animate-ping opacity-75"></div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default CalibrationLayer;