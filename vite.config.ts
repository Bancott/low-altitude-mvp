import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// GitHub Pages 项目页部署在 /<repo>/ 下；通过 VITE_BASE_PATH 注入。
// 本地开发默认 /，用户主页仓库（<user>.github.io）也使用 /。
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
const base = env?.VITE_BASE_PATH || '/';

export default defineConfig({
  base,
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 3000
  }
});
