import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@main': resolve(__dirname, 'src/main'),
  '@renderer': resolve(__dirname, 'src/renderer/src'),
};

/** Strict Content-Security-Policy injected into the production renderer (dev needs inline HMR scripts). */
const cspPlugin = {
  name: 'pharmadesk-csp',
  apply: 'build' as const,
  transformIndexHtml(html: string) {
    const csp = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-src 'self' blob: data:",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join('; ');
    return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`);
  },
};

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      outDir: 'out/main',
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } },
    },
  },
  preload: {
    resolve: { alias },
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias },
    plugins: [react(), tailwindcss(), cspPlugin],
    base: './',
    build: {
      outDir: 'out/renderer',
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
      chunkSizeWarningLimit: 2500,
    },
    server: { port: 5173, strictPort: false },
  },
});
