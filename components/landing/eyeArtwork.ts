import { drawAtmosphere, drawNeuralEye, drawSatellites } from './eyeAtmosphere';
export { createIrisTexture } from './irisTexture';
const TAU = Math.PI * 2;

export interface EyeMotion {
  time: number;
  gaze: { x: number; y: number };
  reaction: number;
  neural: number;
  intro: number;
  scroll: number;
  pointer: { x: number; y: number; visible: number };
}

function contour(ctx: CanvasRenderingContext2D, spread: number, openness: number, side: number) {
  for (let j = 0; j <= 90; j++) {
    const f = j / 90;
    const x = -313 + f * 626;
    const y = (side * Math.pow(Math.sin(f * Math.PI), .88) * (140 + spread) + Math.sin(f * TAU) * 9) * openness;
    if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
}

export function drawEye(ctx: CanvasRenderingContext2D, iris: HTMLCanvasElement, motion: EyeMotion, width: number, height: number) {
  const { time, gaze, reaction, neural, intro, scroll, pointer } = motion;
  ctx.clearRect(0, 0, width, height);
  const pulse = reaction >= 0 && reaction < 1 ? Math.sin(reaction * Math.PI) * (1 - reaction) : 0;
  drawAtmosphere(ctx, width, height, time, gaze, neural + pulse);
  const scale = (width <= 640 ? Math.min(width / 445, height / 470) : Math.min(width / 710, height / 460)) * (1.07 - intro * .07) * (1 - scroll * .28);
  ctx.save(); ctx.translate(width / 2, height * (.455 - scroll * .05)); ctx.scale(scale, scale);
  ctx.globalAlpha = Math.min(1, intro * 2) * (1 - scroll * .6);
  // Mild perspective: the entire sculpture responds, not just its pupil.
  ctx.transform(1, gaze.y * .0006, -gaze.x * .001, 1, gaze.x * .25, gaze.y * .18);
  const glow = ctx.createRadialGradient(0, 0, 30, 0, 0, 310);
  glow.addColorStop(0, `rgba(37,99,235,${.1 + pulse * .17})`);
  glow.addColorStop(.6, '#2563eb0d'); glow.addColorStop(1, '#11182700');
  ctx.fillStyle = glow; ctx.fillRect(-360, -310, 720, 620);
  drawSatellites(ctx, time, neural + pulse);

  const blinkPhase = time % 9;
  const blink = blinkPhase > 7.8 && blinkPhase < 8.12 ? 1 - Math.sin((blinkPhase - 7.8) / .32 * Math.PI) * .98 : 1;
  const openness = blink * Math.min(1, intro * 2.5);
  ctx.save(); ctx.globalAlpha *= 1 - neural * .65;
  for (let layer = 17; layer >= 0; layer--) {
    for (const side of [-1, 1]) {
      ctx.beginPath(); contour(ctx, layer * 3.2, openness, side);
      ctx.strokeStyle = `rgba(115,174,255,${layer === 0 ? .65 : .13 * (1 - layer / 21)})`;
      ctx.lineWidth = layer === 0 ? .8 : .5; ctx.stroke();
    }
  }
  ctx.restore();

  ctx.save(); ctx.beginPath(); contour(ctx, 0, openness, -1);
  for (let j = 90; j >= 0; j--) {
    const f = j / 90;
    ctx.lineTo(-313 + f * 626, (Math.pow(Math.sin(f * Math.PI), .88) * 140 + Math.sin(f * TAU) * 9) * openness);
  }
  ctx.closePath(); ctx.clip();
  ctx.translate(gaze.x, gaze.y);
  const breath = 1 + Math.sin(time * .65) * .012 + pulse * .035;
  ctx.scale(breath, breath);
  ctx.save(); ctx.globalAlpha *= 1 - neural * .78;
  ctx.rotate(Math.sin(time * .15) * .04);
  ctx.shadowColor = '#3b82f670'; ctx.shadowBlur = 27;
  ctx.drawImage(iris, -158, -158, 316, 316); ctx.shadowBlur = 0;
  // A moving sheen over the fibers gives the iris a curved, wet surface.
  const light = ctx.createRadialGradient(-45 - gaze.x, -50 - gaze.y, 0, -25, -30, 165);
  light.addColorStop(0, '#a4dcff36'); light.addColorStop(.65, '#60a5fa05'); light.addColorStop(1, '#02061780');
  ctx.fillStyle = light; ctx.beginPath(); ctx.arc(0, 0, 145, 0, TAU); ctx.fill();
  ctx.restore();
  const pupilRadius = 39 + Math.sin(time * .52) * 2 - pulse * 13;
  const pupil = ctx.createRadialGradient(-9, -10, 3, 0, 0, pupilRadius);
  pupil.addColorStop(0, '#0c1a35'); pupil.addColorStop(.8, '#020611'); pupil.addColorStop(1, '#142747');
  ctx.fillStyle = pupil; ctx.beginPath(); ctx.arc(0, 0, pupilRadius, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#b9e2ff60'; ctx.lineWidth = .65; ctx.stroke();
  ctx.fillStyle = `rgba(225,241,255,${.8 * (1 - neural)})`;
  ctx.beginPath(); ctx.ellipse(-27 - gaze.x * .16, -32 - gaze.y * .16, 7, 2.8, -.6, 0, TAU); ctx.fill();
  ctx.restore();

  drawNeuralEye(ctx, time, Math.max(neural, (1 - intro) * .8), pulse, gaze);
  if (reaction >= 0 && reaction < 1) {
    for (let ring = 0; ring < 3; ring++) {
      const progress = Math.max(0, reaction - ring * .1);
      ctx.strokeStyle = `rgba(135,206,255,${Math.sin(progress * Math.PI) * (1 - progress) * .7})`;
      ctx.lineWidth = 1 - ring * .2;
      ctx.beginPath(); ctx.ellipse(gaze.x, gaze.y, 65 + progress * 310, 65 + progress * 130, 0, 0, TAU); ctx.stroke();
    }
  }
  ctx.restore();
  if (pointer.visible > .01) {
    // A small halo makes pointer interaction discoverable without extra copy.
    ctx.strokeStyle = `rgba(147,197,253,${pointer.visible * .5})`;
    ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(pointer.x, pointer.y, 15 + pulse * 12, 0, TAU); ctx.stroke();
    ctx.fillStyle = `rgba(219,234,254,${pointer.visible * .8})`;
    ctx.beginPath(); ctx.arc(pointer.x, pointer.y, 2, 0, TAU); ctx.fill();
  }
}
