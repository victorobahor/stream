/**
 * Native HLS path: mint a playlist token in headless Chrome (embed.st + WASM),
 * then proxy gate-kept m3u8 through that page and unwrap PNG-wrapped MPEG-TS
 * segments so the app can play with hls.js — no iframe, no PopUnder.
 *
 * Scaling knobs (env): HLS_MAX_SESSIONS, HLS_MAX_OPENS, HLS_OPEN_RATE_MAX,
 * HLS_OPEN_WAIT_MS (queue busy opens), HLS_MINT_CACHE_TTL_MS (share mints).
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
// Defaults sized for a single beefy host (not a tiny VPS). Override via env.
const MAX_SESSIONS = Math.max(1, Number(process.env.HLS_MAX_SESSIONS || 24));
const MAX_OPENS_IN_FLIGHT = Math.max(1, Number(process.env.HLS_MAX_OPENS || 6));
const OPEN_RATE_WINDOW_MS = 60_000;
const OPEN_RATE_MAX = Math.max(1, Number(process.env.HLS_OPEN_RATE_MAX || 48));
/** Wait for an open slot instead of immediately 429 when resolves are busy. */
const OPEN_WAIT_MS = Math.max(0, Number(process.env.HLS_OPEN_WAIT_MS || 45_000));
/** Reuse mint cookies/playlist for the same embed across viewers (0 disables). */
const MINT_CACHE_TTL_MS = Math.max(0, Number(process.env.HLS_MINT_CACHE_TTL_MS || 120_000));
/** Skip reminting embeds that just timed out (lets client fall back to iframe). */
const FAIL_CACHE_TTL_MS = Math.max(0, Number(process.env.HLS_FAIL_CACHE_TTL_MS || 60_000));
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
/** @typedef {{ playlistUrl: string, storageState: object, expires: number }} MintCacheEntry */

/** @type {import('playwright').Browser | null} */
let browser = null;
/** @type {Promise<import('playwright').Browser> | null} */
let browserLaunching = null;
/** @type {Map<string, HlsSession>} */
const sessions = new Map();
/** @type {Map<string, number[]>} */
const openHitsByIp = new Map();
/** @type {Map<string, MintCacheEntry>} */
const mintCache = new Map();
/** @type {Map<string, Promise<MintCacheEntry | null>>} */
const mintInFlight = new Map();
/** @type {Map<string, number>} embedKey → fail-until timestamp */
const failCache = new Map();
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

function assertSessionCapacity() {
  if (sessions.size >= MAX_SESSIONS) {
    const err = new Error('Too many active HLS sessions');
    err.statusCode = 429;
    throw err;
  }
}

function assertRateLimit(req) {
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

/** Queue behind in-flight resolves instead of hard-rejecting under burst. */
async function waitForOpenSlot() {
  if (opensInFlight < MAX_OPENS_IN_FLIGHT) return;
  const deadline = Date.now() + OPEN_WAIT_MS;
  while (opensInFlight >= MAX_OPENS_IN_FLIGHT) {
    if (Date.now() >= deadline) {
      const err = new Error('HLS resolve busy — try again shortly');
      err.statusCode = 429;
      throw err;
    }
    await new Promise(r => setTimeout(r, 100));
  }
}

function getValidMint(embedKey) {
  if (MINT_CACHE_TTL_MS <= 0) return null;
  const cached = mintCache.get(embedKey);
  if (!cached) return null;
  if (cached.expires <= Date.now()) {
    mintCache.delete(embedKey);
    return null;
  }
  return cached;
}

function assertNotRecentlyFailed(embedKey) {
  const until = failCache.get(embedKey);
  if (!until) return;
  if (until <= Date.now()) {
    failCache.delete(embedKey);
    return;
  }
  const err = new Error('Recent HLS resolve failed for this embed');
  err.statusCode = 503;
  throw err;
}

function markResolveFailed(embedKey) {
  if (FAIL_CACHE_TTL_MS <= 0) return;
  failCache.set(embedKey, Date.now() + FAIL_CACHE_TTL_MS);
}

/** True when a network response is a usable HLS playlist (not an ad beacon). */
export function isCandidatePlaylistUrl(url, status = 200) {
  if (status !== 200) return false;
  let host;
  let path;
  try {
    const u = new URL(String(url || ''));
    host = u.hostname.toLowerCase();
    path = u.pathname.toLowerCase();
  } catch {
    return false;
  }
  if (!path.includes('.m3u8')) return false;
  // Never accept playlists from arbitrary hosts (open-proxy / ad beacons).
  if (!isAllowedMediaHost(host)) return false;
  // Classic Streamed path, or any .m3u8 on allowlisted media (Delta variants).
  return (
    path.includes('/playlist.m3u8') ||
    path.endsWith('playlist.m3u8') ||
    path.includes('master.m3u8') ||
    path.includes('index.m3u8') ||
    path.endsWith('.m3u8')
  );
}

function httpError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
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
      // --no-sandbox / shm: required inside typical Docker/CI containers.
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-popup-blocking',
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
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
  assertSessionCapacity();
  assertRateLimit(req);
  await waitForOpenSlot();
  assertSessionCapacity();
  opensInFlight++;
  try {
    return await openHlsSession(embedUrlRaw);
  } finally {
    opensInFlight--;
  }
}

