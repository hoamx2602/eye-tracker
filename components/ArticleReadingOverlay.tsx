'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';

interface TextSegment {
  id: number;
  text: string;
  type: 'h1' | 'h2' | 'h3' | 'p';
}

interface SegmentResult {
  segmentId: number;
  gazeX: number;
  gazeY: number;
  error: number;
}

interface ArticleReadingOverlayProps {
  gazeX: number;
  gazeY: number;
}

const HIGHLIGHT_DURATION_MS = 2500;
const PAUSE_BETWEEN_MS = 400;

const ARTICLE_SEGMENTS: TextSegment[] = [
  { id: 0, text: 'The Future of Brain-Computer Interfaces', type: 'h1' },
  { id: 1, text: 'How Neural Technology Is Reshaping Human Interaction', type: 'h2' },
  { id: 2, text: 'Brain-computer interfaces (BCIs) are rapidly evolving from laboratory curiosities into practical tools that could fundamentally change how humans interact with technology. Recent breakthroughs in non-invasive neural sensing have made it possible to decode brain signals with unprecedented accuracy.', type: 'p' },
  { id: 3, text: 'The Science Behind the Signal', type: 'h2' },
  { id: 4, text: 'At the heart of every BCI lies the ability to measure and interpret electrical activity in the brain. Electroencephalography (EEG), once confined to clinical settings, can now be performed using lightweight, wireless headsets that consumers can wear comfortably at home.', type: 'p' },
  { id: 5, text: 'From Medical Applications to Daily Life', type: 'h3' },
  { id: 6, text: 'While the initial promise of BCIs focused on restoring mobility for patients with paralysis, the technology has expanded far beyond medical use. Today, researchers are exploring applications in gaming, education, and workplace productivity — areas where even subtle improvements in human-computer communication could yield significant benefits.', type: 'p' },
  { id: 7, text: 'Eye Tracking Meets Neural Decoding', type: 'h2' },
  { id: 8, text: 'One of the most promising convergence points is the combination of eye tracking with neural signal processing. By correlating where a person looks with their brain activity patterns, systems can achieve a level of intent recognition that neither technology could accomplish alone.', type: 'p' },
  { id: 9, text: 'Challenges in Real-World Deployment', type: 'h3' },
  { id: 10, text: 'Despite the excitement, several challenges remain. Signal noise from everyday environments, individual variability in brain patterns, and the need for periodic recalibration all present obstacles. Additionally, privacy concerns around neural data collection have prompted calls for new regulatory frameworks.', type: 'p' },
  { id: 11, text: 'The Road Ahead', type: 'h2' },
  { id: 12, text: 'As hardware becomes smaller and algorithms more sophisticated, the gap between laboratory demonstrations and consumer products continues to narrow. Experts predict that within the next decade, brain-computer interfaces will be as commonplace as voice assistants are today — seamlessly augmenting our ability to communicate, create, and connect.', type: 'p' },
];

