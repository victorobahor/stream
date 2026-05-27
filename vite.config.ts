import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2020',
    minify: 'esbuild',
    sourcemap: false,
  },
  server: {
    port: 3000,
    open: true,
  },
});
