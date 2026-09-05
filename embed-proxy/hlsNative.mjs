/**
 * Native HLS path: mint a playlist token in headless Chrome (embed.st + WASM),
 * then proxy gate-kept m3u8 through that page and unwrap PNG-wrapped MPEG-TS
 * segments so the app can play with hls.js — no iframe, no PopUnder.
 *
 * Scaling knobs (env): HLS_MAX_SESSIONS, HLS_MAX_OPENS, HLS_OPEN_RATE_MAX,
 * HLS_OPEN_WAIT_MS (queue busy opens), HLS_MINT_CACHE_TTL_MS (share mints).
 * Playwright is used only to mint playlist cookies; playback is Node fetch.
 * Keep HLS_MAX_OPENS low (default 2) so four-slot multiview cannot spawn
 * four WASM embed.st pages at once.
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
// One WASM mint is expensive; two concurrent is enough. Four parallel
// embed.st pages plus page.evaluate of .ts segments crash Chromium and
// cycle-buffer multiview. Media after mint does not use Playwright.
const MAX_OPENS_IN_FLIGHT = Math.max(1, Number(process.env.HLS_MAX_OPENS || 2));
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
/** Exact hosts only — never allow *.workers.dev (open proxy). */
const ALLOWED_MEDIA_EXACT_HOSTS = new Set([
  'data.corsservices.workers.dev',
  'corsservices.workers.dev',
]);

/** @typedef {{ id: string, embedUrl: string, playlistUrl: string, page: import('playwright').Page | null, context: import('playwright').BrowserContext | null, cookies: object[], cookieHeader: string, playerHeaders: Record<string, string>, playlistBuf: Buffer | null, bodyCache: Map<string, { buf: Buffer, ct: string }>, lastAccess: number, closed: boolean }} HlsSession */
/** @typedef {{ playlistUrl: string, storageState: object, expires: number, playerHeaders?: Record<string, string>, playlistBuf?: Buffer | null }} MintCacheEntry */

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
  if (ALLOWED_MEDIA_EXACT_HOSTS.has(host)) return true;
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

export function cookieHeaderFromCookies(cookies) {
  if (!Array.isArray(cookies) || cookies.length === 0) return '';
  return cookies
    .filter(c => c && typeof c.name === 'string' && c.name.length > 0)
    .map(c => `${c.name}=${c.value ?? ''}`)
    .join('; ');
}

export function cookieHeaderFromStorageState(storageState) {
  return cookieHeaderFromCookies(storageState?.cookies);
}

