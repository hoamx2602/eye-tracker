const TAU = Math.PI * 2;
const fract = (n: number) => n - Math.floor(n);
const random = (n: number) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453);

const stars = Array.from({ length: 115 }, (_, i) => ({
  x: random(i), y: random(i + 221), depth: .25 + random(i + 91) * .75,
}));

/** An almond-shaped constellation with deterministic positions. */
const neurons = Array.from({ length: 460 }, (_, i) => {
  const angle = random(i + 32) * TAU;
  const radius = 48 + random(i + 741) * 103;
  const iris = i < 270;
  const x = iris ? Math.cos(angle) * radius : (random(i + 122) - .5) * 622;
  const arch = Math.pow(Math.max(0, Math.cos(x / 313 * Math.PI / 2)), .88);
  const y = iris ? Math.sin(angle) * radius : (i % 2 ? 1 : -1) * arch * (143 + random(i + 14) * 32);
  return { x, y, angle, phase: random(i + 811) * TAU, radius, iris };
});
const links = neurons.map((point, index) => neurons
  .filter((_, otherIndex) => otherIndex !== index)
  .map((other) => ({ other, distance: Math.hypot(other.x - point.x, other.y - point.y) }))
  .filter(({ distance }) => distance < 42)
  .sort((a, b) => a.distance - b.distance)
  .slice(0, 3));

export function drawAtmosphere(ctx: CanvasRenderingContext2D, width: number, height: number, time: number, gaze: { x: number; y: number }, energy: number) {
  for (const star of stars) {
    const x = star.x * width + (gaze.x * 1.2 + Math.sin(time * .1 + star.y * 8) * 14) * star.depth;
    const y = star.y * height + (gaze.y + Math.cos(time * .13 + star.x * 8) * 10) * star.depth;
    ctx.fillStyle = `rgba(150,195,255,${(.12 + energy * .16) * star.depth})`;
    ctx.beginPath(); ctx.arc(x, y, star.depth * 1.5, 0, TAU); ctx.fill();
  }
  // Broad, very faint flowing ribbons give the negative space depth.
  for (let band = 0; band < 12; band++) {
    ctx.beginPath();
    for (let i = 0; i <= 70; i++) {
      const x = i / 70 * width;
      const y = height * (.46 + .17 * Math.sin(i / 70 * TAU + time * .08)) + band * 8 - 48;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(69,133,236,${.015 + energy * .009})`;
    ctx.lineWidth = .65; ctx.stroke();
  }
}

export function drawNeuralEye(ctx: CanvasRenderingContext2D, time: number, amount: number, pulse: number, gaze: { x: number; y: number }) {
  if (amount < .005) return;
  ctx.save();
  const spread = (1 - amount) * 70;
  neurons.forEach((node, i) => {
    const drift = Math.sin(time * .45 + node.phase) * 2;
    const x = node.x + Math.cos(node.angle) * spread + (node.iris ? gaze.x : 0);
    const y = node.y + Math.sin(node.angle) * spread + drift + (node.iris ? gaze.y : 0);
    links[i].forEach(({ other }) => {
      ctx.strokeStyle = `rgba(79,151,255,${amount * (.2 + pulse * .2)})`;
      ctx.lineWidth = .45;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(other.x + Math.cos(other.angle) * spread + (other.iris ? gaze.x : 0), other.y + Math.sin(other.angle) * spread + Math.sin(time * .45 + other.phase) * 2 + (other.iris ? gaze.y : 0)); ctx.stroke();
    });
    const wave = .5 + .5 * Math.sin(node.angle * 3 - time * 1.4 + node.radius * .035);
    ctx.fillStyle = `rgba(${130 + wave * 100},${185 + wave * 60},255,${amount * (.3 + wave * .65)})`;
    ctx.beginPath(); ctx.arc(x, y, .55 + wave * 1.1 + pulse, 0, TAU); ctx.fill();
    if (wave > .94 && i % 4 === 0) {
      ctx.fillStyle = `rgba(96,165,250,${amount * .11})`;
      ctx.beginPath(); ctx.arc(x, y, 5 + pulse * 5, 0, TAU); ctx.fill();
    }
  });
  ctx.restore();
}

export function drawSatellites(ctx: CanvasRenderingContext2D, time: number, energy: number) {
  for (let ring = 0; ring < 3; ring++) {
    ctx.save(); ctx.rotate(-.4 + ring * .37 + Math.sin(time * .13) * .08);
    const rx = 252 + ring * 38;
    const ry = 171 - ring * 17;
    ctx.strokeStyle = `rgba(96,165,250,${.1 + energy * .07})`;
    ctx.lineWidth = .5;
    ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, TAU); ctx.stroke();
    const angle = time * (.13 + ring * .045) + ring * 2.1;
    // The short luminous trail moves with its satellite.
    for (let tail = 0; tail < 22; tail++) {
      const a = angle - tail * .008;
      ctx.fillStyle = `rgba(164,214,255,${(1 - tail / 22) * .8})`;
      ctx.beginPath(); ctx.arc(Math.cos(a) * rx, Math.sin(a) * ry, 1.3 - tail * .035, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
}
