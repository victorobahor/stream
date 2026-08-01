import { defineConfig } from 'vite';
import { embedProxyPlugin } from './embed-proxy/vitePlugin';

export default defineConfig(({ mode }) => ({
  plugins: [embedProxyPlugin()],
  build: {
    target: 'es2020',
    minify: 'esbuild',
    // Emitted alongside the build but not referenced by it, so production stack
    // traces stay readable without serving sources to every visitor.
    sourcemap: 'hidden',
    // No manualChunks: multiview reaches back into api/ui/filters, so forcing it
    // into a named chunk hoists those shared modules out of the entry and makes
    // the entry depend on multiview — the opposite of lazy. Rollup's default
    // splitting already emits one multiview chunk plus one for `related`.
  },
  esbuild: {
    // `log()` decides at runtime, so without this every call site ships.
    drop: mode === 'production' ? ['console', 'debugger'] : [],
  },
  server: {
    port: 3000,
    open: true,
    headers: {
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
    },
  },
}));
