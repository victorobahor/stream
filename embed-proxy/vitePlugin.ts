import type { Plugin } from 'vite';
import { tryHandleHlsRequest } from './hlsNative.mjs';
import { tryHandlePpvRequest } from './ppv.mjs';
import { tryHandleStrmfreeRequest } from './strmfree.mjs';

/**
 * Dev-server: the same API surface as embed-proxy/server.mjs.
 *   GET /api/strmfree/*                    → StreamFree (primary catalog)
 *   GET /api/ppv/*                         → PPV
 *   GET /api/hls/*                         → native HLS (StreamFree, PPV)
 */
export function embedProxyPlugin(): Plugin {
  return {
    name: 'streamzone-embed-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url || '';
        if (rawUrl.startsWith('/api/hls')) {
          const handled = await tryHandleHlsRequest(req, res);
          if (handled) return;
        }
        if (rawUrl.startsWith('/api/ppv')) {
          const handled = await tryHandlePpvRequest(req, res);
          if (handled) return;
        }
        if (rawUrl.startsWith('/api/strmfree')) {
          const handled = await tryHandleStrmfreeRequest(req, res);
          if (handled) return;
        }
        next();
      });
    },
  };
}
