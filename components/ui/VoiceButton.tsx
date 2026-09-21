'use client';

/**
 * Speaker control for a screen's spoken guidance.
 *
 * `VoiceButton` replays one script; `VoiceMuteToggle` silences every screen and
 * remembers the choice. `VoiceControls` pairs them, which is what nearly every
 * screen wants in its top corner.
 */

import React from 'react';
import { useVoice, useVoiceConsumer, useVoiceOwnedClip } from '@/lib/voice/VoiceProvider';
import type { VoiceKey } from '@/lib/voice/scripts';

function SpeakerIcon({ className, muted = false }: { className?: string; muted?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      {muted ? (
        <>
          <path d="M17 9.5l4 5" />
          <path d="M21 9.5l-4 5" />
        </>
      ) : (
        <>
          <path d="M16.5 8.5a5 5 0 0 1 0 7" />
          <path d="M19 6a8.5 8.5 0 0 1 0 12" opacity="0.6" />
        </>
      )}
    </svg>
  );
}

function StopIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <rect x="7" y="7" width="10" height="10" rx="2" />
    </svg>
  );
}

export type VoiceButtonProps = {
  /** Script to replay. */
  voiceKey: VoiceKey;
  /**
   * Play these clips back to back instead of `voiceKey` alone.
   *
   * The break screen says "that step is done" and then introduces the next one
   * — two clips, one button. `voiceKey` should be the first of them.
   */
  sequence?: VoiceKey[];
  /** Button text. Default: "Listen". */
  label?: string;
  /** Speaker icon alone, for places where a label would crowd the layout. */
  iconOnly?: boolean;
  className?: string;
};

/**
 * Replays this screen's guidance. While speaking it turns into a stop button,
 * so a participant is never stuck waiting for a clip to finish.
 */
export function VoiceButton({
  voiceKey,
  sequence,
  label = 'Listen',
  iconOnly = false,
  className = '',
}: VoiceButtonProps) {
  const voice = useVoice();
  // A screen offering this button has guidance, even if it never auto-plays —
  // so the mute control appears alongside it.
  useVoiceConsumer();
  // What this button started, this button stops: on unmount, and when the key
  // changes underneath it — selecting a different step on the overview screen
  // swaps the key while the old clip is still playing.
  const owned = sequence ?? voiceKey;
  useVoiceOwnedClip(owned);
  if (!voice) return null;

  const keys = sequence ?? [voiceKey];
  const speaking = voice.speakingKey !== null && keys.includes(voice.speakingKey);
  const play = () =>
    speaking ? voice.stop() : sequence ? voice.speakSequence(sequence) : voice.speak(voiceKey, { force: true });

  if (iconOnly) {
    return (
      <button
        type="button"
        onClick={play}
        aria-label={speaking ? 'Stop the spoken instructions' : 'Play the spoken instructions'}
        title={speaking ? 'Stop' : label}
        className={[
          // shrink-0: these sit in flex rows beside headings, and without it
          // a long heading squeezes the icon narrower on one screen than another.
          'inline-flex shrink-0 items-center justify-center w-9 h-9 rounded-xl border transition',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
          speaking
            ? 'bg-blue-600/20 border-blue-500 text-blue-100'
            : 'bg-gray-800 border-gray-600 text-gray-200 hover:border-gray-400 hover:bg-gray-700',
          className,
        ].join(' ')}
      >
        {speaking ? <StopIcon className="w-4 h-4" /> : <SpeakerIcon className="w-4 h-4" />}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={play}
      aria-label={speaking ? 'Stop the spoken instructions' : 'Play the spoken instructions'}
      className={[
        'inline-flex shrink-0 items-center gap-2 px-3.5 py-2 rounded-xl border text-sm font-medium transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
        speaking
          ? 'bg-blue-600/20 border-blue-500 text-blue-100'
          : 'bg-gray-800 border-gray-600 text-gray-200 hover:border-gray-400 hover:bg-gray-700',
        className,
      ].join(' ')}
    >
      {speaking ? (
        <StopIcon className="w-4 h-4" />
      ) : (
        <SpeakerIcon className="w-4 h-4" muted={voice.muted} />
      )}
      <span>{speaking ? 'Stop' : label}</span>
      {speaking && (
        <span className="flex items-end gap-0.5 h-3" aria-hidden>
          <span className="w-0.5 bg-blue-300 animate-pulse" style={{ height: '60%' }} />
          <span className="w-0.5 bg-blue-300 animate-pulse" style={{ height: '100%', animationDelay: '150ms' }} />
          <span className="w-0.5 bg-blue-300 animate-pulse" style={{ height: '45%', animationDelay: '300ms' }} />
        </span>
      )}
    </button>
  );
}

/** Silences spoken guidance across every screen; the choice is remembered. */
export function VoiceMuteToggle({ className = '' }: { className?: string }) {
  const voice = useVoice();
  if (!voice) return null;

  return (
    <button
      type="button"
      onClick={voice.toggleMuted}
      aria-pressed={voice.muted}
      aria-label={voice.muted ? 'Turn spoken instructions on' : 'Turn spoken instructions off'}
      title={voice.muted ? 'Spoken instructions are off' : 'Spoken instructions are on'}
      className={[
        'inline-flex shrink-0 items-center justify-center w-9 h-9 rounded-xl border transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
        voice.muted
          ? 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'
          : 'bg-gray-800 border-gray-600 text-gray-200 hover:border-gray-400',
        className,
      ].join(' ')}
    >
      <SpeakerIcon className="w-4 h-4" muted={voice.muted} />
    </button>
  );
}

/**
 * The speaker control for a screen: one icon, nothing else.
 *
 * Muting is deliberately not here. Repeating a mute button on every screen was
 * clutter, and the participant only needs one — it lives in the corner, shown
 * by VoiceProvider for as long as any screen has guidance to speak.
 *
 * `floating` pins it to the top-right corner for full-screen task layouts that
 * have no header of their own.
 */
export function VoiceControls({
  voiceKey,
  label,
  floating = false,
  className = '',
}: {
  voiceKey: VoiceKey;
  label?: string;
  floating?: boolean;
  className?: string;
}) {
  const voice = useVoice();
  if (!voice) return null;

  return (
    <VoiceButton
      voiceKey={voiceKey}
      label={label}
      iconOnly
      className={[
        // cursor-auto: the calibration and exercise screens hide the cursor so
        // it cannot be mistaken for the target, but this control needs it back.
        floating ? 'fixed top-4 right-4 z-[300] pointer-events-auto cursor-auto' : '',
        className,
      ].join(' ')}
    />
  );
}

/**
 * The one mute control in the app, pinned bottom-right.
 *
 * Shown only while a screen with guidance is mounted, so it never appears on
 * the admin pages. Bottom-right is the one corner nothing else claims:
 * bottom-left is where Next's dev indicator sits, and the top corners belong
 * to the per-screen speaker, the recording badge and the exit button.
 */
export function GlobalMuteButton() {
  const voice = useVoice();
  if (!voice || !voice.hasConsumers) return null;

  return (
    <VoiceMuteToggle
      className={[
        'fixed bottom-4 right-4 z-[350] cursor-auto shadow-lg',
        // Dim until wanted: it is present on every screen, including tasks
        // where the participant should be looking at the target, not at this.
        voice.muted ? '' : 'opacity-70 hover:opacity-100 focus-visible:opacity-100 transition-opacity',
      ].join(' ')}
    />
  );
}

export default VoiceButton;
