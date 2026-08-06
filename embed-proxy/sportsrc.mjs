/**
 * SportSRC V1 BFF — remaps keyless `?data=` endpoints under `/api/sportsrc/*`.
 *
 * Docs: https://www.sportsrc.org/
 * Base: https://api.sportsrc.org/
 *   ?data=sports
 *   ?data=matches&category=football
 *   ?data=detail&category=football&id=…
 *
 * Mounted at `/api/sportsrc/*` so Streamed browser calls to streamed.pk are
 * never shadowed. V1 is keyless; optional API key kept for future use.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

loadDotEnv();

const SPORTSRC_BASE = (process.env.SPORTSRC_BASE_URL || 'https://api.sportsrc.org/').replace(
  /\/?$/,
  '/',
);
/** Optional — V1 is keyless; kept for future whitelisting. */
const API_KEY = process.env.SPORTSRC_API_KEY || '';

const cache = new Map();
const CACHE_TTL_MS = Math.max(5_000, Number(process.env.SPORTSRC_CACHE_TTL_MS || 30_000));
const LIVE_WINDOW_MS = 3 * 60 * 60 * 1000;
const PREFIX = '/api/sportsrc';

function loadDotEnv() {
  try {
    const envPath = path.join(__dirname, '..', '.env');
    const text = fs.readFileSync(envPath, 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* optional */
  }
}

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expires <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
}

async function upstream(params) {
  const url = new URL(SPORTSRC_BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const cacheKey = url.toString();
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  /** @type {Record<string, string>} */
  const headers = { Accept: 'application/json' };
  if (API_KEY) headers['X-API-KEY'] = API_KEY;

  const res = await fetch(url, { headers });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    const err = new Error(`SportSRC non-JSON (${res.status})`);
    err.statusCode = 502;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(body?.message || body?.error || `SportSRC HTTP ${res.status}`);
    err.statusCode = res.status === 429 ? 429 : 502;
    throw err;
  }
  if (body && body.success === false) {
    const err = new Error(body?.message || body?.error || 'SportSRC request failed');
    err.statusCode = 502;
    throw err;
  }
  cacheSet(cacheKey, body);
  return body;
}

function isLiveTimestamp(ts) {
  if (!ts) return false;
  const diff = Date.now() - Number(ts);
  return diff >= 0 && diff < LIVE_WINDOW_MS;
}

/** Normalize a V1 match list item into StreamZone APIMatch. */
export function normalizeMatch(m) {
  const category = m.category || 'football';
  const date = typeof m.date === 'number' ? m.date : Date.parse(m.date) || 0;
  const live = isLiveTimestamp(date);
  return {
    id: m.id,
    title: m.title || 'Match',
    category,
    date,
    popular: !!m.popular,
    status: live ? 'inprogress' : undefined,
    poster: m.poster || undefined,
    teams: {
      home: m.teams?.home
        ? { name: m.teams.home.name || 'Home', badge: m.teams.home.badge || '' }
        : undefined,
      away: m.teams?.away
        ? { name: m.teams.away.name || 'Away', badge: m.teams.away.badge || '' }
        : undefined,
    },
    // Provider-tagged stub; client prefixes id and calls /api/sportsrc/stream/...
    sources: [{ source: 'sportsrc', id: m.id, category }],
  };
}

export function normalizeMatchList(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
  return rows.filter(m => m?.id).map(normalizeMatch);
}

