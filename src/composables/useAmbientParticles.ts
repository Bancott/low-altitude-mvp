import { onBeforeUnmount, onMounted, type Ref } from 'vue';

type Dust = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  a: number;
  color: string;
  seed: number;
};

type Spark = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
};

export function useAmbientParticles(
  canvas: Ref<HTMLCanvasElement | null>,
  options: { count?: number } = {}
) {
  const count = options.count ?? 58;
  const palette = ['#F5A524', '#FFFFFF', '#9DB4CE'];
  const sparks: Spark[] = [];
  let dust: Dust[] = [];
  let ctx: CanvasRenderingContext2D | null = null;
  let raf = 0;
  let width = 0;
  let height = 0;
  let last = 0;
  let reduced = false;

  function resize(): void {
    const el = canvas.value;
    if (!el || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    width = el.clientWidth || window.innerWidth;
    height = el.clientHeight || window.innerHeight;
    el.width = Math.round(width * dpr);
    el.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function seed(): void {
    dust = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 7,
      vy: (Math.random() - 0.5) * 5,
      r: 0.7 + Math.random() * 1.5,
      a: 0.12 + Math.random() * 0.22,
      color: palette[Math.floor(Math.random() * palette.length)],
      seed: Math.random() * Math.PI * 2
    }));
  }

  function frame(now: number): void {
    if (!ctx) return;
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    ctx.clearRect(0, 0, width, height);

    for (const p of dust) {
      p.seed += dt * 0.35;
      p.x += (p.vx + Math.sin(p.seed) * 3.2) * dt;
      p.y += (p.vy + Math.cos(p.seed * 0.8) * 2.4) * dt;
      if (p.x < -12) p.x = width + 12;
      else if (p.x > width + 12) p.x = -12;
      if (p.y < -12) p.y = height + 12;
      else if (p.y > height + 12) p.y = -12;

      ctx.globalAlpha = p.a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    for (let i = sparks.length - 1; i >= 0; i -= 1) {
      const spark = sparks[i];
      spark.life -= dt * 1000;
      if (spark.life <= 0) {
        sparks.splice(i, 1);
        continue;
      }
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      spark.vy += 30 * dt;
      spark.vx *= 0.982;
      spark.vy *= 0.982;
      ctx.globalAlpha = Math.max(0, spark.life / spark.max) * 0.85;
      ctx.fillStyle = spark.color;
      ctx.beginPath();
      ctx.arc(spark.x, spark.y, spark.size, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  }

  function burst(x: number, y: number, color = '#F5A524'): void {
    if (reduced || !ctx) return;
    for (let i = 0; i < 18; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 26 + Math.random() * 88;
      sparks.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 18,
        life: 520 + Math.random() * 460,
        max: 980,
        color: i % 3 === 0 ? '#FFFFFF' : color,
        size: 0.7 + Math.random() * 1.5
      });
    }
  }

  onMounted(() => {
    const el = canvas.value;
    if (!el) return;
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    ctx = el.getContext('2d');
    if (!ctx) return;
    resize();
    seed();
    window.addEventListener('resize', resize);
    last = performance.now();
    raf = requestAnimationFrame(frame);
  });

  onBeforeUnmount(() => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    ctx = null;
  });

  return { burst };
}
