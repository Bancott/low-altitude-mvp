import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'node_modules/cesium/Build/Cesium');
const target = resolve(root, 'public/cesium');
const folders = ['Assets', 'Workers', 'Widgets', 'ThirdParty'];

if (!existsSync(source)) {
  console.warn('[cesium] Build/Cesium not found. Run npm install first.');
  process.exit(0);
}

mkdirSync(target, { recursive: true });

for (const folder of folders) {
  const from = resolve(source, folder);
  const to = resolve(target, folder);
  if (!existsSync(from)) continue;
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  console.log(`[cesium] copied ${folder}`);
}
