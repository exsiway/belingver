// The popup's backdrop: particles drifting up over the CSS planet
// (popup.css, .planet). Drawn on a canvas inside the extension, nothing is
// loaded. Stops while the popup is hidden; one still frame under reduced
// motion.

const COLORS = ['#a78bfa', '#818cf8', '#f472b6', '#c4b5fd', '#e9d5ff'];
const COUNT = 70;

export function startSpace(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  let width = 0;
  let height = 0;
  let dots = [];

  const spawn = (fromBottom) => ({
    x: Math.random() * width,
    y: fromBottom ? height + 4 : Math.random() * height,
    r: 0.6 + Math.random() * 1.6,
    v: 6 + Math.random() * 14, // px per second, upward
    drift: (Math.random() - 0.5) * 6,
    phase: Math.random() * Math.PI * 2,
    twinkle: 0.6 + Math.random() * 1.2,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  });

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    // The popup is as tall as its content: size to the body, not the viewport.
    const host = canvas.parentElement ?? document.body;
    width = host.clientWidth;
    height = host.offsetHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!dots.length) dots = Array.from({ length: COUNT }, () => spawn(false));
  };

  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ctx.clearRect(0, 0, width, height);
    for (let i = 0; i < dots.length; i += 1) {
      const d = dots[i];
      d.y -= d.v * dt;
      d.x += d.drift * dt;
      d.phase += d.twinkle * dt;
      if (d.y < -4 || d.x < -4 || d.x > width + 4) dots[i] = spawn(true);
      // Brighter near the planet's glow at the bottom, fainter high up.
      const depth = Math.max(0, Math.min(1, d.y / height));
      const alpha = (0.25 + 0.55 * depth) * (0.65 + 0.35 * Math.sin(d.phase));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = d.color;
      ctx.shadowColor = d.color;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  };

  let raf = null;
  const loop = (now) => { frame(now); raf = requestAnimationFrame(loop); };
  const run = () => {
    if (raf !== null || still) return;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  };
  const stop = () => { if (raf !== null) cancelAnimationFrame(raf); raf = null; };

  resize();
  window.addEventListener('resize', resize);
  frame(performance.now());
  if (!still) {
    run();
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : run()));
  }
}
