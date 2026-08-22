/**
 * Freeze the webcam's automatic image adjustments for the duration of a session.
 *
 * Why this matters for accuracy, not just for looks: the offline gaze model is
 * appearance-based, so a change in exposure or white balance IS a change in its
 * input. Auto-exposure reacts to the calibration dot itself — a bright dot in a
 * screen corner lights the face differently from one in the centre — so the
 * camera's own automation injects a bias that is *correlated with target
 * position*, which is the worst kind: the calibration fit absorbs it as if it
 * were gaze. Auto-focus hunting and auto-white-balance drift do the same thing
 * more slowly over a session.
 *
 * Everything here is best-effort. Support for these constraints is patchy
 * (Chrome/Android and ChromeOS expose them for many devices; desktop UVC webcams
 * often expose none), so each lock is applied independently and a rejection is
 * recorded rather than thrown — a camera that cannot be locked must still work.
 */

/** Capability/settings shapes the standard DOM types don't declare yet. */
interface ExtendedCapabilities extends MediaTrackCapabilities {
  exposureMode?: string[];
  focusMode?: string[];
  whiteBalanceMode?: string[];
  exposureTime?: { min: number; max: number; step?: number };
  focusDistance?: { min: number; max: number; step?: number };
  colorTemperature?: { min: number; max: number; step?: number };
}

interface ExtendedSettings extends MediaTrackSettings {
  exposureMode?: string;
  focusMode?: string;
  whiteBalanceMode?: string;
  exposureTime?: number;
  focusDistance?: number;
  colorTemperature?: number;
}

export interface CameraLockResult {
  /** Controls that are now pinned, e.g. ['exposure', 'whiteBalance']. */
  locked: string[];
  /** Controls the device does not expose as manual. */
  unsupported: string[];
  /** Controls that were supported but whose applyConstraints() rejected. */
  failed: string[];
  /** Actual resolution and frame rate the driver settled on. */
  settings: { width?: number; height?: number; frameRate?: number };
}

type LockSpec = {
  name: string;
  modeKey: 'exposureMode' | 'focusMode' | 'whiteBalanceMode';
  valueKey: 'exposureTime' | 'focusDistance' | 'colorTemperature';
};

const LOCKS: LockSpec[] = [
  { name: 'exposure',     modeKey: 'exposureMode',     valueKey: 'exposureTime' },
  { name: 'focus',        modeKey: 'focusMode',        valueKey: 'focusDistance' },
  { name: 'whiteBalance', modeKey: 'whiteBalanceMode', valueKey: 'colorTemperature' },
];

/** Clamp v into the capability range, snapping to `step` when the device declares one. */
function clampToRange(v: number, range: { min: number; max: number; step?: number }): number {
  const clamped = Math.min(range.max, Math.max(range.min, v));
  if (!range.step || range.step <= 0) return clamped;
  const snapped = range.min + Math.round((clamped - range.min) / range.step) * range.step;
  return Math.min(range.max, Math.max(range.min, snapped));
}

/**
 * Switch exposure / focus / white balance to manual, pinned at whatever the
 * camera had auto-negotiated at call time.
 *
 * Call this *after* the stream has been running long enough for auto-exposure to
 * settle (a second or so) and *before* calibration starts — locking onto a value
 * from the first frame pins a half-converged exposure for the whole session.
 */
export async function lockCameraAutoAdjustments(track: MediaStreamTrack): Promise<CameraLockResult> {
  const caps = (track.getCapabilities?.() ?? {}) as ExtendedCapabilities;
  const settings = (track.getSettings?.() ?? {}) as ExtendedSettings;

  const result: CameraLockResult = {
    locked: [],
    unsupported: [],
    failed: [],
    settings: {
      width: settings.width,
      height: settings.height,
      frameRate: settings.frameRate,
    },
  };

  for (const { name, modeKey, valueKey } of LOCKS) {
    const modes = caps[modeKey];
    if (!Array.isArray(modes) || !modes.includes('manual')) {
      result.unsupported.push(name);
      continue;
    }

    // Pin the current auto-negotiated value where the device exposes one, so
    // switching to manual holds the present look instead of jumping to a driver
    // default. Where it doesn't, 'manual' alone at least stops the drift.
    const constraint: Record<string, unknown> = { [modeKey]: 'manual' };
    const range = caps[valueKey];
    const current = settings[valueKey];
    if (range && typeof current === 'number') {
      constraint[valueKey] = clampToRange(current, range);
    }

    try {
      await track.applyConstraints({ advanced: [constraint] as unknown as MediaTrackConstraintSet[] });
      result.locked.push(name);
    } catch {
      result.failed.push(name);
    }
  }

  return result;
}

/** One-line summary for the console/session log. */
export function describeCameraLock(r: CameraLockResult): string {
  const { width, height, frameRate } = r.settings;
  const res = width && height ? `${width}×${height}` : 'unknown resolution';
  const fps = frameRate ? `@${Math.round(frameRate)}fps` : '';
  const parts = [`${res}${fps}`];
  if (r.locked.length) parts.push(`locked: ${r.locked.join(', ')}`);
  if (r.failed.length) parts.push(`failed: ${r.failed.join(', ')}`);
  if (r.unsupported.length) parts.push(`not supported: ${r.unsupported.join(', ')}`);
  return parts.join(' | ');
}
