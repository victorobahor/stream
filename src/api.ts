import type { APIMatch, Stream, Sport } from './types';
import type { Category } from './types';
import { state, API_HOSTS, getActiveHostIndex, rotateActiveHost } from './state';
import { log } from './helpers';

// ── Request tracking for race condition prevention ──

let loadMatchesRequestId = 0;

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
      rotateActiveHost();
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

export function resolveMatchesEndpoint(cat: Category, sport: string): { endpoint: string; clientSportFilter: boolean } {
  let endpoint: string;
  let clientSportFilter = false;

  if (sport !== 'all') {
    if (cat === 'popular') {
      endpoint = `/api/matches/${sport}/popular`;
    } else if (cat === 'all') {
      endpoint = `/api/matches/${sport}`;
    } else {
      endpoint = cat === 'live' ? '/api/matches/live' : '/api/matches/all-today';
      clientSportFilter = true;
    }
  } else {
    switch (cat) {
      case 'live': endpoint = '/api/matches/live'; break;
      case 'today': endpoint = '/api/matches/all-today'; break;
      case 'popular': endpoint = '/api/matches/all/popular'; break;
      default: endpoint = '/api/matches/all'; break;
    }
  }
  return { endpoint, clientSportFilter };
}

export async function loadMatches(): Promise<APIMatch[]> {
  const requestId = ++loadMatchesRequestId;
  const { endpoint, clientSportFilter } = resolveMatchesEndpoint(state.currentCategory, state.currentSport);
  const data = await fetchJSON<APIMatch[]>(endpoint);

  // Discard stale response if a newer request has started
  if (requestId !== loadMatchesRequestId) return state.allMatches;

  let matches: APIMatch[] = Array.isArray(data) ? data : [];

  if (state.currentCategory === 'live') {
    state.liveMatchIds.clear();
    matches.forEach(m => state.liveMatchIds.add(m.id));
  }

  // Client-side filter: "today" endpoint may include non-today matches from the API
  if (state.currentCategory === 'today') {
    const todayStr = new Date().toDateString();
    matches = matches.filter(m => m.date && new Date(m.date).toDateString() === todayStr);
  }

  if (clientSportFilter) {
    matches = matches.filter(m => (m.category || '').toLowerCase() === state.currentSport.toLowerCase());
  }

  state.allMatches = matches;
  return matches;
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
  streamsCache.set(cacheKey, { data: streams, ts: Date.now() });
  return streams;
}
