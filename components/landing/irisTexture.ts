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

