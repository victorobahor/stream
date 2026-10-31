/**
 * StreamFree BFF — replaces Streamed (closed October 2026) as the primary catalog.
 *
 * Docs: https://strmfree.st/api (keyless)
 *   GET /api/v1/streams            → every scheduled/live stream
 *   GET /api/v1/sources/{key}      → embed variants + which are live now
 *
 * Mounted at `/api/strmfree/*`:
 *   /api/strmfree/matches          → APIMatch[] (client filters by category)
 *   /api/strmfree/stream/{key}     → Stream[]
 *
 * Playback: the embed page carries a signed playlist token, so the HLS proxy
 * resolves the m3u8 with plain HTTP (`resolveStrmfreePlaylist`) — no browser.
 */

const STRMFREE_BASE = (process.env.STRMFREE_BASE_URL || 'https://strmfree.st/').replace(/\/?$/, '/');
const PREFIX = '/api/strmfree';
// The API asks consumers not to poll on every page load.
const LIST_TTL_MS = Math.max(15_000, Number(process.env.STRMFREE_CACHE_TTL_MS || 60_000));
const SOURCES_TTL_MS = 30_000;
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';

/** StreamFree category → app sport id (the ids the sports bar uses). */
const CATEGORY_MAP = {
  soccer: 'football',
  football: 'american-football',
  combat: 'fight',
  racing: 'motor-sports',
};

/** Hosts StreamFree serves embeds/playlists from (site + documented mirror). */
export const STRMFREE_HOSTS = new Set(['strmfree.st', 'streamfree.top']);

const cache = new Map();

async function cached(key, ttlMs, load) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await load();
  cache.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

function httpError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, ...(code ? { code } : {}) });
}

async function upstreamJson(path) {
  const res = await fetch(new URL(path, STRMFREE_BASE), {
    headers: { Accept: 'application/json', 'User-Agent': UA },
    signal: AbortSignal.timeout(8_000),
  });
  if (res.status === 404) throw httpError('StreamFree stream not found', 404);
  if (!res.ok) throw httpError(`StreamFree HTTP ${res.status}`, res.status === 429 ? 429 : 502);
  try {
    return await res.json();
  } catch {
    throw httpError('StreamFree returned non-JSON', 502);
  }
}

export function mapCategory(category) {
  const c = String(category || '').toLowerCase();
  return CATEGORY_MAP[c] || c || 'other';
}

function team(t) {
  return t?.name ? { name: t.name, badge: t.logo || '' } : undefined;
}

/** Normalize one `/api/v1/streams` row into StreamZone's APIMatch. */
export function normalizeStream(s) {
  const category = mapCategory(s.category);
  const live = Array.isArray(s.live_sources) && s.live_sources.length > 0;
  const home = team(s.team1);
  const away = team(s.team2);
  return {
    id: s.stream_key,
    title: s.name || 'Match',
    category,
    date: Number(s.match_timestamp) > 0 ? Number(s.match_timestamp) * 1000 : 0,
    popular: live && Number(s.viewers) >= 50,
    status: live ? 'inprogress' : undefined,
    poster: s.thumbnail_url || undefined,
    ...(home && away ? { teams: { home, away } } : {}),
    sources: [{ source: 'strmfree', id: s.stream_key, category }],
  };
}

export function normalizeStreamList(payload) {
  const rows = Array.isArray(payload?.streams) ? payload.streams : [];
  return rows.filter(s => s?.stream_key && !s.is_external).map(normalizeStream);
}

/** Stream keys carry accented team names (`alavés-vs-barcelona`). */
const KEY_CHARS = String.raw`[\p{L}\p{N}_.-]+`;
const STREAM_KEY = new RegExp(`^${KEY_CHARS}$`, 'u');
const EMBED_PATH = new RegExp(`^/embed/${KEY_CHARS}/${KEY_CHARS}$`, 'u');

/** Sources are `{ quality, url }` objects; older payloads were bare URLs. */
function sourceUrls(list) {
  return (Array.isArray(list) ? list : []).map(s => (typeof s === 'string' ? s : s?.url));
}

/** Variant label from an embed URL: `…/chelsea-vs-liverpool1080p2` → `1080p · Source 2`. */
function variantLabel(embedUrl) {
  const m = String(embedUrl).match(/(\d{3,4}p)(\d*)$/);
  if (!m) return 'Stream';
  return m[2] ? `${m[1]} · Source ${m[2]}` : m[1];
}

/**
 * Embed variants for one stream. Live variants only once any are up; before
 * that every listed variant, so the player can explain the stream hasn't started.
 */
export function normalizeSources(payload) {
  const live = sourceUrls(payload?.live_sources);
  const list = live.length ? live : sourceUrls(payload?.sources);
  return list
    .filter(u => isStrmfreeEmbedUrl(u))
    .map((embedUrl, i) => ({
      id: `${payload.stream_key || 'stream'}-${i + 1}`,
      streamNo: i + 1,
      language: variantLabel(embedUrl),
      hd: /(1080|2160)p/.test(embedUrl),
      embedUrl,
      source: 'strmfree',
    }));
}

export function isStrmfreeEmbedUrl(raw) {
  try {
    const u = new URL(String(raw || ''));
    return u.protocol === 'https:' && STRMFREE_HOSTS.has(u.hostname) && EMBED_PATH.test(decodeURI(u.pathname));
  } catch {
    return false;
  }
}

