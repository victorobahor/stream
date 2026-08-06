import type { Plugin, Connect } from 'vite';
import {
  AD_SINK_HTML,
  isAllowedEmbedUrl,
  readUpstream,
  rewriteEmbedHtml,
  ALLOWED_EMBED_HOSTS,
  AD_INJECTOR_RE,
} from './rewrite.mjs';
import { tryHandleHlsRequest } from './hlsNative.mjs';
import { tryHandleSportsrcRequest } from './sportsrc.mjs';

function send(res: Connect.ServerResponse, status: number, type: string, body: string | Buffer): void {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

/**
 * Dev-server SportSRC BFF + embed rewrite + native HLS:
 *   GET /api/sports|/api/matches/*|/api/stream/* → SportSRC (keyed server-side)
 *   GET /__embed?u=<https://…>                  → HTML with window.open sunk
 *   GET /__ad_sink                              → blank sink document
 *   GET /api/hls/*                              → optional native HLS (off for SportSRC)
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
        if (rawUrl.startsWith('/api/')) {
          const handled = await tryHandleSportsrcRequest(req, res);
          if (handled) return;
        }
        if (!rawUrl.startsWith('/__embed') && !rawUrl.startsWith('/__ad_sink')) {
          next();
          return;
        }

        try {
          const parsed = new URL(rawUrl, 'http://localhost');

          if (parsed.pathname === '/__ad_sink') {
            send(res, 200, 'text/html; charset=utf-8', AD_SINK_HTML);
            return;
          }

          if (parsed.pathname !== '/__embed') {
            next();
            return;
          }

          const target = parsed.searchParams.get('u') || '';
          const embedUrl = isAllowedEmbedUrl(target);
          if (!embedUrl) {
            send(res, 400, 'text/plain; charset=utf-8', 'Invalid or disallowed embed URL');
            return;
          }

          const upstream = await readUpstream(embedUrl.toString());
          if (upstream.status >= 400) {
            send(res, 502, 'text/plain; charset=utf-8', `Upstream HTTP ${upstream.status}`);
            return;
          }

          const origin = `${embedUrl.protocol}//${embedUrl.host}`;
          const rewritten = rewriteEmbedHtml(upstream.body, origin);
          send(res, 200, 'text/html; charset=utf-8', rewritten);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          send(res, 502, 'text/plain; charset=utf-8', `Embed proxy failed: ${msg}`);
        }
      });
    },
  };
}

export const __test = { isAllowedEmbedUrl, rewriteEmbedHtml, ALLOWED_EMBED_HOSTS, AD_INJECTOR_RE };