export function normalizeStreams(detailPayload) {
  const data = detailPayload?.data;
  const sources = Array.isArray(data?.sources) ? data.sources : Array.isArray(data) ? data : [];
  return sources
    .filter(s => s && s.embedUrl)
    .map((s, i) => ({
      id: s.id || `stream-${i + 1}`,
      streamNo: s.streamNo ?? i + 1,
      language: s.language || 'Unknown',
      hd: !!s.hd,
      embedUrl: s.embedUrl,
      source: s.source || 'sportsrc',
      viewers: typeof s.viewers === 'number' ? s.viewers : undefined,
    }));
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function listSports() {
  const body = await upstream({ data: 'sports' });
  return Array.isArray(body?.data) ? body.data : [];
}

async function matchesForCategory(category) {
  const body = await upstream({ data: 'matches', category });
  return normalizeMatchList(body);
}

async function matchesForAllSports() {
  const sports = await listSports();
  const ids = sports.map(s => s.id).filter(Boolean);
  const chunks = await Promise.all(
    ids.map(async id => {
      try {
        return await matchesForCategory(id);
      } catch {
        return [];
      }
    }),
  );
  const seen = new Set();
  const out = [];
  for (const list of chunks) {
    for (const m of list) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
}

/**
 * Handle `/api/sportsrc/*` only.
 * @returns {Promise<boolean>} true if handled
 */
export async function tryHandleSportsrcRequest(req, res) {
  const rawUrl = req.url || '';
  if (!rawUrl.startsWith(PREFIX)) return false;

  const parsed = new URL(rawUrl, 'http://localhost');
  const { pathname } = parsed;
  const rest = pathname.slice(PREFIX.length) || '/';

  try {
    if (rest === '/sports' || rest === '/sports/') {
      sendJson(res, 200, await listSports());
      return true;
    }

    if (rest === '/matches' || rest.startsWith('/matches/')) {
      sendJson(res, 200, await loadMatchesForPath(rest));
      return true;
    }

    // /stream/:category/:matchId  or  /stream/:matchId?category=
    const streamMatch = rest.match(/^\/stream\/([^/]+)(?:\/([^/]+))?\/?$/);
    if (streamMatch) {
      let category;
      let id;
      if (streamMatch[2]) {
        category = decodeURIComponent(streamMatch[1]);
        id = decodeURIComponent(streamMatch[2]);
      } else {
        category = parsed.searchParams.get('category') || 'football';
        id = decodeURIComponent(streamMatch[1]);
      }
      if (category === 'sportsrc') category = parsed.searchParams.get('category') || 'football';
      const body = await upstream({ data: 'detail', category, id });
      sendJson(res, 200, normalizeStreams(body));
      return true;
    }

    if (rest === '/account' || rest === '/account/') {
      sendJson(res, 200, {
        plan: 'V1',
        note: 'SportSRC V1 is keyless; no account endpoint.',
      });
      return true;
    }

    sendJson(res, 404, { error: 'Not found' });
    return true;
  } catch (err) {
    const status = err?.statusCode || 502;
    sendJson(res, status, {
      error: err instanceof Error ? err.message : String(err),
    });
    return true;
  }
}

/**
 * Map StreamZone-style match paths onto SportSRC V1.
 *   /matches/live[/popular]
 *   /matches/all-today[/popular]
 *   /matches/all[/popular]
 *   /matches/:sport[/popular]
 */
async function loadMatchesForPath(rest) {
  const parts = rest.replace(/^\/matches\/?/, '').split('/').filter(Boolean);
  let sport = 'all';
  let mode = 'all';
  let popularOnly = false;

  if (parts.length === 0 || parts[0] === 'all') {
    mode = 'all';
    popularOnly = parts[1] === 'popular';
  } else if (parts[0] === 'live') {
    mode = 'live';
    popularOnly = parts[1] === 'popular';
  } else if (parts[0] === 'all-today') {
    mode = 'today';
    popularOnly = parts[1] === 'popular';
  } else {
    sport = parts[0];
    popularOnly = parts[1] === 'popular';
    mode = popularOnly ? 'popular' : 'all';
  }

  let matches =
    sport === 'all' ? await matchesForAllSports() : await matchesForCategory(sport);

  if (mode === 'live') {
    // Strict live window only — no popular fallback. In dual-provider mode a
    // popular fallback would pollute Streamed's Live tab with non-live cards.
    matches = matches.filter(m => isLiveTimestamp(m.date) || m.status === 'inprogress');
  } else if (mode === 'today') {
    const todayStr = new Date().toDateString();
    matches = matches.filter(m => m.date && new Date(m.date).toDateString() === todayStr);
  } else if (mode === 'popular' || popularOnly) {
    matches = matches.filter(m => m.popular);
  }

  if (popularOnly && mode === 'live') {
    const hot = matches.filter(m => m.popular);
    if (hot.length) matches = hot;
  }

  return matches;
}

export const __test = {
  normalizeMatch,
  normalizeMatchList,
  normalizeStreams,
  isLiveTimestamp,
};