/**
 * Pull the playlist recipe out of an embed page without running it:
 * `VARIANT = '<key>' + QUALITY + SOURCE_SUFFIX`, the signed `_0x[QUALITY]`
 * token, `/get-stream-key/<key>`, and `IS_LIVE`.
 */
export function parseEmbedPage(html) {
  const text = String(html || '');
  const str = name => text.match(new RegExp(`const ${name} = '([^']*)'`))?.[1];
  const quality = str('QUALITY');
  const suffix = str('SOURCE_SUFFIX') ?? '';
  const base = text.match(new RegExp(`const VARIANT = '(${KEY_CHARS})' \\+ QUALITY \\+ SOURCE_SUFFIX`, 'u'))?.[1];
  const streamKey = text.match(new RegExp(`/get-stream-key/(${KEY_CHARS})`, 'u'))?.[1];
  let token = null;
  try {
    const tokens = JSON.parse(text.match(/const _0x = (\{.*?\});/)?.[1] || 'null');
    token = tokens?.[quality] || null;
  } catch {
    token = null;
  }
  if (!quality || !base || !streamKey) return null;
  return {
    variant: `${base}${quality}${suffix}`,
    streamKey,
    token,
    isLive: /const IS_LIVE = true;/.test(text),
  };
}

/** Same server choice as the embed's own `getStreamSource()`. */
export function playlistPathFor(variant, serverName) {
  if (serverName === 'tiktok') return `/live-tiktok/${variant}/index.m3u8`;
  if (serverName && serverName !== 'origin') return `/live-cdn/${variant}/index.m3u8`;
  return `/live/${variant}/index.m3u8`;
}

async function readText(url, referer) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: '*/*', ...(referer ? { Referer: referer } : {}) },
    redirect: 'manual',
    signal: AbortSignal.timeout(8_000),
  });
  return { status: res.status, body: res.status === 200 ? await res.text() : '' };
}

/**
 * Resolve a StreamFree embed into its tokenised playlist URL. Upstream wants a
 * StreamFree Referer on playlist and segment requests; callers send `referer`.
 * @returns {Promise<{ playlistUrl: string, referer: string }>}
 */
export async function resolveStrmfreePlaylist(embedUrlRaw, read = readText) {
  if (!isStrmfreeEmbedUrl(embedUrlRaw)) throw httpError('Invalid or disallowed embed URL', 400);
  const embed = new URL(embedUrlRaw);
  const page = await read(embed.href);
  if (page.status === 404) throw httpError('Stream provider page returned HTTP 404', 502, 'HLS_UPSTREAM_ERROR');
  if (page.status !== 200) throw httpError(`Stream provider page returned HTTP ${page.status}`, 502, 'HLS_UPSTREAM_ERROR');
  const recipe = parseEmbedPage(page.body);
  if (!recipe) throw httpError('This provider has no supported ad-free player', 422);
  if (!recipe.isLive) throw httpError("This stream hasn't started yet", 425, 'STREAM_NOT_STARTED');

  let serverName = 'origin';
  try {
    const keyInfo = await read(new URL(`/get-stream-key/${recipe.streamKey}`, embed.origin).href, embed.href);
    const data = keyInfo.status === 200 ? JSON.parse(keyInfo.body) : null;
    if (data?.is_external) throw httpError('This provider has no supported ad-free player', 422);
    if (data?.server_name) serverName = data.server_name;
  } catch (err) {
    if (err?.statusCode) throw err;
    // The embed itself falls back to the origin path when this lookup fails.
  }

  const playlist = new URL(playlistPathFor(recipe.variant, serverName), embed.origin);
  if (recipe.token) {
    playlist.searchParams.set('_t', recipe.token._t);
    playlist.searchParams.set('_e', String(recipe.token._e));
    playlist.searchParams.set('_n', recipe.token._n);
  }
  return { playlistUrl: playlist.href, referer: embed.href };
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/**
 * Handle `/api/strmfree/*` only.
 * @returns {Promise<boolean>} true if handled
 */
export async function tryHandleStrmfreeRequest(req, res) {
  const rawUrl = req.url || '';
  if (!rawUrl.startsWith(PREFIX)) return false;
  const { pathname } = new URL(rawUrl, 'http://localhost');
  const rest = pathname.slice(PREFIX.length) || '/';

  try {
    if (rest === '/matches' || rest === '/matches/') {
      const matches = await cached('streams', LIST_TTL_MS, async () =>
        normalizeStreamList(await upstreamJson('api/v1/streams')));
      sendJson(res, 200, matches);
      return true;
    }

    const streamMatch = rest.match(/^\/stream\/([\w.%-]+)\/?$/);
    if (streamMatch) {
      const key = decodeURIComponent(streamMatch[1]);
      if (!STREAM_KEY.test(key)) {
        sendJson(res, 400, { error: 'Bad stream key' });
        return true;
      }
      const streams = await cached(`sources:${key}`, SOURCES_TTL_MS, async () =>
        normalizeSources(await upstreamJson(`api/v1/sources/${encodeURIComponent(key)}`)));
      sendJson(res, 200, streams);
      return true;
    }

    sendJson(res, 404, { error: 'Not found' });
    return true;
  } catch (err) {
    // An unknown key is "no streams", not an outage.
    if (err?.statusCode === 404) {
      sendJson(res, 200, []);
      return true;
    }
    sendJson(res, err?.statusCode || 502, { error: err instanceof Error ? err.message : String(err) });
    return true;
  }
}

export const __test = { normalizeStream, normalizeStreamList, normalizeSources, parseEmbedPage, playlistPathFor, mapCategory, variantLabel };
