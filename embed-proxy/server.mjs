/**
 * Production server: static `dist/` + StreamFree/SportSRC BFFs + native HLS
 * proxy. Used by Docker instead of nginx-only (which cannot run the BFFs).
 *
 *   node embed-proxy/server.mjs
 *   PORT=8080 DIST_DIR=./dist node embed-proxy/server.mjs
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { tryHandleHlsRequest } from './hlsNative.mjs';
import { tryHandleSportsrcRequest } from './sportsrc.mjs';
import { tryHandleStrmfreeRequest } from './strmfree.mjs';
import {
  appSecurityHeaders,
  isStaticAssetPath,
} from './securityHeaders.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 80);
const DIST = path.resolve(process.env.DIST_DIR || path.join(__dirname, '..', 'dist'));

// A single failed HLS mint must never take down the whole container.
// (Attaching a listener disables Node's default "crash on unhandledRejection".)
process.on('unhandledRejection', reason => {
  console.warn('[unhandledRejection]', reason instanceof Error ? reason.stack || reason.message : reason);
});
process.on('uncaughtException', err => {
  console.error('[uncaughtException]', err?.stack || err);
});

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

const SECURITY_HEADERS = appSecurityHeaders({});

async function send(req, res, status, type, body, extraHeaders = {}, headerSet = SECURITY_HEADERS) {
  const headers = {
    'Content-Type': type,
    'Cache-Control':
      type.includes('text/html') && !extraHeaders['Cache-Control']
        ? 'no-store'
        : extraHeaders['Cache-Control'] || 'no-cache',
    ...headerSet,
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

function wantsGzip(req, type) {
  const accept = req.headers['accept-encoding'] || '';
  return accept.includes('gzip') && GZIP_TYPES.has(type);
}

async function sendApp(req, res, status, type, body, extraHeaders = {}) {
  await send(req, res, status, type, body, extraHeaders, appSecurityHeaders(req));
}

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath.split('?')[0]);
  const rootResolved = path.resolve(root);
  const joined = path.resolve(rootResolved, '.' + path.normalize('/' + decoded));
  const prefix = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
  if (joined !== rootResolved && !joined.startsWith(prefix)) return null;
  return joined;
}

async function serveStatic(req, res, url) {
  const reqPath = url.pathname === '/' ? '/index.html' : url.pathname;
  let filePath = safeJoin(DIST, reqPath);
  if (!filePath) {
    await sendApp(req, res, 403, 'text/plain; charset=utf-8', 'Forbidden');
    return;
  }

  try {
    let st = await fs.stat(filePath);
    if (st.isDirectory()) {
      filePath = path.join(DIST, 'index.html');
      st = await fs.stat(filePath);
    }
  } catch {
    if (isStaticAssetPath(reqPath)) {
      await sendApp(req, res, 404, 'text/plain; charset=utf-8', 'Not found');
      return;
    }
    filePath = path.join(DIST, 'index.html');
    try {
      await fs.stat(filePath);
    } catch {
      await sendApp(req, res, 404, 'text/plain; charset=utf-8', 'Not found');
      return;
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const body = await fs.readFile(filePath);
  const headers = {};
  if (url.pathname.startsWith('/assets/') || isStaticAssetPath(url.pathname)) {
    headers['Cache-Control'] = 'public, max-age=86400';
  }
  await sendApp(req, res, 200, type, body, headers);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (await tryHandleHlsRequest(req, res)) {
      return;
    }

    if (await tryHandleSportsrcRequest(req, res)) {
      return;
    }

    if (await tryHandleStrmfreeRequest(req, res)) {
      return;
    }


    await serveStatic(req, res, url);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, {
        'Content-Type': 'text/plain; charset=utf-8',
        ...appSecurityHeaders(req),
      });
      res.end(`Server error: ${err?.message || err}`);
    }
  }
});

server.listen(PORT, () => {
  console.log(`StreamZone listening on :${PORT} (dist=${DIST}, embed proxy on)`);
});
