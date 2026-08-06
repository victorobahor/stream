import type { APIMatch, Stream, StreamSource, Sport } from './types';
import type { Category } from './types';
import { state, API_BASE } from './state';
import { log } from './helpers';

// ── Request tracking for race condition prevention ──

let loadMatchesRequestId = 0;

// ── Generic fetcher (same-origin SportSRC BFF) ──

export async function fetchJSON<T>(urlPath: string): Promise<T> {
  const fullUrl = `${API_BASE}${urlPath}`;
  const res = await fetch(fullUrl, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}`);
  }
  return (await res.json()) as T;
}

// ── Sports ──

export async function loadSports(): Promise<Sport[]> {
  const data = await fetchJSON<Sport[]>('/api/sports');
  const sports = Array.isArray(data) ? data : [];
  state.sports = sports;
  return sports;
}

// ── Matches ──

export type MatchesEndpointPlan = {
  endpoint: string;
  fallbacks: string[];
  clientSportFilter: boolean;
};

/**
 * Map UI category/sport onto the SportSRC BFF paths
 * (server flattens league groups and injects the API key).
 */
export function resolveMatchesEndpoint(cat: Category, sport: string): MatchesEndpointPlan {
  let endpoint: string;
  let fallbacks: string[] = [];
  let clientSportFilter = false;

  if (sport !== 'all') {
    if (cat === 'popular') {
      endpoint = `/api/matches/${sport}/popular`;
    } else if (cat === 'all') {
      endpoint = `/api/matches/${sport}`;
    } else if (cat === 'live') {
      endpoint = '/api/matches/live';
      clientSportFilter = true;
    } else {
      endpoint = '/api/matches/all-today';
      clientSportFilter = true;
    }
  } else {
    switch (cat) {
      case 'live':
        endpoint = '/api/matches/live';
        fallbacks = ['/api/matches/all-today'];
        break;
      case 'today':
        endpoint = '/api/matches/all-today';
        break;
      case 'popular':
        endpoint = '/api/matches/live/popular';
        fallbacks = ['/api/matches/all-today/popular', '/api/matches/all-today'];
        break;
      default:
        endpoint = '/api/matches/all';
        break;
    }
  }
  return { endpoint, fallbacks, clientSportFilter };
}

/** Run `fn` over `items` with at most `concurrency` in flight. */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Math.min(Math.max(1, concurrency), items.length);

  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

/**
 * SportSRC free tier is rate-limited (1k/day). List responses already carry a
 * stub source per match; skip mass detail probing.
 */
export async function filterToPlayableMatches(matches: APIMatch[]): Promise<APIMatch[]> {
  return matches
    .filter(m => m.id && (m.sources?.length || 0) > 0)
    .map(m => ({
      ...m,
      sources: rankSources(m.sources || [{ source: 'sportsrc', id: m.id }]),
    }));
}

/** Prefer rapid / sportsrc naming when multiple detail sources exist. */
const SOURCE_PREF: Record<string, number> = {
  rapid: 0,
  sportsrc: 1,
  admin: 2,
  delta: 9,
};

export function rankSources(sources: StreamSource[]): StreamSource[] {
  return [...sources].sort((a, b) => {
    const ra = SOURCE_PREF[String(a.source || '').toLowerCase()] ?? 5;
    const rb = SOURCE_PREF[String(b.source || '').toLowerCase()] ?? 5;
    if (ra !== rb) return ra - rb;
    return String(a.source).localeCompare(String(b.source));
  });
}

/** Pick the best stream: HD first, then viewers, then lowest streamNo. */
export function pickPreferredStream(streams: Stream[]): Stream | undefined {
  if (!streams.length) return undefined;
  return [...streams].sort((a, b) => {
    const hd = Number(!!b.hd) - Number(!!a.hd);
    if (hd !== 0) return hd;
    const viewers = (b.viewers ?? 0) - (a.viewers ?? 0);
    if (viewers !== 0) return viewers;
    return (a.streamNo ?? 0) - (b.streamNo ?? 0);
  })[0];
}

function commitMatches(matches: APIMatch[]): void {
  state.liveMatchIds.clear();
  for (const m of matches) {
    if (!m.id) continue;
    if (m.status === 'inprogress' || state.currentCategory === 'live') {
      state.liveMatchIds.add(m.id);
    }
  }
  state.allMatches = matches;
  indexMatches(matches);
}

export async function loadMatches(): Promise<APIMatch[]> {
  const requestId = ++loadMatchesRequestId;
  const { endpoint, fallbacks, clientSportFilter } = resolveMatchesEndpoint(
    state.currentCategory,
    state.currentSport,
  );

  let data = await fetchJSON<APIMatch[]>(endpoint);
  if (requestId !== loadMatchesRequestId) return state.allMatches;

  let matches: APIMatch[] = Array.isArray(data) ? data : [];

  if (matches.length === 0 && fallbacks.length > 0) {
    for (const fb of fallbacks) {
      data = await fetchJSON<APIMatch[]>(fb);
      if (requestId !== loadMatchesRequestId) return state.allMatches;
      matches = Array.isArray(data) ? data : [];
      if (matches.length > 0) {
        log('debug', `Matches fallback ${fb} returned ${matches.length}`);
        break;
      }
    }
  }

  if (state.currentCategory === 'today') {
    const todayStr = new Date().toDateString();
    matches = matches.filter(m => m.date && new Date(m.date).toDateString() === todayStr);
  }

  if (clientSportFilter) {
    matches = matches.filter(m => (m.category || '').toLowerCase() === state.currentSport.toLowerCase());
  }

  const withSources = matches.filter(m => m.sources && m.sources.length > 0);
  matches = await filterToPlayableMatches(withSources);
  if (requestId !== loadMatchesRequestId) return state.allMatches;

  commitMatches(matches);
  return matches;
}

// ── Match lookup ──

const matchIndex = new Map<string, APIMatch>();

function indexMatches(matches: APIMatch[]): void {
  matchIndex.clear();
  for (const m of matches) {
    if (m.id) matchIndex.set(m.id, m);
  }
}

export function getMatchById(id: string | undefined | null): APIMatch | undefined {
  if (!id) return undefined;
  return matchIndex.get(id);
}

// ── Streams (SportSRC detail) ──

const CACHE_TTL_MS = 5 * 60 * 1000;
const streamsCache = new Map<string, { data: Stream[]; ts: number }>();

export function clearStreamsCache(): void {
  streamsCache.clear();
}

/**
 * Load playable embeds for a match. `source` is ignored — SportSRC detail is
 * keyed by match id only (kept for call-site compatibility).
 */
export async function loadStreams(source: string, id: string): Promise<Stream[]> {
  const matchId = id || source;
  const cacheKey = `sportsrc:${matchId}`;
  const cached = streamsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }
  const data = await fetchJSON<Stream[]>(`/api/stream/${encodeURIComponent(matchId)}`);
  const streams = Array.isArray(data) ? data : [];
  streamsCache.set(cacheKey, { data: streams, ts: Date.now() });
  return streams;
}