const ArticleReadingOverlay: React.FC<ArticleReadingOverlayProps> = ({ gazeX, gazeY }) => {
  const [step, setStep] = useState(-1); // -1 = ready, 0..N-1 = highlighting, N = done
  const [isPaused, setIsPaused] = useState(false);
  const [results, setResults] = useState<SegmentResult[]>([]);
  const segmentRefs = useRef<Map<number, HTMLElement>>(new Map());
  const gazeRef = useRef({ x: gazeX, y: gazeY });
  const gazeHistoryRef = useRef<{ x: number; y: number }[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    gazeRef.current = { x: gazeX, y: gazeY };
  }, [gazeX, gazeY]);

  const setSegmentRef = useCallback((id: number, el: HTMLElement | null) => {
    if (el) segmentRefs.current.set(id, el);
    else segmentRefs.current.delete(id);
  }, []);

  // Collect gaze samples while a segment is active
  useEffect(() => {
    if (step < 0 || step >= ARTICLE_SEGMENTS.length || isPaused) return;
    gazeHistoryRef.current = [];
    const interval = setInterval(() => {
      gazeHistoryRef.current.push({ ...gazeRef.current });
    }, 50);
    return () => clearInterval(interval);
  }, [step, isPaused]);

  // Auto-scroll to the active segment
  useEffect(() => {
    if (step < 0 || step >= ARTICLE_SEGMENTS.length) return;
    const segment = ARTICLE_SEGMENTS[step];
    const el = segmentRefs.current.get(segment.id);
    if (el && containerRef.current) {
      const container = containerRef.current;
      const elRect = el.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const targetScroll = container.scrollTop + (elRect.top - containerRect.top) - containerRect.height / 3;
      container.scrollTo({ top: targetScroll, behavior: 'smooth' });
    }
  }, [step]);

  // Timer: after HIGHLIGHT_DURATION_MS, record result and advance
  useEffect(() => {
    if (step < 0 || step >= ARTICLE_SEGMENTS.length || isPaused) return;

    const timer = setTimeout(() => {
      const segment = ARTICLE_SEGMENTS[step];
      const el = segmentRefs.current.get(segment.id);
      const rect = el?.getBoundingClientRect();

      if (rect) {
        const samples = gazeHistoryRef.current;
        const startIdx = Math.floor(samples.length * 0.3);
        const usable = samples.slice(startIdx);
        const avgX = usable.length > 0 ? usable.reduce((s, p) => s + p.x, 0) / usable.length : gazeRef.current.x;
        const avgY = usable.length > 0 ? usable.reduce((s, p) => s + p.y, 0) / usable.length : gazeRef.current.y;

        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const error = Math.sqrt((avgX - centerX) ** 2 + (avgY - centerY) ** 2);

        setResults(prev => [...prev, { segmentId: segment.id, gazeX: avgX, gazeY: avgY, error }]);
      }

      // Brief pause before next segment
      setIsPaused(true);
      setTimeout(() => {
        setIsPaused(false);
        setStep(s => s + 1);
      }, PAUSE_BETWEEN_MS);
    }, HIGHLIGHT_DURATION_MS);

    return () => clearTimeout(timer);
  }, [step, isPaused]);

  const handleStart = () => {
    setResults([]);
    setStep(0);
    setIsPaused(false);
  };

  const handleRestart = () => {
    setResults([]);
    setStep(-1);
    setIsPaused(false);
    if (containerRef.current) containerRef.current.scrollTop = 0;
  };

  const isRunning = step >= 0 && step < ARTICLE_SEGMENTS.length;
  const isDone = step >= ARTICLE_SEGMENTS.length;
  const activeSegmentId = isRunning ? ARTICLE_SEGMENTS[step].id : null;

  const getSegmentStyle = (segment: TextSegment): React.CSSProperties => {
    const isActive = activeSegmentId === segment.id;
    const result = results.find(r => r.segmentId === segment.id);

    const base: React.CSSProperties = {
      transition: 'all 0.3s ease',
      borderRadius: '6px',
      padding: '4px 8px',
      margin: '-4px -8px',
    };

    if (isActive) {
      return {
        ...base,
        backgroundColor: 'rgba(59, 130, 246, 0.2)',
        boxShadow: '0 0 0 2px rgba(59, 130, 246, 0.5), 0 0 20px rgba(59, 130, 246, 0.15)',
      };
    }

    if (result) {
      const isGood = result.error < 150;
      return {
        ...base,
        backgroundColor: isGood ? 'rgba(34, 197, 94, 0.08)' : 'rgba(239, 68, 68, 0.08)',
        borderLeft: `3px solid ${isGood ? '#22c55e' : '#ef4444'}`,
        paddingLeft: '12px',
      };
    }

    return base;
  };

  const renderSegment = (segment: TextSegment) => {
    const result = results.find(r => r.segmentId === segment.id);
    const errorBadge = result ? (
      <span className={`ml-2 text-xs font-mono ${result.error < 150 ? 'text-green-400' : 'text-red-400'}`}>
        ({Math.round(result.error)}px)
      </span>
    ) : null;

    const refCb = (el: HTMLElement | null) => setSegmentRef(segment.id, el);

    switch (segment.type) {
      case 'h1':
        return <h1 ref={refCb} style={getSegmentStyle(segment)} className="text-3xl font-bold text-white mb-6 leading-tight">{segment.text}{errorBadge}</h1>;
      case 'h2':
        return <h2 ref={refCb} style={getSegmentStyle(segment)} className="text-xl font-semibold text-blue-300 mt-8 mb-3">{segment.text}{errorBadge}</h2>;
      case 'h3':
        return <h3 ref={refCb} style={getSegmentStyle(segment)} className="text-lg font-medium text-blue-200/80 mt-6 mb-2">{segment.text}{errorBadge}</h3>;
      case 'p':
        return <p ref={refCb} style={getSegmentStyle(segment)} className="text-gray-300 leading-relaxed mb-4 text-[15px]">{segment.text}{errorBadge}</p>;
    }
  };

  // Summary screen
  if (isDone) {
    const avgError = results.length > 0 ? results.reduce((s, r) => s + r.error, 0) / results.length : 0;
    const goodCount = results.filter(r => r.error < 150).length;

    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60">
        <div className="bg-slate-800 border border-slate-600 rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
          <h2 className="text-2xl font-bold text-white mb-2 text-center">Reading Test Complete</h2>
          <p className="text-gray-400 text-sm text-center mb-6">Results for {results.length} text segments</p>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-slate-700/60 rounded-xl p-4 text-center">
              <div className="text-3xl font-bold text-blue-400">{Math.round(avgError)}px</div>
              <div className="text-xs text-gray-400 mt-1">Average Error</div>
            </div>
            <div className="bg-slate-700/60 rounded-xl p-4 text-center">
              <div className="text-3xl font-bold text-green-400">{goodCount}/{results.length}</div>
              <div className="text-xs text-gray-400 mt-1">Accurate (&lt;150px)</div>
            </div>
          </div>

          <div className="max-h-48 overflow-y-auto mb-6 space-y-1 scrollbar-thin">
            {results.map(r => {
              const seg = ARTICLE_SEGMENTS.find(s => s.id === r.segmentId);
              const isGood = r.error < 150;
              const icon = seg?.type === 'h1' ? '📰' : seg?.type === 'h2' ? '📌' : seg?.type === 'h3' ? '📎' : '¶';
              return (
                <div key={r.segmentId} className="flex items-center gap-2 text-xs py-1 px-2 rounded bg-slate-700/40">
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isGood ? 'bg-green-400' : 'bg-red-400'}`} />
                  <span className="text-gray-400 truncate flex-1">
                    {icon} {seg?.text.slice(0, 50)}{(seg?.text.length ?? 0) > 50 ? '...' : ''}
                  </span>
                  <span className={`font-mono flex-shrink-0 ${isGood ? 'text-green-400' : 'text-red-400'}`}>{Math.round(r.error)}px</span>
                </div>
              );
            })}
          </div>

          <button onClick={handleRestart} className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-colors">
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // Article view (ready or running)
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black">
      <div
        ref={containerRef}
        className="relative z-10 w-full max-w-3xl max-h-[85vh] mx-4 overflow-y-auto bg-slate-900/95 border border-slate-600 rounded-2xl shadow-2xl scrollbar-thin"
      >
        {/* Header bar */}
        <div className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur-sm border-b border-slate-700 px-8 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white text-sm font-bold">B</div>
            <span className="text-sm text-gray-400 font-medium">Bradford Research Journal</span>
          </div>
          {isRunning && (
            <div className="flex items-center gap-3">
              <div className="text-xs text-gray-400 font-mono">{step + 1} / {ARTICLE_SEGMENTS.length}</div>
              <div className="w-24 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${((step + 1) / ARTICLE_SEGMENTS.length) * 100}%` }} />
              </div>
            </div>
          )}
          {step < 0 && (
            <span className="text-xs text-gray-500">Press Begin to start</span>
          )}
        </div>

        {/* Article body */}
        <div className="px-8 py-6">
          <div className="mb-4 flex items-center gap-2 text-xs text-gray-500">
            <span>Published March 2026</span>
            <span>·</span>
            <span>8 min read</span>
            <span>·</span>
            <span>Neuroscience &amp; Technology</span>
          </div>

          {ARTICLE_SEGMENTS.map(segment => (
            <div key={segment.id}>{renderSegment(segment)}</div>
          ))}
        </div>

        {/* Ready overlay with backdrop blur */}
        {step < 0 && (
          <div className="absolute inset-0 flex items-center justify-center backdrop-blur-md bg-slate-900/60 rounded-2xl">
            <div className="text-center bg-slate-800/90 border border-slate-600 rounded-2xl px-10 py-8 shadow-2xl max-w-sm mx-4">
              <div className="text-5xl mb-4">📖</div>
              <p className="text-white text-lg font-semibold mb-2">Article Reading Test</p>
              <p className="text-gray-400 text-sm">
                Each section will be highlighted in sequence. Focus your eyes on the highlighted text to measure gaze accuracy.
              </p>
              <button onClick={handleStart} className="mt-6 px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-colors shadow-lg">
                Begin
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ArticleReadingOverlay;
