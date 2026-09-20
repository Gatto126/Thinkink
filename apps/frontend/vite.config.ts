import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const fromFrontend = (path: string) =>
  fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root: fromFrontend('.'),
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'preserve-entry-render-blocking',
      // Vite rewrites entry script tags, dropping their original attributes.
      transformIndexHtml: {
        order: 'post',
        handler: (html) =>
          html.replace(
            /<script type="module"(?! blocking="render")/g,
            '<script type="module" blocking="render"',
          ),
      },
    },
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', ws: true },
    },
    fs: {
      allow: [
        fromFrontend('.'),
        fromFrontend('../../packages/shared'),
        fromFrontend('../../node_modules'),
      ],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        app: fromFrontend('./index.html'),
        mission: fromFrontend('./mission/index.html'),
      },
    },
  },
});
