/** Procedural artwork only: no camera access or assessment data. */
const TAU = Math.PI * 2;

function seededRandom(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export function createIrisTexture() {
  const texture = document.createElement('canvas');
  texture.width = texture.height = 800;
  const ctx = texture.getContext('2d');
  if (!ctx) return texture;
  const random = seededRandom(82);
  ctx.translate(400, 400);
  const base = ctx.createRadialGradient(0, 0, 90, 0, 0, 365);
  base.addColorStop(0, '#0a1225');
  base.addColorStop(.12, '#7d9ec1');
  base.addColorStop(.29, '#3769a6');
  base.addColorStop(.6, '#294f92');
  base.addColorStop(.88, '#142e5a');
  base.addColorStop(1, '#0c182f');
  ctx.fillStyle = base;
  ctx.beginPath(); ctx.arc(0, 0, 365, 0, TAU); ctx.fill();

  // Fine, irregular filaments give the iris depth without an image download.
  for (let i = 0; i < 2200; i++) {
    const angle = random() * TAU;
    const start = 75 + random() * 38;
    const end = 310 + random() * 51;
    const phase = random() * TAU;
    const light = 29 + random() * 38;
    ctx.strokeStyle = `hsla(${207 + random() * 22}, ${42 + random() * 30}%, ${light}%, ${.17 + random() * .5})`;
    ctx.lineWidth = .4 + random() * 1.6;
    ctx.beginPath();
    for (let j = 0; j <= 30; j++) {
      const radius = start + (end - start) * j / 30;
      const wobble = Math.sin(j * .64 + phase) * .009 + Math.sin(j * .27 + phase) * .022;
      const x = Math.cos(angle + wobble) * radius;
      const y = Math.sin(angle + wobble) * radius;
      if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 400; i++) {
    const angle = i / 400 * TAU;
    const inner = 76 + random() * 12;
    const outer = 144 + random() * 54;
    ctx.strokeStyle = `rgba(156, 196, 238, ${.1 + random() * .5})`;
    ctx.lineWidth = random() * 1.5;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
    ctx.quadraticCurveTo(Math.cos(angle + .035) * 140, Math.sin(angle + .035) * 140, Math.cos(angle) * outer, Math.sin(angle) * outer);
    ctx.stroke();
  }
  const highlight = ctx.createRadialGradient(-115, -140, 0, -115, -140, 160);
  highlight.addColorStop(0, '#cae1ff38'); highlight.addColorStop(1, '#cae1ff00');
  ctx.fillStyle = highlight; ctx.beginPath(); ctx.arc(-115, -140, 160, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#e0efff50'; ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(0, 0, 270, 3.8, 4.12); ctx.stroke();
  return texture;
}

const particleRandom = seededRandom(131);
const particles = Array.from({ length: 85 }, () => ({ x: particleRandom(), y: particleRandom(), size: .4 + particleRandom() * 1.1, phase: particleRandom() * TAU }));

function eyeContour(ctx: CanvasRenderingContext2D, spread: number, openness: number, side: number) {
  for (let j = 0; j <= 100; j++) {
    const fraction = j / 100;
    const x = -313 + fraction * 626;
    const arch = Math.pow(Math.sin(fraction * Math.PI), .88);
    const y = (side * arch * (140 + spread) + Math.sin(fraction * TAU) * 9) * openness;
    if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
}

export function drawEye(
  ctx: CanvasRenderingContext2D,
  iris: HTMLCanvasElement,
  time: number,
  gaze: { x: number; y: number },
  reaction: number,
  width: number,
  height: number,
) {
  ctx.clearRect(0, 0, width, height);
  // A closer crop on portrait screens keeps the iris prominent at phone sizes.
  const scale = width <= 640
    ? Math.min(width / 445, height / 470)
    : Math.min(width / 670, height / 445);
  const centerX = width / 2;
  const centerY = height * .46;
  for (const point of particles) {
    const x = point.x * width + Math.sin(time * .12 + point.phase) * 10 + gaze.x * .2;
    const y = point.y * height + Math.cos(time * .1 + point.phase) * 8;
    ctx.fillStyle = `rgba(147, 197, 253, ${.12 + .09 * Math.sin(time * .5 + point.phase)})`;
    ctx.beginPath(); ctx.arc(x, y, point.size, 0, TAU); ctx.fill();
  }
  ctx.save(); ctx.translate(centerX, centerY); ctx.scale(scale, scale);
  ctx.translate(gaze.x * .12, gaze.y * .12);
  const glow = ctx.createRadialGradient(0, 0, 20, 0, 0, 295);
  glow.addColorStop(0, '#3b82f617'); glow.addColorStop(.58, '#2563eb0b'); glow.addColorStop(1, '#11182700');
  ctx.fillStyle = glow; ctx.fillRect(-360, -310, 720, 620);

  for (let ring = 0; ring < 3; ring++) {
    ctx.save(); ctx.rotate(-.28 + ring * .31 + Math.sin(time * .07) * .05);
    ctx.strokeStyle = `rgba(96, 165, 250, ${.075 - ring * .014})`;
    ctx.lineWidth = .5;
    ctx.beginPath(); ctx.ellipse(0, 0, 278 + ring * 23, 185 - ring * 18, 0, 0, TAU); ctx.stroke();
    const angle = time * .09 + ring * 2.1;
    ctx.fillStyle = '#93c5fd90';
    ctx.beginPath(); ctx.arc(Math.cos(angle) * (278 + ring * 23), Math.sin(angle) * (185 - ring * 18), 1.35, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // Blink the lids over the iris; the iris itself keeps its circular shape.
  const blinkPhase = time % 9;
  const openness = blinkPhase > 7.8 && blinkPhase < 8.12 ? 1 - Math.sin((blinkPhase - 7.8) / .32 * Math.PI) * .98 : 1;
  for (let layer = 18; layer >= 0; layer--) {
    const spread = layer * 3;
    const alpha = .26 * (1 - layer / 22);
    for (const side of [-1, 1]) {
      ctx.beginPath(); eyeContour(ctx, spread, openness, side);
      ctx.strokeStyle = `rgba(105, 167, 250, ${alpha * (layer === 0 ? 2.5 : .55)})`;
      ctx.lineWidth = layer === 0 ? .9 : .45;
      ctx.stroke();
      for (let j = 1; j < 65; j++) {
        const fraction = j / 65;
        const x = -313 + fraction * 626;
        const y = (side * Math.pow(Math.sin(fraction * Math.PI), .88) * (140 + spread) + Math.sin(fraction * TAU) * 9) * openness;
        ctx.fillStyle = `rgba(147, 197, 253, ${alpha * (.6 + .4 * Math.sin(j * 2 + time * .45))})`;
        ctx.beginPath(); ctx.arc(x, y, .55 + (j % 3) * .13, 0, TAU); ctx.fill();
      }
    }
  }

  ctx.save();
  // Closed almond path clips the artwork during a blink and near the eyelids.
  ctx.beginPath();
  eyeContour(ctx, 0, openness, -1);
  for (let j = 100; j >= 0; j--) {
    const f = j / 100;
    ctx.lineTo(-313 + f * 626, (Math.pow(Math.sin(f * Math.PI), .88) * 140 + Math.sin(f * TAU) * 9) * openness);
  }
  ctx.closePath(); ctx.clip();
  ctx.translate(gaze.x, gaze.y);
  const strength = reaction >= 0 && reaction < 1 ? Math.sin(reaction * Math.PI) * Math.exp(-reaction * 2) : 0;
  const breath = 1 + Math.sin(time * .65) * .009;
  ctx.scale(breath, breath);
  ctx.rotate(Math.sin(time * .15) * .025);
  ctx.shadowColor = '#3b82f65a'; ctx.shadowBlur = 23;
  ctx.drawImage(iris, -158, -158, 316, 316);
  ctx.shadowBlur = 0;
  const pupilRadius = 40 + Math.sin(time * .52) * 1.8 - strength * 13;
  const pupil = ctx.createRadialGradient(-9, -10, 3, 0, 0, pupilRadius);
  pupil.addColorStop(0, '#0b1528'); pupil.addColorStop(.88, '#030812'); pupil.addColorStop(1, '#0b1525');
  ctx.fillStyle = pupil;
  ctx.beginPath(); ctx.arc(0, 0, pupilRadius, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#93c5fd30'; ctx.lineWidth = .6; ctx.stroke();
  ctx.strokeStyle = '#93c5fd20'; ctx.beginPath(); ctx.arc(0, 0, 145, 0, TAU); ctx.stroke();
  const reflectionX = -27 - gaze.x * .16;
  const reflectionY = -32 - gaze.y * .16;
  ctx.fillStyle = '#e6efffc0';
  ctx.beginPath(); ctx.ellipse(reflectionX, reflectionY, 7, 2.8, -.6, 0, TAU); ctx.fill();
  ctx.fillStyle = '#e6efff30'; ctx.beginPath(); ctx.arc(24, 30, 1.6, 0, TAU); ctx.fill();
  ctx.restore();

  if (reaction >= 0 && reaction < 1) {
    for (let ring = 0; ring < 2; ring++) {
      const progress = Math.max(0, reaction - ring * .12);
      ctx.strokeStyle = `rgba(96, 165, 250, ${Math.sin(progress * Math.PI) * (1 - progress) * .34})`;
      ctx.lineWidth = .7;
      ctx.beginPath(); ctx.ellipse(gaze.x, gaze.y, 145 + progress * 165, 145 + progress * 55, 0, 0, TAU); ctx.stroke();
    }
  }
  ctx.restore();
}
