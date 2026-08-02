/**
 * Native HLS path: mint a playlist token in headless Chrome (embed.st + WASM),
 * then proxy gate-kept m3u8 through that page and unwrap PNG-wrapped MPEG-TS
 * segments so the app can play with hls.js — no iframe, no PopUnder.
 *
 * Requires a local Chrome (`CHROME_PATH` or /usr/bin/google-chrome) and the
 * `playwright` package. Without them, /api/hls/* returns 503 and the client
 * falls back to the iframe player.
 */
import { randomBytes } from 'node:crypto';

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';

const SESSION_TTL_MS = 3 * 60 * 1000;
const RESOLVE_TIMEOUT_MS = 45_000;
const MAX_SESSIONS = Math.max(1, Number(process.env.HLS_MAX_SESSIONS || 4));
const MAX_OPENS_IN_FLIGHT = Math.max(1, Number(process.env.HLS_MAX_OPENS || 2));
const OPEN_RATE_WINDOW_MS = 60_000;
const OPEN_RATE_MAX = Math.max(1, Number(process.env.HLS_OPEN_RATE_MAX || 8));
const ALLOWED_EMBED_HOSTS = new Set(['embed.st', 'www.embed.st']);
/** Exact suffix allowlist — never use host.includes('tiktok') (open-proxy). */
const ALLOWED_CDN_SUFFIXES = [
  '.tiktokcdn-eu.com',
  '.tiktokcdn.com',
  '.ttlivecdn.com',
  '.tiktokv.eu',
  '.tiktokv.com',
];

/** @typedef {{ id: string, embedUrl: string, playlistUrl: string, page: import('playwright').Page, context: import('playwright').BrowserContext, lastAccess: number, closed: boolean }} HlsSession */

/** @type {import('playwright').Browser | null} */
let browser = null;
/** @type {Promise<import('playwright').Browser> | null} */
let browserLaunching = null;
/** @type {Map<string, HlsSession>} */
const sessions = new Map();
/** @type {Map<string, number[]>} */
const openHitsByIp = new Map();
let opensInFlight = 0;

let janitor = null;

export function isAllowedMediaHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return false;
  if (host === 'strmd.st' || host.endsWith('.strmd.st')) return true;
  return ALLOWED_CDN_SUFFIXES.some(suffix => host.endsWith(suffix) || host === suffix.slice(1));
}

function clientIp(req) {
  const xf = req?.headers?.['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  return req?.socket?.remoteAddress || 'unknown';
}

function assertOpenAllowed(req) {
  if (sessions.size >= MAX_SESSIONS) {
    const err = new Error('Too many active HLS sessions');
    err.statusCode = 429;
    throw err;
  }
  if (opensInFlight >= MAX_OPENS_IN_FLIGHT) {
    const err = new Error('HLS resolve busy — try again shortly');
    err.statusCode = 429;
    throw err;
  }
  const ip = clientIp(req);
  const now = Date.now();
  const hits = (openHitsByIp.get(ip) || []).filter(t => now - t < OPEN_RATE_WINDOW_MS);
  if (hits.length >= OPEN_RATE_MAX) {
    const err = new Error('HLS open rate limit exceeded');
    err.statusCode = 429;
    throw err;
  }
  hits.push(now);
  openHitsByIp.set(ip, hits);
}

export function unwrapPngTs(buf) {
  if (
    Buffer.isBuffer(buf) &&
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    const iend = buf.indexOf(Buffer.from('IEND'));
    if (iend !== -1 && iend + 8 < buf.length) {
      return buf.subarray(iend + 8);
    }
  }
  return buf;
}

/** Resolve playlist URI without re-serializing absolute URLs (avoids %2B → double-encode). */
export function absolutizePlaylistUri(uri, baseUrl) {
  const trimmed = String(uri || '').trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return new URL(trimmed, baseUrl).toString();
}

export function rewriteM3uForProxy(text, baseUrl, proxyPrefix) {
  return text
    .split('\n')
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      const abs = absolutizePlaylistUri(trimmed, baseUrl);
      return `${proxyPrefix}?u=${encodeURIComponent(abs)}`;
    })
    .join('\n');
}

export function isAllowedEmbedUrl(raw) {
  try {
    const u = new URL(String(raw || ''));
    if (u.protocol !== 'https:') return null;
    if (!ALLOWED_EMBED_HOSTS.has(u.hostname)) return null;
    if (!u.pathname.startsWith('/embed/')) return null;
    return u;
  } catch {
    return null;
  }
}

