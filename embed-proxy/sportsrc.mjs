/**
 * SportSRC V2 BFF — keeps the API key server-side and remaps responses to the
 * shapes StreamZone already consumes (/api/sports, /api/matches, /api/stream).
 *
 * Docs: https://sportsrc.org/v2/#docs
 * Base: https://api.sportsrc.org/v2/
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

loadDotEnv();

const SPORTSRC_BASE = (process.env.SPORTSRC_BASE_URL || 'https://api.sportsrc.org/v2/').replace(
  /\/?$/,
  '/',
);
const API_KEY = process.env.SPORTSRC_API_KEY || '';

/** Short in-memory cache to stay under the free 1k req/day budget. */
const cache = new Map();
const CACHE_TTL_MS = Math.max(5_000, Number(process.env.SPORTSRC_CACHE_TTL_MS || 30_000));

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

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
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
  if (!API_KEY) {
    const err = new Error('SPORTSRC_API_KEY is not configured');
    err.statusCode = 503;
    throw err;
  }
  const url = new URL(SPORTSRC_BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const cacheKey = url.toString();
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-API-KEY': API_KEY,
    },
  });
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
    const err = new Error(body?.message || 'SportSRC request failed');
    err.statusCode = 502;
    throw err;
  }
  cacheSet(cacheKey, body);
  return body;
}

/** Flatten league-grouped matches into StreamZone APIMatch[]. */
export function flattenMatches(payload, sportHint = 'football') {
  const leagues = Array.isArray(payload?.data) ? payload.data : [];
  const out = [];
  for (const league of leagues) {
    const leagueName = league?.league?.name || '';
    const country = league?.league?.country || '';
    for (const m of league?.matches || []) {
      if (!m?.id) continue;
      out.push(normalizeMatch(m, { sport: sportHint, leagueName, country }));
    }
  }
  return out;
}

export function normalizeMatch(m, meta = {}) {
  const sport = meta.sport || 'football';
  const status = String(m.status || '').toLowerCase();
  const homeBadge = m.teams?.home?.badge || '';
  const awayBadge = m.teams?.away?.badge || '';
  return {
    id: m.id,
    title: m.title || 'Match',
    category: sport,
    date: typeof m.timestamp === 'number' ? m.timestamp : Date.parse(m.timestamp) || 0,
    popular: status === 'inprogress',
    status,
    statusDetail: m.status_detail || '',
    league: meta.leagueName || m.league?.name || '',
    country: meta.country || m.league?.country || '',
    score: m.score || undefined,
    poster: undefined,
    teams: {
      home: m.teams?.home
        ? { name: m.teams.home.name || 'Home', badge: homeBadge }
        : undefined,
      away: m.teams?.away
        ? { name: m.teams.away.name || 'Away', badge: awayBadge }
        : undefined,
    },
    // Stub source so the UI can open detail without N+1 probes on the list.
    sources: [{ source: 'sportsrc', id: m.id }],
  };
}

export function normalizeStreams(detailPayload) {
  const sources = detailPayload?.data?.sources;
  if (!Array.isArray(sources)) return [];
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

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.end(payload);
}

/**
 * Handle remapped StreamZone API paths.
 * @returns {Promise<boolean>} true if handled
 */
export async function tryHandleSportsrcRequest(req, res) {
  const rawUrl = req.url || '';
  if (!rawUrl.startsWith('/api/')) return false;
  // Leave HLS + legacy embed proxy alone.
  if (rawUrl.startsWith('/api/hls')) return false;

  const parsed = new URL(rawUrl, 'http://localhost');
  const { pathname } = parsed;

  try {
    if (pathname === '/api/sports') {
      const body = await upstream({ type: 'sports' });
      const sports = Array.isArray(body?.data) ? body.data : [];
      sendJson(res, 200, sports);
      return true;
    }

    if (pathname === '/api/matches' || pathname.startsWith('/api/matches/')) {
      const matches = await loadMatchesForPath(pathname, parsed.searchParams);
      sendJson(res, 200, matches);
      return true;
    }

    // /api/stream/:matchId  or legacy /api/stream/:source/:id → use last segment as match id
    const streamMatch = pathname.match(/^\/api\/stream\/(?:([^/]+)\/)?([^/]+)\/?$/);
    if (streamMatch) {
      const matchId = decodeURIComponent(streamMatch[2]);
      const body = await upstream({ type: 'detail', id: matchId });
      sendJson(res, 200, normalizeStreams(body));
      return true;
    }

    if (pathname === '/api/account') {
      const body = await upstream({ type: 'account' });
      sendJson(res, 200, body?.data ?? body);
      return true;
    }

    return false;
  } catch (err) {
    const status = err?.statusCode || 502;
    sendJson(res, status, {
      error: err instanceof Error ? err.message : String(err),
    });
    return true;
  }
}

/**
 * Map StreamZone category paths onto SportSRC matches queries.
 *   /api/matches/live
 *   /api/matches/all-today
 *   /api/matches/all
 *   /api/matches/all/popular
 *   /api/matches/live/popular
 *   /api/matches/:sport
 *   /api/matches/:sport/popular
 */
async function loadMatchesForPath(pathname, searchParams) {
  const parts = pathname.replace(/^\/api\/matches\/?/, '').split('/').filter(Boolean);
  const date = searchParams.get('date') || todayUtc();

  let sport = 'football';
  let status = '';
  let popularOnly = false;

  if (parts.length === 0 || parts[0] === 'all') {
    // /api/matches or /api/matches/all[/popular]
    popularOnly = parts[1] === 'popular';
    status = '';
  } else if (parts[0] === 'live') {
    status = 'inprogress';
    popularOnly = parts[1] === 'popular';
  } else if (parts[0] === 'all-today') {
    status = '';
    popularOnly = parts[1] === 'popular';
  } else {
    sport = parts[0];
    popularOnly = parts[1] === 'popular';
    status = '';
  }

  // Free tier is football-only — empty for other sports.
  if (sport !== 'all' && sport !== 'football') {
    return [];
  }
  sport = 'football';

  let matches = [];
  if (status === 'inprogress') {
    const body = await upstream({ type: 'matches', sport, status: 'inprogress', date });
    matches = flattenMatches(body, sport);
    if (matches.length === 0 && popularOnly) {
      // Overnight / no live: fall back to today's slate.
      const todayBody = await upstream({ type: 'matches', sport, date });
      matches = flattenMatches(todayBody, sport);
    }
  } else {
    // Day slate: merge notstarted + inprogress + finished (3 cached calls max).
    const statuses = ['inprogress', 'notstarted', 'finished'];
    const seen = new Set();
    for (const st of statuses) {
      const body = await upstream({ type: 'matches', sport, status: st, date });
      for (const m of flattenMatches(body, sport)) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        matches.push(m);
      }
    }
  }

  if (popularOnly) {
    // No Streamed-style popular feed — prefer in-progress, else keep order.
    const live = matches.filter(m => m.status === 'inprogress');
    if (live.length) return live;
  }

  return matches;
}

export const __test = {
  flattenMatches,
  normalizeMatch,
  normalizeStreams,
  todayUtc,
};
