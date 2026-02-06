import React, { useState, useEffect, useRef } from 'react';
import { AppState, EyeFeatures } from '../types';
import { HeadValidationResult } from '../services/eyeTrackingService';

interface DiagnosticsPanelProps {
  showCamera: boolean;
  setShowCamera: (show: boolean) => void;
  headValidation: HeadValidationResult | null;
  rawFeatures: EyeFeatures | null;
  capturedImagesCount: number;
  isBlinking: boolean;
  status: AppState;
}

const DiagnosticsPanel: React.FC<DiagnosticsPanelProps> = ({
  showCamera,
  setShowCamera,
  headValidation,
  rawFeatures,
  capturedImagesCount,
  isBlinking,
  status
}) => {
  // Initial position: Bottom Left, slightly padded
  const [position, setPosition] = useState({ x: 16, y: typeof window !== 'undefined' ? window.innerHeight - 220 : 500 });
  const isDragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  useEffect(() => {
     // Handle window resize to keep it on screen roughly
     const handleResize = () => {
         setPosition(prev => ({
             x: Math.min(prev.x, window.innerWidth - 100),
             y: Math.min(prev.y, window.innerHeight - 100)
         }));
     };
     window.addEventListener('resize', handleResize);
     return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging.current) {
        setPosition({
          x: e.clientX - dragOffset.current.x,
          y: e.clientY - dragOffset.current.y
        });
      }
    };

    const handleMouseUp = () => {
      isDragging.current = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y
    };
  };

  return (
    <div 
        className="fixed bg-black bg-opacity-80 p-3 rounded border border-gray-800 z-[200] cursor-move select-none shadow-lg backdrop-blur-sm min-w-[160px]"
        style={{ left: position.x, top: position.y }}
        onMouseDown={onMouseDown}
    >
        <h4 className="text-gray-500 text-[10px] uppercase tracking-wider mb-2 flex justify-between items-center group">
            <span>Diagnostics</span>
            <div className="flex space-x-1">
                <div className="w-1 h-1 bg-gray-600 rounded-full group-hover:bg-gray-400"></div>
                <div className="w-1 h-1 bg-gray-600 rounded-full group-hover:bg-gray-400"></div>
                <div className="w-1 h-1 bg-gray-600 rounded-full group-hover:bg-gray-400"></div>
            </div>
        </h4>
        
        {/* Stop propagation on controls so clicking them doesn't start a drag */}
        <div className="flex items-center space-x-2 mb-2 cursor-pointer" onMouseDown={(e) => e.stopPropagation()} onClick={() => setShowCamera(!showCamera)}>
            <div 
                className={`w-3 h-3 rounded-full transition-colors ${showCamera ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]' : 'bg-gray-600'}`}
            />
            <span className="text-[10px] text-gray-400 hover:text-white transition-colors">Show Debug View</span>
        </div>
        
        {headValidation && (
            <div className={`text-xs font-bold mb-1 ${headValidation.valid ? 'text-green-500' : 'text-red-500'}`}>
                Head: {headValidation.message}
            </div>
        )}

        {rawFeatures && rawFeatures.headPose && (
        <div className="text-[9px] text-gray-400 font-mono space-y-1 mb-2">
            <div>Pitch: {(rawFeatures.headPose.pitch * 180 / Math.PI).toFixed(1)}°</div>
            <div>Yaw:   {(rawFeatures.headPose.yaw * 180 / Math.PI).toFixed(1)}°</div>
            <div>Roll:  {(rawFeatures.headPose.roll * 180 / Math.PI).toFixed(1)}°</div>
        </div>
        )}
        
        <div className="text-[9px] text-gray-500">
            Imgs Captured: {capturedImagesCount}
        </div>

        {isBlinking && <div className="text-red-500 font-bold text-xs mb-1">BLINK DETECTED</div>}
        <div className="text-[10px] text-gray-600 mt-1 pt-1 border-t border-gray-800">Status: {status}</div>
    </div>
  );
};

export default DiagnosticsPanel;