function touch(session) {
  session.lastAccess = Date.now();
}

function ensureJanitor() {
  if (janitor) return;
  janitor = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastAccess > SESSION_TTL_MS) {
        void closeSession(id);
      }
    }
  }, 30_000);
  janitor.unref?.();
}

async function getBrowser() {
  if (browser) return browser;
  if (browserLaunching) return browserLaunching;

  browserLaunching = (async () => {
    let playwright;
    try {
      playwright = await import('playwright');
    } catch {
      throw new Error('playwright is not installed — native HLS unavailable');
    }

    const executablePath =
      process.env.CHROME_PATH ||
      (await import('node:fs').then(fs =>
        fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined,
      ));

    browser = await playwright.chromium.launch({
      headless: true,
      executablePath,
      args: ['--disable-blink-features=AutomationControlled', '--disable-popup-blocking'],
    });
    browser.on('disconnected', () => {
      browser = null;
    });
    return browser;
  })();

  try {
    return await browserLaunching;
  } finally {
    browserLaunching = null;
  }
}

/** @param {import('node:http').IncomingMessage | null} [req] */
export async function openHlsSessionForRequest(embedUrlRaw, req = null) {
  assertOpenAllowed(req);
  opensInFlight++;
  try {
    return await openHlsSession(embedUrlRaw);
  } finally {
    opensInFlight--;
  }
}

async function fetchViaPage(page, url) {
  return page.evaluate(async u => {
    const r = await fetch(u, { credentials: 'omit' });
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    let s = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return {
      ct: r.headers.get('content-type') || '',
      b64: btoa(s),
    };
  }, url);
}

async function resolvePlaylist(page, embedUrl) {
  let playlist = null;
  const onResponse = res => {
    const u = res.url();
    if (u.includes('/playlist.m3u8') && res.status() === 200 && !playlist) {
      playlist = u;
    }
  };
  page.on('response', onResponse);

  try {
    await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(800);
    const box = page.viewportSize() || { width: 1100, height: 700 };
    await page.mouse.click(Math.floor(box.width / 2), Math.floor(box.height / 2));

    const deadline = Date.now() + RESOLVE_TIMEOUT_MS;
    while (!playlist && Date.now() < deadline) {
      await page.waitForTimeout(200);
    }
    if (!playlist) throw new Error('Timed out waiting for playlist.m3u8');
    return playlist;
  } finally {
    page.off('response', onResponse);
  }
}

