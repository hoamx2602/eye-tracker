import React from 'react';

interface GazeCursorProps {
  x: number; // Screen X (pixels)
  y: number; // Screen Y (pixels)
}

const GazeCursor: React.FC<GazeCursorProps> = ({ x, y }) => {
  // Clamp coordinates to screen bounds to prevent overflow visual bugs
  const clampedX = Math.max(0, Math.min(window.innerWidth, x));
  const clampedY = Math.max(0, Math.min(window.innerHeight, y));

  return (
    <div
      className="fixed z-[100] pointer-events-none"
      style={{
        left: 0,
        top: 0,
        transform: `translate(${clampedX}px, ${clampedY}px) translate(-50%, -50%)`,
        transition: 'transform 0.1s ease-out' // CSS smoothing on top of JS smoothing
      }}
    >
      {/* The Bubble */}
      <div className="relative">
        <div className="w-16 h-16 rounded-full bg-blue-500 bg-opacity-40 border-2 border-blue-300 blur-sm"></div>
        <div className="absolute top-1/2 left-1/2 w-2 h-2 bg-blue-100 rounded-full -translate-x-1/2 -translate-y-1/2 shadow-glow"></div>
      </div>
      
      {/* Coordinate Label */}
      <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 bg-gray-900 bg-opacity-80 text-blue-200 text-xs px-2 py-1 rounded whitespace-nowrap font-mono">
        {Math.round(x)}, {Math.round(y)}
      </div>
    </div>
  );
};

export default GazeCursor;