async function fetchViaPage(page, url) {
  // Prefer in-page fetch first (matches the WASM player’s network path).
  try {
    const data = await page.evaluate(async u => {
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
    const buf = Buffer.from(data.b64, 'base64');
    const isPlaylist = url.includes('.m3u8') || (data.ct || '').includes('mpegurl');
    if (isPlaylist || isLikelyMediaSegment(buf)) return data;
    // Fall through — high/*.ts sometimes 200s a tiny "Not found".
  } catch {
    /* try Node fetch with mint cookies below */
  }

  const embedReferer = (() => {
    try {
      const u = page.url();
      if (u && u.includes('embed.st')) return u;
    } catch {
      /* ignore */
    }
    return 'https://embed.st/';
  })();
  const cookies = await page.context().cookies(url);
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const response = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Referer: embedReferer,
      Origin: 'https://embed.st',
      Accept: '*/*',
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    redirect: 'manual',
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`upstream redirect ${response.status}`);
  }
  if (!response.ok) {
    throw new Error(`upstream ${response.status}`);
  }
  const buf = Buffer.from(await response.arrayBuffer());
  return {
    ct: response.headers.get('content-type') || '',
    b64: buf.toString('base64'),
  };
}

async function tryClickPlay(page) {
  const box = page.viewportSize() || { width: 1100, height: 700 };
  await page.mouse.click(Math.floor(box.width / 2), Math.floor(box.height / 2)).catch(() => {});

  // Some Delta embeds need a real control click, not just center-screen.
  const selectors = [
    'button',
    '[aria-label*="Play" i]',
    '[class*="play" i]',
    'video',
    '.vjs-big-play-button',
  ];
  for (const sel of selectors) {
    const handle = await page.$(sel).catch(() => null);
    if (!handle) continue;
    await handle.click({ timeout: 1_500 }).catch(() => {});
    break;
  }
}

async function resolvePlaylist(page, embedUrl) {
  let playlist = null;
  const onResponse = res => {
    if (playlist) return;
    const u = res.url();
    if (isCandidatePlaylistUrl(u, res.status())) {
      playlist = u;
    }
  };
  page.on('response', onResponse);

  try {
    await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(800);

    const deadline = Date.now() + RESOLVE_TIMEOUT_MS;
    let clicks = 0;
    while (!playlist && Date.now() < deadline) {
      if (clicks < 4) {
        await tryClickPlay(page);
        clicks++;
      }
      await page.waitForTimeout(400);
    }
    if (!playlist) {
      throw httpError('Timed out waiting for playlist.m3u8', 503);
    }
    return playlist;
  } finally {
    page.off('response', onResponse);
  }
}

async function newStealthContext(browserInstance, storageState) {
  const opts = {
    viewport: { width: 1100, height: 700 },
    userAgent: UA,
    ...(storageState ? { storageState } : {}),
  };
  const context = await browserInstance.newContext(opts);
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  return context;
}

