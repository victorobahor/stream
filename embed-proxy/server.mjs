/**
 * Production server: static `dist/` + embed ad-sink proxy.
 * Used by Docker instead of nginx-only (which cannot rewrite embed HTML).
 *
 *   node embed-proxy/server.mjs
 *   PORT=8080 DIST_DIR=./dist node embed-proxy/server.mjs
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import {
  AD_SINK_HTML,
  isAllowedEmbedUrl,
  readUpstream,
  rewriteEmbedHtml,
} from './rewrite.mjs';
import { tryHandleHlsRequest } from './hlsNative.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 80);
const DIST = path.resolve(process.env.DIST_DIR || path.join(__dirname, '..', 'dist'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

const GZIP_TYPES = new Set([
  'text/html; charset=utf-8',
  'text/javascript; charset=utf-8',
  'text/css; charset=utf-8',
  'application/json',
  'image/svg+xml',
  'text/plain; charset=utf-8',
]);

const SECURITY_HEADERS = {
  'X-Frame-Options': 'SAMEORIGIN',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'Cross-Origin-Embedder-Policy': 'unsafe-none',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

function wantsGzip(req, type) {
  const accept = req.headers['accept-encoding'] || '';
  return accept.includes('gzip') && GZIP_TYPES.has(type);
}

async function send(req, res, status, type, body, extraHeaders = {}) {
  const headers = {
    'Content-Type': type,
    'Cache-Control':
      type.includes('text/html') && !extraHeaders['Cache-Control']
        ? 'no-store'
        : extraHeaders['Cache-Control'] || 'no-cache',
    ...SECURITY_HEADERS,
    ...extraHeaders,
  };

  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  if (wantsGzip(req, type) && buf.length >= 256) {
    headers['Content-Encoding'] = 'gzip';
    headers['Vary'] = 'Accept-Encoding';
    const gzipped = await new Promise((resolve, reject) => {
      zlib.gzip(buf, (err, out) => (err ? reject(err) : resolve(out)));
    });
    headers['Content-Length'] = gzipped.length;
    res.writeHead(status, headers);
    res.end(gzipped);
    return;
  }

  headers['Content-Length'] = buf.length;
  res.writeHead(status, headers);
  res.end(buf);
}

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath.split('?')[0]);
  const joined = path.normalize(path.join(root, decoded));
  if (!joined.startsWith(root)) return null;
  return joined;
}

async function handleProxy(req, res, url) {
  if (url.pathname === '/__ad_sink') {
    await send(req, res, 200, 'text/html; charset=utf-8', AD_SINK_HTML);
    return;
  }

  const target = url.searchParams.get('u') || '';
  const embedUrl = isAllowedEmbedUrl(target);
  if (!embedUrl) {
    await send(req, res, 400, 'text/plain; charset=utf-8', 'Invalid or disallowed embed URL');
    return;
  }

  try {
    const upstream = await readUpstream(embedUrl.toString());
    if (upstream.status >= 400) {
      await send(req, res, 502, 'text/plain; charset=utf-8', `Upstream HTTP ${upstream.status}`);
      return;
    }
    const origin = `${embedUrl.protocol}//${embedUrl.host}`;
    await send(
      req,
      res,
      200,
      'text/html; charset=utf-8',
      rewriteEmbedHtml(upstream.body, origin),
    );
  } catch (err) {
    await send(
      req,
      res,
      502,
      'text/plain; charset=utf-8',
      `Embed proxy failed: ${err?.message || err}`,
    );
  }
}

async function serveStatic(req, res, url) {
  let filePath = safeJoin(DIST, url.pathname === '/' ? '/index.html' : url.pathname);
  if (!filePath) {
    await send(req, res, 403, 'text/plain; charset=utf-8', 'Forbidden');
    return;
  }

  try {
    let st = await fs.stat(filePath);
    if (st.isDirectory()) {
      filePath = path.join(DIST, 'index.html');
      st = await fs.stat(filePath);
    }
  } catch {
    filePath = path.join(DIST, 'index.html');
    try {
      await fs.stat(filePath);
    } catch {
      await send(req, res, 404, 'text/plain; charset=utf-8', 'Not found');
      return;
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const body = await fs.readFile(filePath);
  const headers = {};
  if (url.pathname.startsWith('/assets/')) {
    headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  }
  await send(req, res, 200, type, body, headers);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (await tryHandleHlsRequest(req, res)) {
      return;
    }

    if (url.pathname === '/__embed' || url.pathname === '/__ad_sink') {
      await handleProxy(req, res, url);
      return;
    }

    await serveStatic(req, res, url);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
      res.end(`Server error: ${err?.message || err}`);
    }
  }
});

server.listen(PORT, () => {
  console.log(`StreamZone listening on :${PORT} (dist=${DIST}, embed proxy on)`);
});
