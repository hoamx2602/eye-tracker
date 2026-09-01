/**
 * Physical screen scale (CSS pixels per centimetre), measured with a bank card.
 *
 * Every angular number the system reports — validation error in degrees, saccade
 * amplitude, peak velocity, BCEA — divides screen pixels by this scale. Until
 * now it was the constant 34.5 cm hard-coded next to a `TODO` in App.tsx, paired
 * with `window.innerWidth`, which is the *viewport* in CSS pixels rather than the
 * monitor. On any display that isn't exactly 34.5 cm wide, or any window that
 * isn't full-screen, the two disagree and every degree is wrong by that ratio.
 *
 * The card trick fixes it without hardware. An ID-1 card — bank card, most
 * national ID cards — is 85.60 × 53.98 mm under ISO/IEC 7810, worldwide, to a
 * tolerance far below what matters here. The participant holds one against the
 * screen and resizes an on-screen rectangle to match; the rectangle's width in
 * CSS pixels then converts directly to pixels per centimetre.
 *
 * Method: Li, Joo, Yeatman & Reinecke (2020), "Controlling for Participants'
 * Viewing Distance in Large-Scale, Psychophysical Online Experiments Using a
 * Virtual Chinrest", Scientific Reports.
 * https://www.nature.com/articles/s41598-019-57204-1
 */

/** ISO/IEC 7810 ID-1 — the bank-card format. */
export const CARD_WIDTH_MM = 85.6;
export const CARD_HEIGHT_MM = 53.98;
export const CARD_ASPECT = CARD_WIDTH_MM / CARD_HEIGHT_MM;

const STORAGE_KEY = 'eyetracker.screenScale.v1';

/**
 * Plausible range for CSS pixels per cm. A 1920-px-wide laptop panel spans
 * roughly 29–35 cm (≈55–66 px/cm); a 4K monitor at devicePixelRatio 2 reports
 * CSS pixels at half density. Values outside this band mean the participant
 * mis-sized the rectangle, and silently accepting one would corrupt every
 * angular measurement downstream while looking perfectly healthy.
 */
export const MIN_PX_PER_CM = 15;
export const MAX_PX_PER_CM = 120;

export interface ScreenScale {
  /** CSS pixels per centimetre. */
  pxPerCm: number;
  /** Width of the on-screen rectangle the participant matched, in CSS px. */
  cardWidthPx: number;
  /** ISO timestamp. */
  measuredAt: string;
  /** Display this was measured on; a different monitor must re-measure. */
  displayKey: string;
}

/**
 * Identity of the current display, as far as the browser will say.
 *
 * Screen dimensions plus device-pixel ratio is not a guarantee — two different
 * monitors can report the same triple — but it reliably catches the common case
 * of moving the app to another machine or docking to an external screen, which
 * is when a stale scale would silently poison the results.
 */
export function displayKey(): string {
  if (typeof window === 'undefined') return 'ssr';
  const dpr = window.devicePixelRatio || 1;
  return `${window.screen?.width ?? 0}x${window.screen?.height ?? 0}@${dpr}`;
}

/** CSS px per cm from the matched rectangle's width. */
export function pxPerCmFromCardWidth(cardWidthPx: number): number {
  return cardWidthPx / (CARD_WIDTH_MM / 10);
}

/** Inverse — the rectangle width that corresponds to a given scale. */
export function cardWidthPxFromPxPerCm(pxPerCm: number): number {
  return pxPerCm * (CARD_WIDTH_MM / 10);
}

export function isPlausibleScale(pxPerCm: number): boolean {
  return Number.isFinite(pxPerCm) && pxPerCm >= MIN_PX_PER_CM && pxPerCm <= MAX_PX_PER_CM;
}

/** Physical width (cm) of the current viewport at a given scale. */
export function viewportWidthCm(pxPerCm: number, widthPx?: number): number {
  const w = widthPx ?? (typeof window !== 'undefined' ? window.innerWidth : 0);
  return w / pxPerCm;
}

// ─── Persistence ─────────────────────────────────────────────────────────────
// Screen scale is a property of the display, not the participant, so it is worth
// keeping between sessions — re-measuring on every run is friction that leads to
// people rushing the step, which is worse than the staleness it avoids.

export function loadScreenScale(): ScreenScale | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ScreenScale;
    if (!isPlausibleScale(parsed?.pxPerCm)) return null;
    // A scale from a different display is worse than none: it looks valid and
    // is wrong by an unknown factor.
    if (parsed.displayKey !== displayKey()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveScreenScale(cardWidthPx: number): ScreenScale | null {
  const pxPerCm = pxPerCmFromCardWidth(cardWidthPx);
  if (!isPlausibleScale(pxPerCm)) return null;
  const scale: ScreenScale = {
    pxPerCm,
    cardWidthPx,
    measuredAt: new Date().toISOString(),
    displayKey: displayKey(),
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(scale));
  } catch {
    /* private mode / quota — the value still works for this session */
  }
  return scale;
}

export function clearScreenScale(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
