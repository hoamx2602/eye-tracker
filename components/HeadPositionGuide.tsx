import React from 'react';
import { HeadValidationResult } from '../services/eyeTrackingService';

interface HeadPositionGuideProps {
  validation: HeadValidationResult | null;
  countdown: number | null;
}

const HeadPositionGuide: React.FC<HeadPositionGuideProps> = ({ validation, countdown }) => {
  const isValid = validation?.valid;
  const message = validation?.message || "Looking for face...";
  
  // Dynamic color based on validity
  const colorClass = isValid ? 'border-green-500 shadow-[0_0_50px_rgba(34,197,94,0.6)]' : 'border-red-500 shadow-[0_0_50px_rgba(239,68,68,0.6)]';
  const textClass = isValid ? 'text-green-400' : 'text-red-400';

  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center pointer-events-none">
      
      {/* The Guide Frame */}
      {/* Increased size to 50vw/60vh to visually contain a properly sized face (closest distance) */}
      <div 
        className={`relative w-[50vw] h-[60vh] border-4 rounded-[3rem] transition-all duration-300 ${colorClass} flex items-center justify-center bg-black bg-opacity-10 backdrop-blur-[2px]`}
      >
        {/* Crosshair Center */}
        <div className={`absolute w-4 h-4 rounded-full ${isValid ? 'bg-green-500' : 'bg-red-500'} opacity-50`}></div>
        <div className={`absolute w-full h-[1px] ${isValid ? 'bg-green-500' : 'bg-red-500'} opacity-20`}></div>
        <div className={`absolute h-full w-[1px] ${isValid ? 'bg-green-500' : 'bg-red-500'} opacity-20`}></div>

        {/* Scan lines effect */}
        <div className="absolute inset-0 rounded-[2.8rem] overflow-hidden opacity-30">
            <div className="w-full h-full bg-gradient-to-b from-transparent via-white to-transparent animate-scan"></div>
        </div>

        {/* Countdown */}
        {countdown !== null && countdown > 0 && (
          <div className="absolute text-8xl font-black text-white drop-shadow-lg animate-pulse">
            {Math.ceil(countdown / 1000)}
          </div>
        )}
      </div>

      {/* Instruction Text */}
      <div className="mt-8 text-center bg-black bg-opacity-80 p-4 rounded-xl border border-gray-800">
        <h2 className="text-white font-bold text-xl uppercase tracking-widest mb-1">Head Positioning</h2>
        <p className={`text-2xl font-black ${textClass} transition-colors duration-300`}>
          {message}
        </p>
        <p className="text-gray-500 text-xs mt-2">
          Center your face inside the box.
        </p>
      </div>

      <style>{`
        @keyframes scan {
            0% { transform: translateY(-100%); }
            100% { transform: translateY(100%); }
        }
        .animate-scan {
            animation: scan 2s linear infinite;
        }
      `}</style>
    </div>
  );
};

export default HeadPositionGuide;