'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';

interface DotTarget {
  id: number;
  x: number;
  y: number;
}

interface DotResult {
  target: DotTarget;
  gazeX: number;
  gazeY: number;
  error: number;
}

interface RandomDotsOverlayProps {
  gazeX: number;
  gazeY: number;
  onComplete?: (results: DotResult[]) => void;
}

const TOTAL_DOTS = 15;
const DOT_HOLD_MS = 3000;
const COUNTDOWN_MS = 1500;
const EDGE_PAD = 8; // % from edge

function generateDots(count: number): DotTarget[] {
  const dots: DotTarget[] = [];
  for (let i = 0; i < count; i++) {
    dots.push({
      id: i,
      x: EDGE_PAD + Math.random() * (100 - 2 * EDGE_PAD),
      y: EDGE_PAD + Math.random() * (100 - 2 * EDGE_PAD),
    });
  }
  return dots;
}

const RandomDotsOverlay: React.FC<RandomDotsOverlayProps> = ({ gazeX, gazeY, onComplete }) => {
  const [dots] = useState<DotTarget[]>(() => generateDots(TOTAL_DOTS));
  const [currentIndex, setCurrentIndex] = useState(-1); // -1 = countdown before first dot
  const [phase, setPhase] = useState<'countdown' | 'showing' | 'result' | 'summary'>('countdown');
  const [results, setResults] = useState<DotResult[]>([]);
  const [countdown, setCountdown] = useState(3);
  const gazeRef = useRef({ x: gazeX, y: gazeY });
  const gazeHistoryRef = useRef<{ x: number; y: number }[]>([]);

  useEffect(() => {
    gazeRef.current = { x: gazeX, y: gazeY };
  }, [gazeX, gazeY]);

  // Initial countdown
  useEffect(() => {
    if (phase !== 'countdown') return;
    if (countdown <= 0) {
      setCurrentIndex(0);
      setPhase('showing');
      return;
    }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, countdown]);

  // Collect gaze samples while showing a dot
  useEffect(() => {
    if (phase !== 'showing') return;
    gazeHistoryRef.current = [];
    const interval = setInterval(() => {
      gazeHistoryRef.current.push({ ...gazeRef.current });
    }, 50);
    return () => clearInterval(interval);
  }, [phase, currentIndex]);

  // Auto-advance dots
  useEffect(() => {
    if (phase !== 'showing' || currentIndex < 0 || currentIndex >= dots.length) return;

    const t = setTimeout(() => {
      const samples = gazeHistoryRef.current;
      // Use average of last 60% of samples (after settling)
      const startIdx = Math.floor(samples.length * 0.4);
      const usable = samples.slice(startIdx);
      const avgX = usable.length > 0 ? usable.reduce((s, p) => s + p.x, 0) / usable.length : gazeRef.current.x;
      const avgY = usable.length > 0 ? usable.reduce((s, p) => s + p.y, 0) / usable.length : gazeRef.current.y;

      const dot = dots[currentIndex];
      const targetPx = { x: (dot.x / 100) * window.innerWidth, y: (dot.y / 100) * window.innerHeight };
      const error = Math.sqrt((avgX - targetPx.x) ** 2 + (avgY - targetPx.y) ** 2);

      const result: DotResult = { target: dot, gazeX: avgX, gazeY: avgY, error };
      setResults(prev => [...prev, result]);

      // Show result briefly
      setPhase('result');
      setTimeout(() => {
        if (currentIndex + 1 >= dots.length) {
          setPhase('summary');
        } else {
          setCurrentIndex(currentIndex + 1);
          setPhase('showing');
        }
      }, 800);
    }, DOT_HOLD_MS);

    return () => clearTimeout(t);
  }, [phase, currentIndex, dots]);

  const handleRestart = useCallback(() => {
    setResults([]);
    setCurrentIndex(-1);
    setPhase('countdown');
    setCountdown(3);
  }, []);

  // Summary phase
  useEffect(() => {
    if (phase === 'summary' && onComplete) {
      onComplete(results);
    }
  }, [phase]);

  const currentDot = currentIndex >= 0 && currentIndex < dots.length ? dots[currentIndex] : null;

  if (phase === 'countdown') {
    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 pointer-events-none">
        <div className="text-center">
          <div className="text-7xl font-bold text-white animate-pulse">{countdown || 'Go!'}</div>
          <p className="mt-4 text-gray-300 text-lg">Focus on each dot as it appears</p>
        </div>
      </div>
    );
  }

  if (phase === 'summary') {
    const avgError = results.length > 0 ? results.reduce((s, r) => s + r.error, 0) / results.length : 0;
    const bestError = results.length > 0 ? Math.min(...results.map(r => r.error)) : 0;
    const worstError = results.length > 0 ? Math.max(...results.map(r => r.error)) : 0;
    const goodCount = results.filter(r => r.error < 100).length;

    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60">
        <div className="bg-slate-800 border border-slate-600 rounded-2xl p-8 max-w-lg w-full mx-4 shadow-2xl">
          <h2 className="text-2xl font-bold text-white mb-6 text-center">Accuracy Results</h2>
          
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-slate-700/60 rounded-xl p-4 text-center">
              <div className="text-3xl font-bold text-blue-400">{Math.round(avgError)}px</div>
              <div className="text-xs text-gray-400 mt-1">Average Error</div>
            </div>
            <div className="bg-slate-700/60 rounded-xl p-4 text-center">
              <div className="text-3xl font-bold text-green-400">{goodCount}/{results.length}</div>
              <div className="text-xs text-gray-400 mt-1">Good (&lt;100px)</div>
            </div>
            <div className="bg-slate-700/60 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-emerald-400">{Math.round(bestError)}px</div>
              <div className="text-xs text-gray-400 mt-1">Best</div>
            </div>
            <div className="bg-slate-700/60 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-red-400">{Math.round(worstError)}px</div>
              <div className="text-xs text-gray-400 mt-1">Worst</div>
            </div>
          </div>

          {/* Mini map of all results */}
          <div className="relative w-full aspect-video bg-slate-900 rounded-lg border border-slate-600 mb-6 overflow-hidden">
            {results.map((r, i) => {
              const tx = r.target.x;
              const ty = r.target.y;
              const gx = (r.gazeX / window.innerWidth) * 100;
              const gy = (r.gazeY / window.innerHeight) * 100;
              return (
                <React.Fragment key={i}>
                  {/* Target dot */}
                  <div
                    className="absolute w-2 h-2 rounded-full bg-green-400 -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${tx}%`, top: `${ty}%` }}
                  />
                  {/* Gaze dot */}
                  <div
                    className="absolute w-2 h-2 rounded-full bg-red-400 -translate-x-1/2 -translate-y-1/2 opacity-70"
                    style={{ left: `${gx}%`, top: `${gy}%` }}
                  />
                  {/* Line connecting them */}
                  <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }}>
                    <line
                      x1={`${tx}%`} y1={`${ty}%`}
                      x2={`${gx}%`} y2={`${gy}%`}
                      stroke={r.error < 100 ? '#4ade80' : '#f87171'}
                      strokeWidth="1"
                      opacity="0.4"
                    />
                  </svg>
                </React.Fragment>
              );
            })}
            <div className="absolute bottom-2 right-2 flex items-center gap-3 text-[10px] text-gray-400">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" /> Target</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> Gaze</span>
            </div>
          </div>

          <button
            onClick={handleRestart}
            className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // Showing or result phase
  return (
    <div className="fixed inset-0 z-[90] pointer-events-none">
      {/* Progress bar */}
      <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[95] bg-slate-800/90 rounded-full px-4 py-1.5 border border-slate-600">
        <span className="text-xs font-mono text-gray-300">
          {currentIndex + 1} / {dots.length}
        </span>
      </div>

      {/* Target dot */}
      {currentDot && (
        <div
          className="absolute transition-all duration-300"
          style={{
            left: `${currentDot.x}%`,
            top: `${currentDot.y}%`,
            transform: 'translate(-50%, -50%)',
          }}
        >
          {/* Pulsing ring */}
          <div className="absolute inset-0 w-12 h-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-emerald-400 animate-ping opacity-40" />
          {/* Outer circle */}
          <div className="w-12 h-12 rounded-full bg-emerald-500/30 border-2 border-emerald-400 flex items-center justify-center -translate-x-1/2 -translate-y-1/2">
            {/* Inner dot */}
            <div className="w-3 h-3 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.8)]" />
          </div>
          {/* Shrinking timer ring */}
          <svg className="absolute w-16 h-16 -translate-x-1/2 -translate-y-1/2 -top-2 -left-2" viewBox="0 0 64 64">
            <circle
              cx="32" cy="32" r="28"
              fill="none"
              stroke="rgba(52,211,153,0.5)"
              strokeWidth="2"
              strokeDasharray={`${2 * Math.PI * 28}`}
              strokeLinecap="round"
              style={{
                animation: `shrink-ring ${DOT_HOLD_MS}ms linear forwards`,
              }}
            />
          </svg>
        </div>
      )}

      {/* Result flash */}
      {phase === 'result' && results.length > 0 && (() => {
        const last = results[results.length - 1];
        const isGood = last.error < 100;
        return (
          <div
            className="fixed z-[95] pointer-events-none"
            style={{
              left: `${last.target.x}%`,
              top: `${last.target.y}%`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <div className={`px-3 py-1.5 rounded-full text-xs font-bold ${isGood ? 'bg-green-500/80 text-white' : 'bg-red-500/80 text-white'}`}>
              {Math.round(last.error)}px {isGood ? '✓' : '✗'}
            </div>
          </div>
        );
      })()}

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes shrink-ring {
          from { stroke-dashoffset: 0; }
          to { stroke-dashoffset: ${2 * Math.PI * 28}; }
        }
      ` }} />
    </div>
  );
};

export default RandomDotsOverlay;
