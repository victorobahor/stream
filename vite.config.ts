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
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data:; media-src 'self' blob:; worker-src 'self' blob:; frame-src 'self' https://embed.st https://www.embed.st https://embed.streamapi.cc https://football77.org https://www.football77.org https://embed.sportsrc.org; connect-src 'self' https://streamed.pk https://strmd.link; base-uri 'self'; form-action 'self'; object-src 'none'; frame-ancestors 'self'",
    },
  },
}));
