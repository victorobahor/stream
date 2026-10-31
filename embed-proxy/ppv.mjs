/**
 * PPV BFF — second catalog alongside StreamFree (replaced SportSRC).
 *
 * Upstream: GET https://api.ppv.st/api/streams → every category and its streams
 * in one payload, each with an `iframe` and HD/SD `substreams`.
 *
 * Mounted at `/api/ppv/*`:
 *   /api/ppv/sports          → Sport[] (the ids the sports bar filters on)
 *   /api/ppv/matches         → APIMatch[] (client filters by category)
 *   /api/ppv/stream/{id}     → Stream[]
 *
 * Playback: `iframe` hosts are throwaway domains that rotate, so streams carry
 * a stable `https://ppv.st/embed/<uri_name>` handle and the HLS proxy looks up
 * the current iframe here. Chromium only ever opens URLs the catalog listed.
 */

const PPV_BASE = (process.env.PPV_BASE_URL || 'https://api.ppv.st/').replace(/\/?$/, '/');
const PREFIX = '/api/ppv';
const CATALOG_TTL_MS = Math.max(15_000, Number(process.env.PPV_CACHE_TTL_MS || 60_000));
const EMBED_ORIGIN = 'https://ppv.st';
/** Players come up shortly before kick-off; earlier opens only burn a Chromium slot. */
const PRE_START_GRACE_MS = 30 * 60_000;
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';

/** Root of the CDN shards PPV playlists are served from (bharat.indianservers.st, …). */
export const PPV_MEDIA_HOSTS = new Set(['indianservers.st']);

/** PPV category → app sport id. */
const CATEGORY_MAP = {
  'american football': 'american-football',
  'australian football': 'afl',
  'combat sports': 'fight',
  'ice hockey': 'hockey',
  motorsports: 'motor-sports',
  '24/7 streams': '24-7',
};

/** PPV's categories, then the sports only StreamFree carries. */
const SPORTS = [
  { id: 'football', name: 'Football' },
  { id: 'american-football', name: 'American Football' },
  { id: 'basketball', name: 'Basketball' },
  { id: 'hockey', name: 'Ice Hockey' },
  { id: 'fight', name: 'Combat Sports' },
  { id: 'wrestling', name: 'Wrestling' },
  { id: 'motor-sports', name: 'Motorsports' },
  { id: 'cricket', name: 'Cricket' },
  { id: 'rugby', name: 'Rugby' },
  { id: 'afl', name: 'Australian Football' },
  { id: 'golf', name: 'Golf' },
  { id: '24-7', name: '24/7 Channels' },
  { id: 'baseball', name: 'Baseball' },
  { id: 'tennis', name: 'Tennis' },
  { id: 'darts', name: 'Darts' },
  { id: 'billiards', name: 'Billiards' },
  { id: 'other', name: 'Other' },
];

function httpError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, ...(code ? { code } : {}) });
}

