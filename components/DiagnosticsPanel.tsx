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
  lightLevel?: { value: number; status: 'too_dark' | 'low' | 'ok' | 'good' } | null;
}

const DiagnosticsPanel: React.FC<DiagnosticsPanelProps> = ({
  showCamera,
  setShowCamera,
  headValidation,
  rawFeatures,
  capturedImagesCount,
  isBlinking,
  status,
  lightLevel
}) => {
  const [expanded, setExpanded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  // Initial position: same on server and client to avoid hydration mismatch; then sync from window after mount
  const [position, setPosition] = useState({ x: 16, y: 500 });
  const isDragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  useEffect(() => {
    setPosition({ x: 16, y: window.innerHeight - 220 });
  }, []);

  // Click outside to collapse when expanded
  useEffect(() => {
    if (!expanded) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [expanded]);

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
    if (!expanded) return;
    isDragging.current = true;
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y
    };
  };

  if (!expanded) {
    return (
      <div
        ref={panelRef}
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(true)}
        onKeyDown={(e) => e.key === 'Enter' && setExpanded(true)}
        className="fixed z-[200] px-3 py-1.5 rounded-full bg-black/80 border border-gray-800 shadow-lg backdrop-blur-sm cursor-pointer select-none flex items-center gap-2 hover:bg-gray-800/90 hover:border-gray-700 transition-colors"
        style={{ left: position.x, top: position.y }}
        title="Open diagnostics"
      >
        <span className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">Diagnostics</span>
        <svg className="w-3 h-3 text-gray-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    );
  }

  return (
    <div
        ref={panelRef}
        className="fixed bg-black bg-opacity-80 p-3 rounded border border-gray-800 z-[200] cursor-move select-none shadow-lg backdrop-blur-sm min-w-[160px]"
        style={{ left: position.x, top: position.y }}
        onMouseDown={onMouseDown}
    >
        <h4 className="text-gray-500 text-[10px] uppercase tracking-wider mb-2 flex justify-between items-center group">
            <span>Diagnostics</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
              onMouseDown={(e) => e.stopPropagation()}
              className="p-0.5 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-700/50 transition"
              title="Collapse"
              aria-label="Collapse diagnostics"
            >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
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

        {lightLevel && (
          <div className={`text-[10px] font-medium mb-1 ${
            lightLevel.status === 'too_dark' ? 'text-red-400' :
            lightLevel.status === 'low' ? 'text-amber-400' :
            lightLevel.status === 'ok' ? 'text-gray-400' : 'text-green-400'
          }`}>
            Light: {lightLevel.value} ({lightLevel.status === 'too_dark' ? 'Too dark' : lightLevel.status === 'low' ? 'Low' : lightLevel.status === 'ok' ? 'OK' : 'Good'})
          </div>
        )}

        {isBlinking && <div className="text-red-500 font-bold text-xs mb-1">BLINK DETECTED</div>}
        <div className="text-[10px] text-gray-600 mt-1 pt-1 border-t border-gray-800">Status: {status}</div>
    </div>
  );
};

export default DiagnosticsPanel;