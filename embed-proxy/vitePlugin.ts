import type { Plugin, Connect } from 'vite';
import {
  AD_SINK_HTML,
  isAllowedEmbedUrl,
  readUpstream,
  rewriteEmbedHtml,
  stripAdJunk,
  extractNestedPlayerUrl,
  ALLOWED_EMBED_HOSTS,
  AD_INJECTOR_RE,
  AD_SCRIPT_HOST_RE,
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
 * Dev-server: SportSRC BFF + embed rewrite + native HLS:
 *   GET /api/sportsrc/*                    → SportSRC V1
 *   GET /__embed?u=<https://…>             → HTML with ads stripped / window.open sunk
 *   GET /__embed?u=…&meta=1                → JSON { nestedEmbedUrl } for HLS unwrap
 *   GET /__ad_sink                         → blank sink document
 *   GET /api/hls/*                         → native HLS (Streamed embed.st)
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

          const wantMeta =
            parsed.searchParams.get('meta') === '1' ||
            String(req.headers.accept || '').includes('application/json');
          if (wantMeta) {
            const nestedEmbedUrl = extractNestedPlayerUrl(upstream.body);
            send(
              res,
              200,
              'application/json; charset=utf-8',
              JSON.stringify({
                nestedEmbedUrl,
                source: embedUrl.toString(),
              }),
            );
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

export const __test = {
  isAllowedEmbedUrl,
  rewriteEmbedHtml,
  stripAdJunk,
  extractNestedPlayerUrl,
  ALLOWED_EMBED_HOSTS,
  AD_INJECTOR_RE,
  AD_SCRIPT_HOST_RE,
};
