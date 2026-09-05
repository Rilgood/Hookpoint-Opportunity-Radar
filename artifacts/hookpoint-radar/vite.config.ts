import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const localDemo = process.env.HOOKPOINT_LOCAL_DEMO === 'true' && process.env.NODE_ENV === 'development';
const rawPort = process.env.PORT || '5173';

const port = Number(rawPort);

if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH || '/';
const demoApiPort = Number(process.env.HOOKPOINT_DEMO_API_PORT || 8787);
if (localDemo && (!Number.isInteger(demoApiPort) || demoApiPort < 1 || demoApiPort > 65_535 || !process.env.HOOKPOINT_DEMO_API_KEY)) {
  throw new Error('Start the isolated demo with node scripts/local-demo.mjs.');
}

export default defineConfig({
  base: basePath,
  // The demo must not inherit Clerk keys or provider configuration from .env.
  envDir: localDemo ? false : undefined,
  define: localDemo ? { 'import.meta.env.VITE_LOCAL_DEMO': JSON.stringify('true') } : undefined,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: localDemo || !process.env.REPL_ID ? '127.0.0.1' : '0.0.0.0',
    allowedHosts: localDemo ? ['localhost', '127.0.0.1'] : process.env.REPL_ID ? true : undefined,
    proxy: localDemo ? {
      '/api': {
        target: `http://127.0.0.1:${demoApiPort}`,
        headers: { 'x-api-key': process.env.HOOKPOINT_DEMO_API_KEY! },
      },
    } : undefined,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: localDemo || !process.env.REPL_ID ? '127.0.0.1' : '0.0.0.0',
    allowedHosts: localDemo ? ['localhost', '127.0.0.1'] : process.env.REPL_ID ? true : undefined,
  },
});
