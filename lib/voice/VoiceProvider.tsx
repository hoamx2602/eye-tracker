'use client';

/**
 * Spoken guidance for the participant flow.
 *
 * Each script key resolves to `/audio/<key>.mp3` when that file has been
 * recorded, and falls back to the browser's speech synthesis otherwise, so the
 * flow is fully narrated before a single clip exists and upgrades to the real
 * voice file-by-file with no code change.
 *
 * `public/audio/manifest.json` — an array of keys, written by
 * `scripts/build-audio-manifest.ts` — tells us which clips exist. Without it we
 * still try the file first and fall back when it fails to load, at the cost of
 * one failed request per step.
 *
 * Browsers refuse to play audio before the participant has interacted with the
 * page, so the first request is held and replayed on the first gesture. In
 * practice that gesture is the consent button, which is why the consent screen
 * is the only one whose guidance may start a beat late.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { VOICE_SCRIPTS, getScript, type VoiceKey } from './scripts';

const MUTED_LS_KEY = 'voice_muted_v1';
const MANIFEST_URL = '/audio/manifest.json';

/**
 * Chromium stops speaking after roughly 15 seconds unless pause/resume nudges
 * it along. Safari does the opposite — pause() there can end the utterance —
 * so the nudge is applied only where it is the fix.
 */
const NEEDS_SPEECH_NUDGE =
  typeof navigator !== 'undefined' && /Chrome|Chromium|Edg\//.test(navigator.userAgent);

/**
 * Filename stem for a clip.
 *
 * A script's repeat cue is a clip in its own right, stored as `<key>.cue.mp3`,
 * because cues are what a participant hears most during a long task — leaving
 * them to the browser voice would mean the one line repeated a dozen times is
 * the one line that sounds synthetic.
 */
export function clipNameFor(key: VoiceKey, cue: boolean): string {
  return cue ? `${key}.cue` : key;
}

/** Clip URL for a key. Key and filename are deliberately identical. */
export function audioUrlForKey(key: VoiceKey, cue = false): string {
  return `/audio/${clipNameFor(key, cue)}.mp3`;
}

type SpeakOptions = {
  /** Speak the short repeat cue instead of the full text. */
  cue?: boolean;
  /** Speak even when this key was already spoken on this screen. */
  force?: boolean;
};

type VoiceContextValue = {
  speak: (key: VoiceKey, options?: SpeakOptions) => void;
  /** Speak several clips back to back (used to read the consent text). */
  speakSequence: (keys: VoiceKey[]) => void;
  stop: () => void;
  /**
   * Stop only if `key` is what is currently playing or queued.
   *
   * Lets a screen hand back the clip it started when it goes away, without
   * silencing whatever replaced it — the caller cannot know, at cleanup time,
   * whether the next screen has already started talking.
   */
  stopIfSpeaking: (key: VoiceKey | VoiceKey[]) => void;
  muted: boolean;
  setMuted: (muted: boolean) => void;
  toggleMuted: () => void;
  /** Key currently being spoken, or null. */
  speakingKey: VoiceKey | null;
  /** False until the browser has allowed audio (first user gesture). */
  unlocked: boolean;
  /**
   * Declares that the caller is a screen with spoken guidance. Returns the
   * matching release.
   */
  registerConsumer: () => () => void;
  /**
   * True while at least one screen with guidance is mounted. The mute control
   * shows itself only then, which keeps it off the admin pages.
   */
  hasConsumers: boolean;
};

const VoiceContext = createContext<VoiceContextValue | null>(null);

/**
 * Voice controls. Returns null outside the provider so a component can be
 * rendered in isolation (tests, admin previews) without a provider.
 */
export function useVoice(): VoiceContextValue | null {
  return useContext(VoiceContext);
}