export function cookiesForUrl(cookies, url) {
  if (!Array.isArray(cookies)) return [];
  let parsed;
  try {
    parsed = new URL(String(url || ''));
  } catch {
    return [];
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname || '/';
  return cookies.filter(c => {
    if (!c || typeof c.name !== 'string' || !c.name) return false;
    let domain = String(c.domain || '').toLowerCase();
    if (domain.startsWith('.')) domain = domain.slice(1);
    if (domain && host !== domain && !host.endsWith(`.${domain}`)) return false;
    const cpath = c.path || '/';
    if (cpath !== '/' && !path.startsWith(cpath)) return false;
    if (c.secure && parsed.protocol !== 'https:') return false;
    return true;
  });
}

/** After mint, playlists and segments go through Node — never page.evaluate. */
export function mediaTransportFor(_url) {
  return 'node';
}

export function canServeMediaWithoutPage(session) {
  if (!session) return false;
  if (session.page) return true;
  return Boolean(session.cookieHeader || session.playlistBuf);
}

const PLAYER_HEADER_MAP = [
  ['user-agent', 'User-Agent'],
  ['referer', 'Referer'],
  ['origin', 'Origin'],
  ['accept', 'Accept'],
  ['accept-language', 'Accept-Language'],
];

function headerLookup(headers, name) {
  if (!headers || typeof headers !== 'object') return undefined;
  if (headers[name] != null) return headers[name];
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

function headerToString(value) {
  if (value == null) return '';
  return Array.isArray(value) ? String(value[0] ?? '') : String(value);
}

/** Copy the WASM player's working request headers; drop anything else. */
export function upstreamHeadersFromPlayerRequest(headers, cookieHeader) {
  const out = {
    'User-Agent': UA,
    Referer: 'https://embed.st/',
    Origin: 'https://embed.st',
    Accept: '*/*',
  };
  for (const [from, dest] of PLAYER_HEADER_MAP) {
    const raw = headerLookup(headers, from);
    const value = headerToString(raw);
    if (value) out[dest] = value;
  }
  if (cookieHeader) {
    out.Cookie = cookieHeader;
  } else {
    const fromReq = headerToString(headerLookup(headers, 'cookie'));
    if (fromReq) out.Cookie = fromReq;
  }
  return out;
}

/** page.evaluate of .ts/.m4s is what crashed Chromium under 4-slot multiview. */
export function allowsInPageEvaluate(url) {
  try {
    const path = new URL(String(url || '')).pathname.toLowerCase();
    return path.includes('.m3u8');
  } catch {
    return false;
  }
}

/** Streamed variant playlists are …/high|low/mono.m3u8 — WASM often only fetches one. */
export function alternateHlsVariantUrl(url) {
  const s = String(url || '');
  if (s.includes('/high/')) return s.replace('/high/', '/low/');
  if (s.includes('/low/')) return s.replace('/low/', '/high/');
  return null;
}

export function isFreshCacheHit(hit, maxAgeMs = 3_000, now = Date.now()) {
  if (!hit?.buf?.length) return false;
  if (hit.at == null) return false;
  return now - hit.at < maxAgeMs;
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
        '--disable-gpu',
        '--mute-audio',
        '--disable-background-networking',
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

function embedRefererFrom(page, embedUrl) {
  try {
    const u = page?.url?.();
    if (u && u.includes('embed.st')) return u;
  } catch {
    /* ignore */
  }
  if (embedUrl && String(embedUrl).includes('embed.st')) return String(embedUrl);
  return 'https://embed.st/';
}

function mergeUpstreamHeaders(session, cookieHeader) {
  const referer = embedRefererFrom(session?.page, session?.embedUrl);
  return upstreamHeadersFromPlayerRequest(
    session?.playerHeaders && Object.keys(session.playerHeaders).length
      ? session.playerHeaders
      : { referer, origin: 'https://embed.st' },
    cookieHeader,
  );
}

/** Stable browser headers. Copying the WASM request's Accept/UA 403s Cloud Run. */
export function nodeUpstreamHeaders(cookieHeader, referer = 'https://embed.st/') {
  return {
    'User-Agent': UA,
    Referer: referer || 'https://embed.st/',
    Origin: 'https://embed.st',
    Accept: '*/*',
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
  };
}

/**
 * Node fetch with mint cookies. This is the playback hot path — Chromium
 * page.evaluate of MPEG-TS (string + btoa + CDP) is what melts 4-slot
 * multiview and closes the shared Playwright browser.
 */
async function fetchUpstream(url, cookieHeader, referer = 'https://embed.st/', extraHeaders = null) {
  const headers = nodeUpstreamHeaders(cookieHeader, referer);
  if (extraHeaders?.Referer) headers.Referer = extraHeaders.Referer;
  const response = await fetch(url, {
    headers,
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
    buf,
  };
}

async function fetchViaPlaywrightRequest(page, url, extraHeaders = null) {
  const resp = await page.request.get(url, {
    headers: nodeUpstreamHeaders('', extraHeaders?.Referer || embedRefererFrom(page)),
    timeout: 30_000,
    maxRedirects: 0,
  });
  if (!resp.ok()) throw new Error(`upstream ${resp.status()}`);
  const buf = Buffer.from(await resp.body());
  return {
    ct: resp.headers()['content-type'] || '',
    buf,
  };
}

let evaluateInFlight = 0;
const MAX_EVALUATE_IN_FLIGHT = 2;

async function waitForEvaluateSlot() {
  const deadline = Date.now() + 30_000;
  while (evaluateInFlight >= MAX_EVALUATE_IN_FLIGHT) {
    if (Date.now() >= deadline) {
      throw new Error('Playwright evaluate busy');
    }
    await new Promise(r => setTimeout(r, 50));
  }
  evaluateInFlight++;
}

async function cookieHeaderForUrl(session, url) {
  if (session.page) {
    try {
      return cookieHeaderFromCookies(await session.page.context().cookies(url));
    } catch {
      /* fall through to stored cookies */
    }
  }
  if (Array.isArray(session.cookies) && session.cookies.length) {
    return cookieHeaderFromCookies(cookiesForUrl(session.cookies, url));
  }
  return session.cookieHeader || '';
}

/**
 * In-page fetch matches the WASM player. Used only when Node / page.request
 * 403. Never run more than two large evaluates at once — that is what
 * closed Chromium under 4-slot multiview.
 */
async function fetchViaEvaluate(page, url) {
  await waitForEvaluateSlot();
  try {
    const data = await page.evaluate(async u => {
      const r = await fetch(u, { credentials: 'include' });
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
    return {
      ct: data.ct,
      buf: Buffer.from(data.b64, 'base64'),
    };
  } finally {
    evaluateInFlight--;
  }
}

function takeCachedMedia(session, url) {
  const hit = session?.bodyCache?.get(url);
  if (!hit?.buf?.length) return null;
  return { ct: hit.ct || '', buf: hit.buf };
}

function playlistFromCache(session, url, { allowStale = true } = {}) {
  const pick = u => {
    if (!u) return null;
    const hit = session?.bodyCache?.get(u);
    if (!hit?.buf?.length) return null;
    if (!allowStale && !isFreshCacheHit(hit)) return null;
    return { ct: hit.ct || '', buf: hit.buf };
  };
  return pick(url) || pick(alternateHlsVariantUrl(url));
}

function rememberMedia(session, url, data) {
  if (!session || !url || !data?.buf?.length) return;
  if (!session.bodyCache) session.bodyCache = new Map();
  session.bodyCache.set(url, { buf: data.buf, ct: data.ct || '', at: Date.now() });
}

async function capturePlaylistFromResponse(res) {
  let requestHeaders = {};
  try {
    requestHeaders = res.request().headers();
  } catch {
    /* ignore */
  }
  let body = null;
  try {
    body = Buffer.from(await res.body());
  } catch {
    /* body may already be consumed */
  }
  return { url: res.url(), body, requestHeaders };
}

function attachPageBodyCache(session) {
  const page = session?.page;
  if (!page || session._cacheListener) return;
  if (!session.bodyCache) session.bodyCache = new Map();
  const onResponse = res => {
    if (session.closed || res.status() !== 200) return;
    const u = res.url();
    let host;
    let path;
    try {
      const parsed = new URL(u);
      host = parsed.hostname;
      path = parsed.pathname.toLowerCase();
    } catch {
      return;
    }
    if (!isAllowedMediaHost(host)) return;
    if (!path.includes('.m3u8') && !path.endsWith('.ts') && !path.endsWith('.m4s') && !path.endsWith('.mp4')) {
      return;
    }
    void res
      .body()
      .then(buf => {
        if (session.closed) return;
        rememberMedia(session, u, { buf: Buffer.from(buf), ct: res.headers()['content-type'] || '' });
      })
      .catch(() => {});
  };
  page.on('response', onResponse);
  session._cacheListener = onResponse;
}

async function quietMintPage(page) {
  if (!page) return;
  await page
    .evaluate(() => {
      document.querySelectorAll('video, audio').forEach(el => {
        try {
          el.muted = true;
          void el.play();
        } catch {
          /* ignore */
        }
      });
    })
    .catch(() => {});
}

/** Use Chromium's network stack without serializing TS through page.evaluate. */
async function fetchViaCdp(page, url) {
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('Network.enable').catch(() => {});
    const { frameTree } = await client.send('Page.getFrameTree');
    const frameId = frameTree?.frame?.id;
    if (!frameId) throw new Error('cdp missing frame');
    const { resource } = await client.send('Network.loadNetworkResource', {
      frameId,
      url,
      options: { disableCache: false, includeCredentials: true },
    });
    if (!resource?.success) {
      throw new Error(`cdp ${resource?.httpStatusCode || 'fail'}`);
    }
    let buf;
    if (resource.stream) {
      const chunks = [];
      for (;;) {
        const chunk = await client.send('IO.read', { handle: resource.stream, size: 262144 });
        if (chunk.data) {
          chunks.push(Buffer.from(chunk.data, chunk.base64Encoded ? 'base64' : 'utf8'));
        }
        if (chunk.eof) break;
      }
      await client.send('IO.close', { handle: resource.stream }).catch(() => {});
      buf = Buffer.concat(chunks);
    } else {
      throw new Error('cdp empty body');
    }
    const headers = resource.headers || {};
    const ct = headers['content-type'] || headers['Content-Type'] || '';
    return { ct, buf };
  } finally {
    await client.detach().catch(() => {});
  }
}

/**
 * Kick an in-page fetch (no body returned through CDP) and read the
 * browser's network response. Avoids the TS string/btoa crash.
 */
async function fetchViaPageNetwork(page, url) {
  const [res] = await Promise.all([
    page.waitForResponse(r => r.url() === url && r.status() === 200, { timeout: 20_000 }),
    page.evaluate(u => {
      void fetch(u, { credentials: 'include' }).catch(() => {});
    }, url),
  ]);
  return {
    ct: res.headers()['content-type'] || '',
    buf: Buffer.from(await res.body()),
  };
}

async function fetchMedia(session, url) {
  const isPlaylist = String(url).toLowerCase().includes('.m3u8');
  if (!isPlaylist) {
    const cached = takeCachedMedia(session, url);
    if (cached) {
      session.bodyCache?.delete(url);
      logSafe('hop cache');
      return cached;
    }
  }

  const referer = embedRefererFrom(session.page, session.embedUrl);
  const cookieHeader = await cookieHeaderForUrl(session, url);
  const extraHeaders = mergeUpstreamHeaders(session, cookieHeader);
  /** @type {Error | null} */
  let lastErr = null;

  if (session.page) {
    try {
      const data = await fetchViaPlaywrightRequest(session.page, url, extraHeaders);
      rememberMedia(session, url, data);
      return data;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      logSafe(`hop page.request: ${lastErr.message}`);
    }
  }

  try {
    const data = await fetchUpstream(url, cookieHeader, referer, extraHeaders);
    rememberMedia(session, url, data);
    return data;
  } catch (err) {
    lastErr = err instanceof Error ? err : new Error(String(err));
    logSafe(`hop node: ${lastErr.message}`);
  }

  if (isPlaylist) {
    const fresh = playlistFromCache(session, url, { allowStale: false });
    if (fresh) {
      logSafe('hop cache');
      return fresh;
    }
    if (session.page) {
      const deadline = Date.now() + 4_000;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 250));
        const waited = playlistFromCache(session, url, { allowStale: false });
        if (waited) {
          logSafe('hop cache-wait');
          return waited;
        }
      }
    }
    const stale = playlistFromCache(session, url, { allowStale: true });
    if (stale) {
      logSafe('hop cache-stale');
      return stale;
    }
  }

  if (session.page) {
    try {
      const data = await fetchViaCdp(session.page, url);
      rememberMedia(session, url, data);
      return data;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      logSafe(`hop cdp: ${lastErr.message}`);
    }

    try {
      const data = await fetchViaPageNetwork(session.page, url);
      rememberMedia(session, url, data);
      return data;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      logSafe(`hop page.network: ${lastErr.message}`);
    }
  }

  if (isPlaylist) {
    const cached = playlistFromCache(session, url);
    if (cached) {
      logSafe('hop cache');
      return cached;
    }
  }

  if (session.page && allowsInPageEvaluate(url)) {
    try {
      const data = await fetchViaEvaluate(session.page, url);
      rememberMedia(session, url, data);
      return data;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      logSafe(`hop evaluate: ${lastErr.message}`);
    }
  }

  throw lastErr || new Error('HLS media fetch failed');
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
  /** @type {{ url: string, body: Buffer | null, requestHeaders: Record<string, string> } | null} */
  let playlist = null;
  /** @type {Promise<{ url: string, body: Buffer | null, requestHeaders: Record<string, string> }> | null} */
  let pending = null;

  const beginCapture = res => {
    if (playlist || pending) return;
    if (!isCandidatePlaylistUrl(res.url(), res.status())) return;
    pending = capturePlaylistFromResponse(res).then(cap => {
      playlist = cap;
      return cap;
    });
  };

  page.on('response', beginCapture);

  try {
    await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    const deadline = Date.now() + RESOLVE_TIMEOUT_MS;
    let clicks = 0;
    while (!playlist && !pending && Date.now() < deadline) {
      if (clicks < 4) {
        await tryClickPlay(page);
        clicks++;
      }
      try {
        const res = await page.waitForResponse(
          r => isCandidatePlaylistUrl(r.url(), r.status()),
          { timeout: 2_000 },
        );
        beginCapture(res);
      } catch {
        /* click / wait again until deadline */
      }
    }
    if (pending && !playlist) {
      await pending.catch(() => null);
    }
    if (!playlist?.url) {
      throw httpError('Timed out waiting for playlist.m3u8', 503);
    }
    return playlist;
  } finally {
    page.off('response', beginCapture);
  }
}

async function newStealthContext(browserInstance, storageState) {
  const opts = {
    viewport: { width: 640, height: 360 },
    userAgent: UA,
    // Default on: embed.st often serves an expired cert; set HLS_IGNORE_TLS=0 to enforce.
    ignoreHTTPSErrors: process.env.HLS_IGNORE_TLS !== '0',
    ...(storageState ? { storageState } : {}),
  };
  const context = await browserInstance.newContext(opts);
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  return context;
}

function registerSession(embedKey, playlistUrl, page, context, cookieHeader, cookies, extra = {}) {
  const id = randomBytes(12).toString('hex');
  const cookieList = Array.isArray(cookies) ? cookies : [];
  /** @type {HlsSession} */
  const session = {
    id,
    embedUrl: embedKey,
    playlistUrl,
    page: page || null,
    context: context || null,
    cookies: cookieList,
    cookieHeader: cookieHeader || cookieHeaderFromCookies(cookieList),
    playerHeaders: extra.playerHeaders || {},
    playlistBuf: extra.playlistBuf || null,
    bodyCache: extra.bodyCache || new Map(),
    lastAccess: Date.now(),
    closed: false,
  };
  if (session.playlistBuf) {
    rememberMedia(session, playlistUrl, {
      buf: session.playlistBuf,
      ct: 'application/vnd.apple.mpegurl',
    });
  }
  if (extra.cacheOwner) {
    session._cacheOwner = extra.cacheOwner;
    session._cacheListener = extra.cacheOwner._cacheListener;
  } else if (session.page) {
    attachPageBodyCache(session);
  }
  sessions.set(id, session);
  return {
    sessionId: id,
    masterUrl: `/api/hls/${id}/master.m3u8`,
  };
}

/** Fast path: reuse mint cookies. Node fetch when the CDN allows it; otherwise
 *  clone the mint into a live page without another click-to-play. */
async function openFromMintCache(browserInstance, embedKey, mint) {
  const cookies = mint.storageState?.cookies || [];
  const cookieHeader = cookieHeaderFromCookies(cookies);
  const extra = {
    playerHeaders: mint.playerHeaders || {},
    playlistBuf: mint.playlistBuf || null,
  };
  const cookieForPlaylist = cookieHeaderFromCookies(cookiesForUrl(cookies, mint.playlistUrl));
  const headers = upstreamHeadersFromPlayerRequest(
    extra.playerHeaders && Object.keys(extra.playerHeaders).length
      ? extra.playerHeaders
      : { referer: embedKey, origin: 'https://embed.st' },
    cookieForPlaylist,
  );
  try {
    await fetchUpstream(mint.playlistUrl, cookieForPlaylist, embedKey, headers);
    return registerSession(embedKey, mint.playlistUrl, null, null, cookieHeader, cookies, extra);
  } catch {
    const context = await newStealthContext(browserInstance, mint.storageState);
    const page = await context.newPage();
    try {
      await page.goto(embedKey, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
      await quietMintPage(page);
      return registerSession(embedKey, mint.playlistUrl, page, context, cookieHeader, cookies, extra);
    } catch (err) {
      await context.close().catch(() => {});
      throw err;
    }
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
  const cacheOwner = { page, bodyCache: new Map(), closed: false };
  attachPageBodyCache(cacheOwner);

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
    const captured = await resolvePlaylist(page, embedKey);
    const hasVariant = () =>
      [...cacheOwner.bodyCache.keys()].some(k => String(k).includes('mono.m3u8'));
    if (!hasVariant()) {
      await page
        .waitForResponse(r => {
          try {
            return r.status() === 200 && new URL(r.url()).pathname.toLowerCase().includes('mono.m3u8');
          } catch {
            return false;
          }
        }, { timeout: 8_000 })
        .catch(() => {});
    }
    const playlistUrl = captured.url;
    const playerHeaders = captured.requestHeaders || {};
    const playlistBuf = captured.body;
    const storageState = await context.storageState();
    const cookies = storageState?.cookies || [];
    const cookieHeader = cookieHeaderFromCookies(cookies);
    /** @type {MintCacheEntry} */
    const entry = {
      playlistUrl,
      storageState,
      expires: Date.now() + MINT_CACHE_TTL_MS,
      playerHeaders,
      playlistBuf,
    };
    if (MINT_CACHE_TTL_MS > 0) {
      mintCache.set(embedKey, entry);
    }
    failCache.delete(embedKey);
    settle?.resolve(entry);
    const extra = { playerHeaders, playlistBuf, bodyCache: cacheOwner.bodyCache, cacheOwner };
    const cookieForPlaylist = cookieHeaderFromCookies(cookiesForUrl(cookies, playlistUrl));
    const headers = upstreamHeadersFromPlayerRequest(playerHeaders, cookieForPlaylist);
    try {
      await fetchUpstream(playlistUrl, cookieForPlaylist, embedKey, headers);
      cacheOwner.closed = true;
      await context.close().catch(() => {});
      return registerSession(embedKey, playlistUrl, null, null, cookieHeader, cookies, extra);
    } catch {
      await quietMintPage(page);
      return registerSession(embedKey, playlistUrl, page, context, cookieHeader, cookies, extra);
    }
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
  if (session._cacheOwner) session._cacheOwner.closed = true;
  sessions.delete(id);
  if (session.context) {
    await session.context.close().catch(() => {});
  }
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
    let buf = null;
    try {
      buf = (await fetchMedia(session, session.playlistUrl)).buf;
    } catch (err) {
      if (session.playlistBuf?.length) {
        buf = session.playlistBuf;
        logSafe('hop mint-playlist');
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          status: 502,
          type: 'text/plain; charset=utf-8',
          body: Buffer.from(msg.startsWith('upstream ') ? `CDN ${msg.slice('upstream '.length)}` : msg),
        };
      }
    }
    const text = rewriteM3uForProxy(buf.toString('utf8'), session.playlistUrl, proxyPrefix);
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

    // Use the raw target string for fetches — URL#href can re-encode query tokens.
    const mediaUrl = target;
    let buf;
    let ct = '';
    try {
      const data = await fetchMedia(session, mediaUrl);
      buf = data.buf;
      ct = data.ct;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('redirect')) {
        return {
          status: 400,
          type: 'text/plain; charset=utf-8',
          body: Buffer.from('Redirects not allowed'),
        };
      }
      return {
        status: 502,
        type: 'text/plain; charset=utf-8',
        body: Buffer.from(msg.startsWith('upstream ') ? `CDN ${msg.slice('upstream '.length)}` : msg),
      };
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
  cookieHeaderFromCookies,
  cookieHeaderFromStorageState,
  cookiesForUrl,
  mediaTransportFor,
  canServeMediaWithoutPage,
  allowsInPageEvaluate,
  upstreamHeadersFromPlayerRequest,
  alternateHlsVariantUrl,
  isFreshCacheHit,
  nodeUpstreamHeaders,
};
