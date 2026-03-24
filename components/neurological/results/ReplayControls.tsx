'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

/** Available playback speeds. */
const SPEEDS = [0.5, 1, 2] as const;
export type ReplaySpeed = typeof SPEEDS[number];

// ── Icons ─────────────────────────────────────────────────────────────────────

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 translate-x-px">
      <path d="M3 2.5l10 5.5-10 5.5V2.5z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
      <rect x="3" y="2" width="4" height="12" rx="1" />
      <rect x="9" y="2" width="4" height="12" rx="1" />
    </svg>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface ReplayControlsState {
  /** Current replay position (seconds). Falls back to durationSec when not yet scrubbed. */
  effectiveReplay: number;
  playing: boolean;
  speed: ReplaySpeed;
  setSpeed: (s: ReplaySpeed) => void;
  /** Toggle play / pause. Restarts from 0 if already at the end. */
  toggle: () => void;
  /** Move scrubber to a specific second. Safe to call while playing. */
  handleScrub: (val: number) => void;
}

/**
 * Manages replay scrubber state with play/pause and variable speed.
 * Uses requestAnimationFrame for smooth, frame-rate-independent playback.
 */
export function useReplayControls(durationSec: number): ReplayControlsState {
  const [replayTimeSec, setReplayTimeSec] = useState<number | null>(null);
  const [playing, setPlaying]             = useState(false);
  const [speed, setSpeed_]                = useState<ReplaySpeed>(1);

  const effectiveReplay = replayTimeSec !== null ? replayTimeSec : durationSec;

  // Refs — allow the rAF tick to read fresh values without stale closures
  const playingRef    = useRef(false);
  const speedRef      = useRef<ReplaySpeed>(1);
  const durationRef   = useRef(durationSec);
  const currentRef    = useRef(effectiveReplay); // tracks position for toggle logic
  const lastTsRef     = useRef<number | null>(null);
  const rafRef        = useRef<number | null>(null);

  // Keep refs in sync
  useEffect(() => { durationRef.current  = durationSec;     }, [durationSec]);
  useEffect(() => { speedRef.current     = speed;           }, [speed]);
  useEffect(() => { currentRef.current   = effectiveReplay; }, [effectiveReplay]);

  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    lastTsRef.current = null;
  }, []);

  // Stable rAF tick — reads only via refs, never captures state/props
  const tick = useCallback((ts: number) => {
    if (!playingRef.current) return;
    if (lastTsRef.current !== null) {
      const dt = ((ts - lastTsRef.current) / 1000) * speedRef.current;
      setReplayTimeSec(prev => {
        const cur  = prev !== null ? prev : durationRef.current;
        const next = cur + dt;
        if (next >= durationRef.current) {
          // Reached end → stop
          playingRef.current = false;
          setPlaying(false);
          currentRef.current = durationRef.current;
          return durationRef.current;
        }
        currentRef.current = next;
        return next;
      });
    }
    lastTsRef.current = ts;
    rafRef.current = requestAnimationFrame(tick);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = useCallback(() => {
    if (playingRef.current) {
      // Pause
      playingRef.current = false;
      setPlaying(false);
      stopRaf();
    } else {
      // Play — restart from 0 if at or past the end
      if (currentRef.current >= durationRef.current - 0.05) {
        setReplayTimeSec(0);
        currentRef.current = 0;
      }
      playingRef.current = true;
      setPlaying(true);
      lastTsRef.current = null;
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [tick, stopRaf]);

  const handleScrub = useCallback((val: number) => {
    setReplayTimeSec(val);
    currentRef.current = val;
    // Reset last timestamp so the next rAF tick doesn't accumulate the scrub gap
    lastTsRef.current = null;
  }, []);

  const setSpeed = useCallback((s: ReplaySpeed) => {
    setSpeed_(s);
    speedRef.current = s;
  }, []);

  // Cancel loop on unmount
  useEffect(() => () => stopRaf(), [stopRaf]);

  return { effectiveReplay, playing, speed, setSpeed, toggle, handleScrub };
}

// ── UI component ──────────────────────────────────────────────────────────────

interface ReplayControlsBarProps {
  effectiveReplay: number;
  durationSec: number;
  playing: boolean;
  speed: ReplaySpeed;
  onToggle: () => void;
  onScrub: (val: number) => void;
  onSpeedChange: (s: ReplaySpeed) => void;
}

/**
 * Replay control bar: ▶/⏸ · scrubber · time · speed selector.
 *
 * Replace existing plain `<input type="range">` blocks with this component.
 * The bar includes its own `border-t` separator so it sits flush at the
 * bottom of the visualisation frame.
 */
export function ReplayControlsBar({
  effectiveReplay,
  durationSec,
  playing,
  speed,
  onToggle,
  onScrub,
  onSpeedChange,
}: ReplayControlsBarProps) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-gray-800 bg-gray-900/40 px-3 pb-3 pt-2.5 sm:px-4 sm:pb-3">
      {/* ▶ / ⏸ */}
      <button
        type="button"
        onClick={onToggle}
        aria-label={playing ? 'Pause replay' : 'Play replay'}
        className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white transition-colors"
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>

      {/* Scrubber */}
      <input
        type="range"
        min={0}
        max={durationSec}
        step={0.05}
        value={Math.min(effectiveReplay, durationSec)}
        onChange={(e) => onScrub(Number(e.target.value))}
        className="min-w-0 flex-1 accent-sky-500"
        aria-label="Replay position"
      />

      {/* Time display */}
      <span className="shrink-0 w-[4.5rem] text-right font-mono text-[10px] leading-[14px] tracking-tight tabular-nums text-slate-300">
        {effectiveReplay.toFixed(1)}s
        <br />
        <span className="text-slate-600">{durationSec.toFixed(1)}s</span>
      </span>

      {/* Speed buttons */}
      <div className="shrink-0 flex items-center gap-0.5">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSpeedChange(s)}
            aria-pressed={speed === s}
            className={[
              'px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors select-none',
              speed === s
                ? 'bg-sky-600 text-white'
                : 'text-slate-500 hover:text-slate-200 hover:bg-slate-700',
            ].join(' ')}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}