async function upstreamCatalog() {
  const res = await fetch(new URL('api/streams', PPV_BASE), {
    headers: { Accept: 'application/json', 'User-Agent': UA },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw httpError(`PPV HTTP ${res.status}`, res.status === 429 ? 429 : 502);
  let body;
  try {
    body = await res.json();
  } catch {
    throw httpError('PPV returned non-JSON', 502);
  }
  if (body?.success === false) throw httpError('PPV request failed', 502);
  return body;
}

export function mapCategory(category) {
  const c = String(category || '').toLowerCase();
  return CATEGORY_MAP[c] || c.replace(/\s+/g, '-') || 'other';
}

function isLiveRow(s, now) {
  if (s.always_live) return true;
  return now >= Number(s.starts_at) * 1000 && now < Number(s.ends_at) * 1000;
}

/** Normalize one catalog row into StreamZone's APIMatch. */
export function normalizeStream(s, now = Date.now()) {
  // Channels also sit in sport categories (NFL Network); keep them on one chip.
  const category = s.always_live ? '24-7' : mapCategory(s.category_name);
  const live = isLiveRow(s, now);
  const id = String(s.id);
  return {
    id,
    title: s.name || 'Match',
    category,
    date: s.always_live ? 0 : Number(s.starts_at) * 1000 || 0,
    popular: live && Number(s.viewers) >= 50,
    status: live ? 'inprogress' : undefined,
    poster: s.poster || undefined,
    sources: [{ source: 'ppv', id, category }],
  };
}

/** Rows across every category, once each; a row without a player is unplayable. */
export function catalogRows(payload) {
  const groups = Array.isArray(payload?.streams) ? payload.streams : [];
  const rows = new Map();
  for (const group of groups) {
    for (const s of Array.isArray(group?.streams) ? group.streams : []) {
      if (s?.id && s.iframe && !rows.has(String(s.id))) rows.set(String(s.id), s);
    }
  }
  return rows;
}

/** `HD | NFL Network (ESPN)` → `NFL Network (ESPN)`. */
function broadcasterLabel(sourceTag) {
  return String(sourceTag || '').replace(/^\s*[A-Z0-9]+\s*\|\s*/, '').trim() || 'Stream';
}

/** The row's main stream followed by its substreams (SD rungs, other broadcasters). */
export function normalizeStreams(row) {
  return [row, ...(Array.isArray(row?.substreams) ? row.substreams : [])]
    .filter(s => s?.uri_name && s.iframe)
    .map((s, i) => ({
      id: String(s.id),
      streamNo: i + 1,
      language: broadcasterLabel(s.source_tag),
      hd: /^\s*(HD|FHD|4K)\b/i.test(String(s.source_tag || '')),
      embedUrl: `${EMBED_ORIGIN}/embed/${s.uri_name}`,
      source: 'ppv',
      ...(i === 0 && Number(row.viewers) > 0 ? { viewers: Number(row.viewers) } : {}),
    }));
}

let catalogHit = null;

/** One upstream call per TTL, however many viewers or card clicks are waiting. */
function loadCatalog() {
  if (catalogHit && catalogHit.expires > Date.now()) return catalogHit.value;
  const value = upstreamCatalog().then(payload => {
    const rows = catalogRows(payload);
    const embeds = new Map();
    for (const row of rows.values()) {
      for (const s of [row, ...(Array.isArray(row.substreams) ? row.substreams : [])]) {
        if (s?.uri_name && s.iframe) embeds.set(s.uri_name, { iframe: s.iframe, row });
      }
    }
    return { rows, embeds };
  });
  const entry = { value, expires: Date.now() + CATALOG_TTL_MS };
  catalogHit = entry;
  value.catch(() => {
    if (catalogHit === entry) catalogHit = null;
  });
  return value;
}

function embedUriName(raw) {
  try {
    const u = new URL(String(raw || ''));
    if (u.protocol !== 'https:' || u.hostname !== 'ppv.st' || u.search || u.hash) return null;
    return decodeURI(u.pathname).match(/^\/embed\/([\w-]+(?:[/.][\w-]+)*)$/)?.[1] || null;
  } catch {
    return null;
  }
}

export function isPpvEmbedUrl(raw) {
  return embedUriName(raw) !== null;
}

/**
 * Current iframe for a stable stream handle.
 * @returns {Promise<string>}
 */
export async function resolvePpvEmbed(raw, load = loadCatalog, now = Date.now()) {
  const uriName = embedUriName(raw);
  if (!uriName) throw httpError('Invalid or disallowed embed URL', 400);
  const hit = (await load()).embeds.get(uriName);
  let iframe;
  try {
    iframe = new URL(hit?.iframe);
  } catch {
    throw httpError('This stream is no longer listed', 502, 'HLS_UPSTREAM_ERROR');
  }
  if (iframe.protocol !== 'https:' || iframe.username || iframe.password || iframe.port) {
    throw httpError('This provider has no supported ad-free player', 422);
  }
  if (!hit.row.always_live && Number(hit.row.starts_at) * 1000 - now > PRE_START_GRACE_MS) {
    throw httpError("This stream hasn't started yet", 425, 'STREAM_NOT_STARTED');
  }
  return iframe.href;
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/**
 * Handle `/api/ppv/*` only.
 * @returns {Promise<boolean>} true if handled
 */
export async function tryHandlePpvRequest(req, res) {
  const rawUrl = req.url || '';
  if (!rawUrl.startsWith(PREFIX)) return false;
  const { pathname } = new URL(rawUrl, 'http://localhost');
  const rest = pathname.slice(PREFIX.length) || '/';

  try {
    if (rest === '/sports' || rest === '/sports/') {
      sendJson(res, 200, SPORTS);
      return true;
    }

    if (rest === '/matches' || rest === '/matches/') {
      const { rows } = await loadCatalog();
      const now = Date.now();
      sendJson(res, 200, [...rows.values()].map(row => normalizeStream(row, now)));
      return true;
    }

    const streamMatch = rest.match(/^\/stream\/(\d+)\/?$/);
    if (streamMatch) {
      const { rows } = await loadCatalog();
      const row = rows.get(streamMatch[1]);
      // An unlisted id is "no streams", not an outage.
      sendJson(res, 200, row ? normalizeStreams(row) : []);
      return true;
    }

    sendJson(res, 404, { error: 'Not found' });
    return true;
  } catch (err) {
    sendJson(res, err?.statusCode || 502, { error: err instanceof Error ? err.message : String(err) });
    return true;
  }
}

export const __test = { normalizeStream, normalizeStreams, catalogRows, mapCategory, broadcasterLabel, isLiveRow };
