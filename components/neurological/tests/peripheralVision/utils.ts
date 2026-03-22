import type { PeripheralZone } from './constants';
import { PERIPHERAL_STIMULUS_MARGIN_FRAC, ZONE_POSITIONS } from './constants';

/**
 * Một điểm ngẫu nhiên trên ellipse lớn trong viewport (gần rìa màn hình).
 * Góc θ ~ U(0, 2π) — vị trí peripheral đồng nhất theo hướng.
 */
export function randomPeripheralStimulusPosition(
  viewportWidth: number,
  viewportHeight: number,
  marginFrac: number = PERIPHERAL_STIMULUS_MARGIN_FRAC
): { x: number; y: number } {
  const w = Math.max(1, viewportWidth);
  const h = Math.max(1, viewportHeight);
  const mx = Math.min(0.45, Math.max(0.06, marginFrac));
  const my = Math.min(0.45, Math.max(0.06, marginFrac));
  const cx = w / 2;
  const cy = h / 2;
  const a = cx - mx * w;
  const b = cy - my * h;
  const theta = Math.random() * Math.PI * 2;
  return {
    x: cx + a * Math.cos(theta),
    y: cy + b * Math.sin(theta),
  };
}

/** Legacy: vị trí pixel từ zone cố định. */
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

/**
 * Vị trí stimulus cho một trial (run mới: stimulusX/Y; run cũ: stimulusPosition).
 */
export function getTrialStimulusPixelPosition(
  tr: { stimulusX?: number; stimulusY?: number; stimulusPosition?: PeripheralZone },
  viewportWidth: number,
  viewportHeight: number
): { x: number; y: number } {
  if (typeof tr.stimulusX === 'number' && typeof tr.stimulusY === 'number') {
    return { x: tr.stimulusX, y: tr.stimulusY };
  }
  if (tr.stimulusPosition) {
    return getStimulusPosition(tr.stimulusPosition, viewportWidth, viewportHeight);
  }
  return { x: viewportWidth / 2, y: viewportHeight * 0.18 };
}

/** Góc từ tâm màn hình tới stimulus (độ), 0° = phải, ngược chiều kim đồng hồ dương. */
export function stimulusAngleDegFromCenter(
  tr: { stimulusX?: number; stimulusY?: number; stimulusPosition?: PeripheralZone },
  viewportWidth: number,
  viewportHeight: number
): number {
  const { x, y } = getTrialStimulusPixelPosition(tr, viewportWidth, viewportHeight);
  const cx = viewportWidth / 2;
  const cy = viewportHeight / 2;
  return (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
}
