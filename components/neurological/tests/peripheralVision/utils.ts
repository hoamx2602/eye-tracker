import type { PeripheralZone } from './constants';
import { ZONE_POSITIONS } from './constants';

const ZONES: PeripheralZone[] = ['top', 'bottom', 'left', 'right'];

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Generate trial order: random sequence of zones (each zone repeated trialCount/4 times, then shuffled).
 */
export function generateTrialZones(trialCount: number): PeripheralZone[] {
  const perZone = Math.ceil(trialCount / ZONES.length);
  const pool: PeripheralZone[] = [];
  for (let i = 0; i < perZone; i++) {
    pool.push(...ZONES);
  }
  return shuffle(pool).slice(0, trialCount);
}

/**
 * Position of stimulus in screen pixels.
 */
export function getStimulusPosition(
  zone: PeripheralZone,
  viewportWidth: number,
  viewportHeight: number
): { x: number; y: number } {
  const p = ZONE_POSITIONS[zone];
  return {
    x: p.x * viewportWidth,
    y: p.y * viewportHeight,
  };
}