export default function VoiceProvider({ children }: { children: React.ReactNode }) {
  const [muted, setMutedState] = useState(false);
  const [speakingKey, setSpeakingKey] = useState<VoiceKey | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [consumerCount, setConsumerCount] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** Keys known to have a recorded clip. null until the manifest resolves. */
  const manifestRef = useRef<Set<string> | null>(null);
  /** Keys whose clip failed to load — never retried as audio. */
  const missingRef = useRef<Set<string>>(new Set());
  /** Request held until the first user gesture unlocks playback. */
  const pendingRef = useRef<{ keys: VoiceKey[]; cue: boolean } | null>(null);
  /** Queue for speakSequence; drained as each clip ends. */
  const queueRef = useRef<VoiceKey[]>([]);
  const mutedRef = useRef(false);
  /**
   * Mirrors `unlocked` for the callbacks.
   *
   * Reading the state inside them would put it in their dependency lists, and
   * `speak` must keep a stable identity: `useVoiceOnMount` keys its effect on
   * it, so a new identity re-speaks whatever the screen is saying.
   */
  const unlockedRef = useRef(false);
  /** Poll that nudges the synthesiser along and catches an `onend` that never fires. */
  const watchdogRef = useRef<number | null>(null);
  /**
   * Generation counter for playback. Every start takes a token and every
   * callback checks it is still the current one before doing anything.
   *
   * Without this, stopping a clip could start a second voice: detaching the
   * audio source fires an `error` event, the old handler read that as "the
   * file is broken" and fell back to speaking the whole line — on top of
   * whatever had just started playing.
   */
  const playTokenRef = useRef(0);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  // --- persisted mute --------------------------------------------------
  useEffect(() => {
    try {
      setMutedState(localStorage.getItem(MUTED_LS_KEY) === '1');
    } catch (_) {}
  }, []);

  const setMuted = useCallback((next: boolean) => {
    setMutedState(next);
    try {
      localStorage.setItem(MUTED_LS_KEY, next ? '1' : '0');
    } catch (_) {}
  }, []);

  // --- which clips exist -----------------------------------------------
  useEffect(() => {
    let cancelled = false;
    fetch(MANIFEST_URL, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((list) => {
        if (cancelled) return;
        manifestRef.current = Array.isArray(list) ? new Set(list.map(String)) : null;
      })
      .catch(() => {
        // No manifest: fall back to trying the file and catching the failure.
        if (!cancelled) manifestRef.current = null;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stop = useCallback(() => {
    playTokenRef.current += 1;
    queueRef.current = [];
    pendingRef.current = null;
    if (watchdogRef.current != null) {
      clearInterval(watchdogRef.current);
      watchdogRef.current = null;
    }
    const audio = audioRef.current;
    if (audio) {
      // Detach first: clearing the source fires `error`, and a live handler
      // would take that for a broken file and start speaking the line.
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute('src');
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setSpeakingKey(null);
  }, []);

  /**
   * Speak `key` with the browser's synthesiser.
   *
   * Three long-standing browser bugs are worked around here, all of which show
   * up as "I pressed the button and nothing happened":
   *
   * 1. Chrome produces silence when `speak()` runs in the same tick as the
   *    `cancel()` before it, so the utterance is queued a beat later.
   * 2. The voice list loads asynchronously; speaking before it arrives can be
   *    dropped outright, so the first attempt waits for `voiceschanged`.
   * 3. Chrome stops speaking after about 15 seconds unless it is nudged, and
   *    `onend` then never fires — which used to leave the button stuck showing
   *    "Stop", so the next press only stopped a clip that was already silent.
   *    A poll on `synth.speaking` both nudges it and guarantees the end.
   */
  const speakSynthetic = useCallback((key: VoiceKey, text: string, token: number, onEnd: () => void) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      onEnd();
      return;
    }
    if (playTokenRef.current !== token) return;
    const synth = window.speechSynthesis;
    synth.cancel();

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (watchdogRef.current != null) {
        clearInterval(watchdogRef.current);
        watchdogRef.current = null;
      }
      onEnd();
    };

    const start = () => {
      // Superseded while we waited for the cancel to settle or voices to load.
      if (playTokenRef.current !== token) return;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.95;
      utterance.pitch = 1;
      utterance.lang = 'en-GB';
      const voices = synth.getVoices();
      const voice =
        voices.find((v) => v.lang === 'en-GB') ?? voices.find((v) => v.lang.startsWith('en'));
      if (voice) utterance.voice = voice;
      utterance.onend = finish;
      utterance.onerror = finish;

      setSpeakingKey(key);
      synth.speak(utterance);

      // Nudge past the 15-second cut-off, and notice an end that never fired.
      // `speaking` stays true through the brief queue gap, so only treat two
      // consecutive idle polls as the end.
      //
      // The hard cap covers the worst case: an engine that reports `speaking`
      // forever without ever producing sound (no audio device, a muted system
      // voice). Without it the control would stay stuck showing "Stop", and
      // the next press would stop a clip that was never audible instead of
      // playing it — which reads as "the button does nothing".
      const words = text.split(/\s+/).length;
      const capMs = Math.max(20000, (words / 150) * 60000 * 2.5);
      const startedAt = Date.now();
      let idlePolls = 0;
      if (watchdogRef.current != null) clearInterval(watchdogRef.current);
      watchdogRef.current = window.setInterval(() => {
        if (finished || playTokenRef.current !== token) return;
        if (Date.now() - startedAt > capMs) {
          finish();
          return;
        }
        if (synth.speaking) {
          idlePolls = 0;
          // The nudge is a Chromium fix; on Safari pause() can end the
          // utterance outright, so only the end-detection runs there.
          if (NEEDS_SPEECH_NUDGE) {
            synth.pause();
            synth.resume();
          }
          return;
        }
        idlePolls += 1;
        if (idlePolls >= 2) finish();
      }, 5000);
    };

    // Chrome: give the cancel() above a tick to settle before queueing.
    if (synth.getVoices().length > 0) {
      setTimeout(start, 60);
      return;
    }
    // Voices not loaded yet — wait for them, but never hang on it.
    const onVoices = () => {
      synth.removeEventListener('voiceschanged', onVoices);
      clearTimeout(voiceTimeout);
      setTimeout(start, 60);
    };
    const voiceTimeout = setTimeout(() => {
      synth.removeEventListener('voiceschanged', onVoices);
      start();
    }, 1000);
    synth.addEventListener('voiceschanged', onVoices);
  }, []);

  /**
   * Play one key, then drain the queue. Resolves silently on any failure.
   *
   * Every callback below is gated on the playback token it started with, so a
   * clip that has already been stopped or replaced can never revive itself —
   * which is what produced two voices at once.
   */
  const playKey = useCallback(
    (key: VoiceKey, cue: boolean) => {
      const script = getScript(key);
      if (!script) return;
      const text = cue && script.cue ? script.cue : script.text;
      const token = ++playTokenRef.current;

      const finish = () => {
        if (playTokenRef.current !== token) return;
        setSpeakingKey(null);
        const next = queueRef.current.shift();
        if (next) playKey(next, false);
      };

      // Cues have their own clip, `<key>.cue.mp3`; only a missing file falls
      // through to the synthesiser.
      const clipName = clipNameFor(key, cue);
      const manifest = manifestRef.current;
      const hasClip =
        (!cue || script.cue != null) &&
        !missingRef.current.has(clipName) &&
        (manifest === null || manifest.has(clipName));

      if (!hasClip) {
        speakSynthetic(key, text, token, finish);
        return;
      }

      let audio = audioRef.current;
      if (!audio) {
        audio = new Audio();
        audio.preload = 'auto';
        audioRef.current = audio;
      }
      audio.onended = finish;
      audio.onerror = () => {
        if (playTokenRef.current !== token) return;
        // Clip is absent or unplayable — remember, and speak it instead.
        missingRef.current.add(clipName);
        speakSynthetic(key, text, token, finish);
      };
      audio.src = audioUrlForKey(key, cue);
      setSpeakingKey(key);
      audio.play().catch(() => {
        if (playTokenRef.current !== token) return;
        // Blocked (no gesture yet) or decode failure: the synthesiser is
        // subject to the same gate, so hold the request for the first gesture.
        if (!unlockedRef.current) {
          pendingRef.current = { keys: [key, ...queueRef.current], cue };
          setSpeakingKey(null);
          return;
        }
        missingRef.current.add(clipName);
        speakSynthetic(key, text, token, finish);
      });
    },
    [speakSynthetic]
  );

  /** Always the current playKey, for callers that outlive a render. */
  const playKeyRef = useRef(playKey);
  useEffect(() => {
    playKeyRef.current = playKey;
  }, [playKey]);

  const speak = useCallback(
    (key: VoiceKey, options?: SpeakOptions) => {
      if (mutedRef.current) return;
      if (!VOICE_SCRIPTS[key]) return;
      queueRef.current = [];
      stop();
      if (!unlockedRef.current) {
        pendingRef.current = { keys: [key], cue: options?.cue === true };
        return;
      }
      playKey(key, options?.cue === true);
    },
    [playKey, stop]
  );

  const speakSequence = useCallback(
    (keys: VoiceKey[]) => {
      if (mutedRef.current || keys.length === 0) return;
      stop();
      const [first, ...rest] = keys;
      queueRef.current = rest;
      if (!unlockedRef.current) {
        pendingRef.current = { keys, cue: false };
        return;
      }
      playKey(first, false);
    },
    [playKey, stop]
  );

  // --- unlock playback on the first gesture ----------------------------
  useEffect(() => {
    if (unlocked) return;
    const unlock = () => {
      unlockedRef.current = true;
      setUnlocked(true);
      const pending = pendingRef.current;
      if (!pending || mutedRef.current) return;
      // pointerdown lands before click, so the click that unlocked playback may
      // still be about to leave this screen. Defer, then re-check: `stop()`
      // clears pendingRef, which is how a departing screen cancels its clip.
      setTimeout(() => {
        if (pendingRef.current !== pending || mutedRef.current) return;
        pendingRef.current = null;
        const [first, ...rest] = pending.keys;
        queueRef.current = rest;
        playKeyRef.current(first, pending.cue);
      }, 0);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [unlocked]);

  // Muting mid-sentence should stop the sentence.
  useEffect(() => {
    if (muted) stop();
  }, [muted, stop]);

  useEffect(() => () => stop(), [stop]);

  /** Mirrors `speakingKey` so cleanups can read it without re-subscribing. */
  const speakingKeyRef = useRef<VoiceKey | null>(null);
  useEffect(() => {
    speakingKeyRef.current = speakingKey;
  }, [speakingKey]);

  const stopIfSpeaking = useCallback(
    (key: VoiceKey | VoiceKey[]) => {
      const keys = Array.isArray(key) ? key : [key];
      const speaking = speakingKeyRef.current;
      if (speaking !== null && keys.includes(speaking)) {
        stop();
        return;
      }
      // Not started yet, but held for the first gesture — drop it, or it would
      // begin talking on a screen that has already moved on.
      const held = pendingRef.current?.keys[0];
      if (held != null && keys.includes(held)) {
        pendingRef.current = null;
      }
    },
    [stop]
  );

  const registerConsumer = useCallback(() => {
    setConsumerCount((n) => n + 1);
    return () => setConsumerCount((n) => Math.max(0, n - 1));
  }, []);

  const value = useMemo<VoiceContextValue>(
    () => ({
      speak,
      speakSequence,
      stop,
      stopIfSpeaking,
      muted,
      setMuted,
      toggleMuted: () => setMuted(!muted),
      speakingKey,
      unlocked,
      registerConsumer,
      hasConsumers: consumerCount > 0,
    }),
    [
      speak,
      speakSequence,
      stop,
      stopIfSpeaking,
      muted,
      setMuted,
      speakingKey,
      unlocked,
      registerConsumer,
      consumerCount,
    ]
  );

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

/**
 * Speak `key` once when the screen opens, and again if the key changes.
 * Pass null to say nothing (e.g. while a screen is still loading).
 */
export function useVoiceOnMount(key: VoiceKey | null) {
  const voice = useVoice();
  const speak = voice?.speak;
  const register = voice?.registerConsumer;
  useVoiceOwnedClip(key);
  useEffect(() => {
    if (!key || !speak) return;
    speak(key);
  }, [key, speak]);
  useVoiceConsumer(key != null && register != null);
}

/**
 * Ties a clip to the lifetime of the component that plays it: when that
 * component goes away, or moves on to a different key, the clip stops.
 *
 * Without this, a clip outlives its screen — press play on a step preview,
 * click another step or start the assessment, and the old explanation carries
 * on over the top of the next screen.
 */
export function useVoiceOwnedClip(key: VoiceKey | VoiceKey[] | null) {
  const voice = useVoice();
  const stopIfSpeaking = voice?.stopIfSpeaking;
  // An array literal is a new value every render; key the effect on its
  // contents so it does not tear the clip down on each one.
  const fingerprint = Array.isArray(key) ? key.join('|') : key;
  useEffect(() => {
    if (!key || !stopIfSpeaking) return;
    return () => stopIfSpeaking(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint, stopIfSpeaking]);
}

/**
 * Marks the calling screen as one with spoken guidance, so the mute control
 * appears while it is on screen.
 */
export function useVoiceConsumer(active = true) {
  const voice = useVoice();
  const register = voice?.registerConsumer;
  useEffect(() => {
    if (!active || !register) return;
    return register();
  }, [active, register]);
}

/**
 * Repeat the short cue for `key` every `intervalMs` while `active`.
 *
 * By default the first cue comes one full interval after the screen opens, so
 * it never lands on top of separate opening guidance. Pass `immediate` on
 * screens where the cue *is* the guidance — a task that has already started
 * needs telling what to do now, not in twenty seconds.
 */
export function useVoiceRepeat(
  key: VoiceKey | null,
  intervalMs: number,
  active = true,
  { immediate = false }: { immediate?: boolean } = {}
) {
  const voice = useVoice();
  const speak = voice?.speak;
  const muted = voice?.muted ?? true;
  useVoiceConsumer(key != null);
  useVoiceOwnedClip(key);
  useEffect(() => {
    if (!key || !speak || !active || muted || intervalMs <= 0) return;
    if (immediate) speak(key, { cue: true });
    const id = setInterval(() => speak(key, { cue: true }), intervalMs);
    return () => clearInterval(id);
  }, [key, speak, active, muted, intervalMs, immediate]);
}
