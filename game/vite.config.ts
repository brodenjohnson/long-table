import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const version = readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim();

export default defineConfig({
  base: './',
  define: { __VERSION__: JSON.stringify(version) },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  server: { port: 5173 }
});