function registerSession(embedKey, playlistUrl, page, context) {
  const id = randomBytes(12).toString('hex');
  /** @type {HlsSession} */
  const session = {
    id,
    embedUrl: embedKey,
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
}

/** Fast path: clone cookies from a recent mint and skip Chromium click-to-play. */
async function openFromMintCache(browserInstance, embedKey, mint) {
  const context = await newStealthContext(browserInstance, mint.storageState);
  const page = await context.newPage();
  try {
    await fetchViaPage(page, mint.playlistUrl);
    return registerSession(embedKey, mint.playlistUrl, page, context);
  } catch (err) {
    await context.close().catch(() => {});
    mintCache.delete(embedKey);
    throw err;
  }
}

export async function openHlsSession(embedUrlRaw) {
  const embedUrl = isAllowedEmbedUrl(embedUrlRaw);
  if (!embedUrl) {
    throw httpError('Invalid or disallowed embed URL', 400);
  }

  ensureJanitor();
  const b = await getBrowser();
  const embedKey = embedUrl.toString();
  assertNotRecentlyFailed(embedKey);

  // Wait for a peer mint of the same embed, then try the cache.
  const peer = mintInFlight.get(embedKey);
  if (peer) {
    await peer.catch(() => null);
  }

  const cached = getValidMint(embedKey);
  if (cached) {
    try {
      return await openFromMintCache(b, embedKey, cached);
    } catch {
      // Cache was stale — fall through to a full resolve.
    }
  }

  const context = await newStealthContext(b, null);
  const page = await context.newPage();

  /** @type {{ resolve: (v: MintCacheEntry | null) => void } | null} */
  let settle = null;
  /** Always resolve (never reject) so idle waiters cannot crash the process. */
  const mintPromise = new Promise(resolve => {
    settle = { resolve };
  });
  if (MINT_CACHE_TTL_MS > 0 && !mintInFlight.has(embedKey)) {
    mintInFlight.set(embedKey, mintPromise);
  }

  try {
    const playlistUrl = await resolvePlaylist(page, embedKey);
    const storageState = await context.storageState();
    /** @type {MintCacheEntry} */
    const entry = {
      playlistUrl,
      storageState,
      expires: Date.now() + MINT_CACHE_TTL_MS,
    };
    if (MINT_CACHE_TTL_MS > 0) {
      mintCache.set(embedKey, entry);
    }
    failCache.delete(embedKey);
    settle?.resolve(entry);
    return registerSession(embedKey, playlistUrl, page, context);
  } catch (err) {
    settle?.resolve(null);
    markResolveFailed(embedKey);
    await context.close().catch(() => {});
    if (err && typeof err === 'object' && !err.statusCode) {
      err.statusCode = 503;
    }
    throw err;
  } finally {
    if (mintInFlight.get(embedKey) === mintPromise) {
      mintInFlight.delete(embedKey);
    }
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
    // Upstream sometimes returns HTTP 200 with a tiny "Not found" body for
    // expired/cookie-gated high-bitrate segments. Never hand that to hls.js
    // as video/mp2t — it locks ABR onto the low/mono rung (bad audio).
    if (!isLikelyMediaSegment(buf)) {
      return {
        status: 502,
        type: 'text/plain; charset=utf-8',
        body: Buffer.from('Upstream segment missing or invalid'),
      };
    }
    return {
      status: 200,
      type: 'video/mp2t',
      body: buf,
    };
  }

  return { status: 404, type: 'text/plain; charset=utf-8', body: Buffer.from('Not found') };
}

/** MPEG-TS starts with 0x47; fMP4/ISOBMFF has an `ftyp`/`moof` box. */
export function isLikelyMediaSegment(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 64) return false;
  if (buf[0] === 0x47) return true;
  const head = buf.subarray(0, Math.min(64, buf.length)).toString('latin1');
  if (head.includes('ftyp') || head.includes('moof') || head.includes('mdat')) return true;
  const asText = buf.subarray(0, Math.min(32, buf.length)).toString('utf8').toLowerCase();
  if (asText.includes('not found') || asText.includes('error') || asText.includes('<html')) {
    return false;
  }
  // Opaque but large enough — allow (some CDNs use custom wrappers we unwrap).
  return buf.length >= 1024;
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
        logSafe(`open ok sessions=${sessions.size}/${MAX_SESSIONS} opens=${opensInFlight}/${MAX_OPENS_IN_FLIGHT}`);
        send(200, 'application/json; charset=utf-8', JSON.stringify(opened));
      } catch (err) {
        const status = err?.statusCode || 503;
        logSafe(`open ${status}: ${err instanceof Error ? err.message : String(err)} sessions=${sessions.size} opens=${opensInFlight}`);
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
  isCandidatePlaylistUrl,
  isLikelyMediaSegment,
};
