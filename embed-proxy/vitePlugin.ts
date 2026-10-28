import type { Plugin } from 'vite';
import { isAllowedEmbedUrl, ALLOWED_EMBED_HOSTS } from './rewrite.mjs';
import { tryHandleHlsRequest } from './hlsNative.mjs';
import { tryHandleSportsrcRequest } from './sportsrc.mjs';
import { tryHandleStrmfreeRequest } from './strmfree.mjs';

/**
 * Dev-server: the same API surface as embed-proxy/server.mjs.
 *   GET /api/strmfree/*                    → StreamFree (primary catalog)
 *   GET /api/sportsrc/*                    → SportSRC V1
 *   GET /api/hls/*                         → native HLS (StreamFree, SportSRC → embed.st)
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
        if (rawUrl.startsWith('/api/sportsrc')) {
          const handled = await tryHandleSportsrcRequest(req, res);
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

export const __test = {
  isAllowedEmbedUrl,
  ALLOWED_EMBED_HOSTS,
};
