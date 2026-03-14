'use client';

import React, { useMemo } from 'react';
import { generateNumberPositions } from './utils';
import { PRACTICE_COUNT } from './constants';

/**
 * Practice screen: 4 numbers at random positions. User gets familiar with the layout; no recording.
 */
export default function VisualSearchPractice() {
  const positions = useMemo(() => generateNumberPositions(PRACTICE_COUNT), []);

  return (
    <div className="flex flex-col items-center justify-center min-h-[280px]">
      <p className="text-gray-400 text-sm mb-4">
        Look at the numbers in order: 1 → 2 → 3 → 4. When ready, click &quot;Start real test&quot; below.
      </p>
      <div className="relative w-full max-w-2xl h-64">
        {positions.map((pos) => (
          <div
            key={pos.number}
            className="absolute w-12 h-12 flex items-center justify-center rounded-full bg-blue-600/90 text-white text-xl font-bold"
            style={{
              left: `${pos.x}%`,
              top: `${pos.y}%`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            {pos.number}
          </div>
        ))}
      </div>
    </div>
  );
}