export async function openHlsSession(embedUrlRaw) {
  const embedUrl = isAllowedEmbedUrl(embedUrlRaw);
  if (!embedUrl) {
    const err = new Error('Invalid or disallowed embed URL');
    err.statusCode = 400;
    throw err;
  }

  ensureJanitor();
  const b = await getBrowser();
  const context = await b.newContext({
    viewport: { width: 1100, height: 700 },
    userAgent: UA,
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await context.newPage();

  try {
    const playlistUrl = await resolvePlaylist(page, embedUrl.toString());
    const id = randomBytes(12).toString('hex');
    /** @type {HlsSession} */
    const session = {
      id,
      embedUrl: embedUrl.toString(),
      playlistUrl,
      page,
      context,
      lastAccess: Date.now(),
      closed: false,
    };
    sessions.set(id, session);
    return {
      sessionId: id,
      masterUrl: `/api/hls/${id}/master.m3u8`,
    };
  } catch (err) {
    await context.close().catch(() => {});
    throw err;
  }
}

export async function closeSession(id) {
  const session = sessions.get(id);
  if (!session || session.closed) return;
  session.closed = true;
  sessions.delete(id);
  await session.context.close().catch(() => {});
}

/**
 * @returns {Promise<{ status: number, type: string, body: Buffer }>}
 */
export async function handleHlsMedia(sessionId, pathname, searchParams) {
  const session = sessions.get(sessionId);
  if (!session || session.closed) {
    return { status: 404, type: 'text/plain; charset=utf-8', body: Buffer.from('Unknown HLS session') };
  }
  touch(session);

  const proxyPrefix = `/api/hls/${sessionId}/p`;

  if (pathname.endsWith('/master.m3u8')) {
    const data = await fetchViaPage(session.page, session.playlistUrl);
    const text = rewriteM3uForProxy(
      Buffer.from(data.b64, 'base64').toString('utf8'),
      session.playlistUrl,
      proxyPrefix,
    );
    return {
      status: 200,
      type: 'application/vnd.apple.mpegurl',
      body: Buffer.from(text),
    };
  }

  if (pathname.endsWith('/p')) {
    const target = searchParams.get('u') || '';
    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      return { status: 400, type: 'text/plain; charset=utf-8', body: Buffer.from('Bad media URL') };
    }
    if (parsed.protocol !== 'https:') {
      return { status: 400, type: 'text/plain; charset=utf-8', body: Buffer.from('Bad media URL') };
    }

    const host = parsed.hostname;
    if (!isAllowedMediaHost(host)) {
      return { status: 400, type: 'text/plain; charset=utf-8', body: Buffer.from('Host not allowed') };
    }

    const isStrmd = host === 'strmd.st' || host.endsWith('.strmd.st');

    // Use the raw target string for fetches — URL#href can re-encode query tokens.
    const mediaUrl = target;
    let buf;
    let ct = '';
    if (isStrmd) {
      const data = await fetchViaPage(session.page, mediaUrl);
      buf = Buffer.from(data.b64, 'base64');
      ct = data.ct;
    } else {
      const r = await fetch(mediaUrl, {
        headers: { 'User-Agent': UA, Referer: 'https://embed.st/', Accept: '*/*' },
        redirect: 'manual',
      });
      if (r.status >= 300 && r.status < 400) {
        return {
          status: 400,
          type: 'text/plain; charset=utf-8',
          body: Buffer.from('Redirects not allowed'),
        };
      }
      if (!r.ok) {
        return {
          status: 502,
          type: 'text/plain; charset=utf-8',
          body: Buffer.from(`CDN HTTP ${r.status}`),
        };
      }
      buf = Buffer.from(await r.arrayBuffer());
      ct = r.headers.get('content-type') || '';
    }

    if (mediaUrl.includes('.m3u8') || ct.includes('mpegurl')) {
      const text = rewriteM3uForProxy(buf.toString('utf8'), mediaUrl, proxyPrefix);
      return {
        status: 200,
        type: 'application/vnd.apple.mpegurl',
        body: Buffer.from(text),
      };
    }

    buf = unwrapPngTs(buf);
    return {
      status: 200,
      type: 'video/mp2t',
      body: buf,
    };
  }

  return { status: 404, type: 'text/plain; charset=utf-8', body: Buffer.from('Not found') };
}

/**
 * Connect/Node-style request handler for /api/hls/*
 * @returns {Promise<boolean>} true if handled
 */
export async function tryHandleHlsRequest(req, res) {
  const rawUrl = req.url || '';
  if (!rawUrl.startsWith('/api/hls')) return false;

  const send = (status, type, body) => {
    res.statusCode = status;
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'no-store');
    // Same-origin only — do not advertise CORS * (A01 / open proxy from other sites).
    res.end(body);
  };

  try {
    const parsed = new URL(rawUrl, 'http://localhost');

    if (parsed.pathname === '/api/hls/open') {
      if (req.method !== 'GET' && req.method !== 'POST') {
        send(405, 'text/plain; charset=utf-8', 'Method not allowed');
        return true;
      }
      const embed = parsed.searchParams.get('u') || '';
      try {
        const opened = await openHlsSessionForRequest(embed, req);
        send(200, 'application/json; charset=utf-8', JSON.stringify(opened));
      } catch (err) {
        const status = err?.statusCode || 503;
        send(status, 'application/json; charset=utf-8', JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        }));
      }
      return true;
    }

    const closeMatch = parsed.pathname.match(/^\/api\/hls\/([a-f0-9]+)\/close$/);
    if (closeMatch) {
      if (req.method !== 'GET' && req.method !== 'POST') {
        send(405, 'text/plain; charset=utf-8', 'Method not allowed');
        return true;
      }
      await closeSession(closeMatch[1]);
      send(204, 'text/plain; charset=utf-8', '');
      return true;
    }

    const match = parsed.pathname.match(/^\/api\/hls\/([a-f0-9]+)\/(master\.m3u8|p)$/);
    if (!match) {
      send(404, 'text/plain; charset=utf-8', 'Not found');
      return true;
    }

    const result = await handleHlsMedia(match[1], parsed.pathname, parsed.searchParams);
    send(result.status, result.type, result.body);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    send(502, 'text/plain; charset=utf-8', 'HLS proxy failed');
    logSafe(msg);
    return true;
  }
}

function logSafe(msg) {
  try {
    console.warn('[hls]', msg);
  } catch {
    /* ignore */
  }
}

export const __test = {
  unwrapPngTs,
  rewriteM3uForProxy,
  absolutizePlaylistUri,
  isAllowedEmbedUrl,
  isAllowedMediaHost,
};
