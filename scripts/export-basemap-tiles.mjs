import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * 从本地 TileServer GL 导出静态 PNG 瓦片，供 Cesium / Vite public 直接使用。
 * 需要先启动 TileServer GL（端口 8080）。
 * 运行：node scripts/export-basemap-tiles.mjs
 */

const STYLES = ['paper', 'azure', 'slate', 'contrast', 'midnight', 'night'];
const BOUNDS = { w: 113.82, e: 114.03, s: 22.44, n: 22.62 };
const MAX_ZOOM = Number(process.env.TILE_MAX_ZOOM || 16);
const OUT = path.resolve('public/basemap');
const BASE = process.env.TILE_SERVER ?? 'http://localhost:8080';

function tileRange(z) {
  const n = 2 ** z;
  const x = (lon) => Math.floor(((lon + 180) / 360) * n);
  const y = (lat) => {
    const rad = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  };
  return { x0: x(BOUNDS.w), x1: x(BOUNDS.e), y0: y(BOUNDS.n), y1: y(BOUNDS.s) };
}

const tasks = [];
for (const style of STYLES) {
  for (let z = 0; z <= MAX_ZOOM; z += 1) {
    const { x0, x1, y0, y1 } = tileRange(z);
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        tasks.push({ style, z, x, y });
      }
    }
  }
}

let done = 0;
let bytes = 0;
let failed = 0;

async function fetchTile(task) {
  const dir = path.join(OUT, `low-altitude-${task.style}`, String(task.z), String(task.x));
  const file = path.join(dir, `${task.y}.png`);
  try {
    const existing = await fs.stat(file);
    if (existing.size > 0) {
      done += 1;
      bytes += existing.size;
      return;
    }
  } catch {
    // not cached
  }
  await fs.mkdir(dir, { recursive: true });
  const url = `${BASE}/styles/low-altitude-${task.style}/${task.z}/${task.x}/${task.y}.png`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(file, buf);
      done += 1;
      bytes += buf.length;
      return;
    } catch (err) {
      if (attempt === 2) {
        failed += 1;
        console.error('FAILED', url, String(err));
      }
    }
  }
}

const queue = [...tasks];
const workers = Array.from({ length: 4 }, async () => {
  while (queue.length) {
    const task = queue.shift();
    if (task) await fetchTile(task);
    if (done % 40 === 0 || done === tasks.length) {
      console.log(`progress ${done}/${tasks.length} ${(bytes / 1048576).toFixed(1)} MB failed=${failed}`);
    }
  }
});
await Promise.all(workers);
console.log(`exported ${done}/${tasks.length}, ${(bytes / 1048576).toFixed(1)} MB, failed=${failed}`);
