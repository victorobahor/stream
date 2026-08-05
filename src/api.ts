import type { APIMatch, Stream, StreamSource, Sport } from './types';
import type { Category } from './types';
import { state, API_HOSTS, getActiveHostIndex, rotateActiveHost } from './state';
import { log } from './helpers';

// ── Request tracking for race condition prevention ──

let loadMatchesRequestId = 0;

// ── Host failover coalesce ──

const HOST_ROTATE_COOLDOWN_MS = 1000;
let lastHostRotateAt = 0;

/** Rotate the active API host at most once per cooldown window across parallel probes. */
function rotateActiveHostCoalesced(): void {
  const now = Date.now();
  if (now - lastHostRotateAt < HOST_ROTATE_COOLDOWN_MS) return;
  lastHostRotateAt = now;
  rotateActiveHost();
}

// ── Generic fetcher ──

export async function fetchJSON<T>(urlPath: string): Promise<T> {
  let attempts = 0;
  while (attempts < API_HOSTS.length) {
    const host = API_HOSTS[getActiveHostIndex()];
    const fullUrl = `${host}${urlPath}`;
    try {
      const res = await fetch(fullUrl, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json() as T;
    } catch (e) {
      log('warn', `Host ${host} failed for ${urlPath}:`, e);
      attempts++;
      rotateActiveHostCoalesced();
    }
  }
  throw new Error('All API mirror domains failed to respond.');
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
  /** Tried in order when the primary endpoint returns an empty list. */
  fallbacks: string[];
  clientSportFilter: boolean;
};

/**
 * Map UI category/sport to Streamed Matches API paths
 * (see https://streamed.pk/docs/matches).
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
    } else {
      // No /matches/{sport}/live|today — filter the global slate client-side.
      endpoint = cat === 'live' ? '/api/matches/live' : '/api/matches/all-today';
      clientSportFilter = true;
    }
  } else {
    switch (cat) {
      case 'live':
        endpoint = '/api/matches/live';
        break;
      case 'today':
        endpoint = '/api/matches/all-today';
        break;
      case 'popular':
        // Hot-now first (documented live/popular), then today's popular, then all.
        endpoint = '/api/matches/live/popular';
        fallbacks = ['/api/matches/all-today/popular', '/api/matches/all/popular'];
        break;
      default:
        endpoint = '/api/matches/all';
        break;
    }
  }
  return { endpoint, fallbacks, clientSportFilter };
}

/** Prefer stable/admin-style sources ahead of flaky embed mints (e.g. delta). */
const SOURCE_PREF: Record<string, number> = {
  admin: 0,
  alpha: 1,
  bravo: 2,
  charlie: 3,
  echo: 4,
  foxtrot: 5,
  golf: 6,
  hotel: 7,
  intel: 8,
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

const STREAM_PROBE_CONCURRENCY = 8;

/**
 * Ask `/api/stream/{source}/{id}` which listed sources actually have embeds.
 * Dedupes by `source:id` so shared sources across matches are probed once.
 * Drops matches with no working source, and rewrites `sources` to only the
 * ones that returned streams. Uses `loadStreams`, so results warm the cache.
 */
export async function filterToPlayableMatches(matches: APIMatch[]): Promise<APIMatch[]> {
  const uniqueSources = new Map<string, StreamSource>();
  for (const match of matches) {
    for (const source of match.sources || []) {
      if (!source?.source || !source?.id) continue;
      const key = `${source.source}:${source.id}`;
      if (!uniqueSources.has(key)) uniqueSources.set(key, source);
    }
  }

  const uniqueEntries = [...uniqueSources.entries()];
  const probeHits = await mapPool(uniqueEntries, STREAM_PROBE_CONCURRENCY, async ([key, source]) => {
    try {
      const streams = await loadStreams(source.source, source.id);
      return streams.length > 0 ? key : null;
    } catch (e) {
      log('warn', `Stream probe failed for ${source.source}/${source.id}:`, e);
      return null;
    }
  });

  const workingKeys = new Set<string>();
  for (const key of probeHits) {
    if (key) workingKeys.add(key);
  }

  const playable: APIMatch[] = [];
  for (const match of matches) {
    const sources = rankSources(
      (match.sources || []).filter(s => workingKeys.has(`${s.source}:${s.id}`)),
    );
    if (sources.length === 0) continue;
    playable.push({ ...match, sources });
  }
  return playable;
}

function commitMatches(matches: APIMatch[]): void {
  // Always clear first so All/Today/Popular never inherit a sticky LIVE set.
  state.liveMatchIds.clear();
  if (state.currentCategory === 'live') {
    matches.forEach(m => {
      if (m.id) state.liveMatchIds.add(m.id);
    });
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
  // Discard stale response if a newer request has started
  if (requestId !== loadMatchesRequestId) return state.allMatches;

  let matches: APIMatch[] = Array.isArray(data) ? data : [];

  // Popular: walk documented popular endpoints when the hot-now slate is empty
  // (e.g. overnight with no live popular matches).
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

  // Client-side filter: "today" endpoint may include non-today matches from the API
  if (state.currentCategory === 'today') {
    const todayStr = new Date().toDateString();
    matches = matches.filter(m => m.date && new Date(m.date).toDateString() === todayStr);
  }

  if (clientSportFilter) {
    matches = matches.filter(m => (m.category || '').toLowerCase() === state.currentSport.toLowerCase());
  }

  // Probe before committing — avoids flashing non-playable cards into the grid
  // (and into filter switches) while streams are still being checked.
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

/** O(1) replacement for the `state.allMatches.find(m => m.id === id)` sweeps. */
export function getMatchById(id: string | undefined | null): APIMatch | undefined {
  if (!id) return undefined;
  return matchIndex.get(id);
}

// ── Streams ──

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const streamsCache = new Map<string, { data: Stream[]; ts: number }>();

export function clearStreamsCache(): void {
  streamsCache.clear();
}

export async function loadStreams(source: string, id: string): Promise<Stream[]> {
  const cacheKey = `${source}:${id}`;
  const cached = streamsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }
  const data = await fetchJSON<Stream[]>(`/api/stream/${source}/${id}`);
  const streams = Array.isArray(data) ? data : [];
  // Cache empties too — the match-list probe would otherwise re-hit every
  // dead source on each refresh, and a short TTL still lets streams appear later.
  streamsCache.set(cacheKey, { data: streams, ts: Date.now() });
  return streams;
}
