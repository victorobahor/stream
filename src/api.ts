import type { APIMatch, Stream, StreamSource, Sport } from './types';
import type { Category } from './types';
import { state, API_HOSTS, getActiveHostIndex, rotateActiveHost } from './state';
import { log } from './helpers';
import { isMatchLive } from './format';

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

/** Prefer stable/admin-style sources; sportsrc after admin for dual-provider cards. */
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
  sportsrc: 8.5,
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
const SPORTSRC_ID_PREFIX = 'sportsrc:';
const DEDUPE_WINDOW_MS = 30 * 60 * 1000;

export function isSportsrcSource(source: StreamSource | string): boolean {
  const name = typeof source === 'string' ? source : source.source;
  return String(name || '').toLowerCase() === 'sportsrc';
}

function normalizeTitleKey(title: string): string {
  return String(title || '')
    .toLowerCase()
    .replace(/\s+vs\.?\s+/g, ' vs ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Collapse common club nicknames / suffixes so "Wolves" and
 * "Wolverhampton Wanderers" share a dedupe key.
 */
const TEAM_ALIASES: Record<string, string> = {
  wolves: 'wolverhampton wanderers',
  spurs: 'tottenham hotspur',
  tottenham: 'tottenham hotspur',
  'man utd': 'manchester united',
  'man united': 'manchester united',
  'manchester utd': 'manchester united',
  'man city': 'manchester city',
  'nottm forest': 'nottingham forest',
  'nottingham forest': 'nottingham forest',
  psg: 'paris saint germain',
  barca: 'barcelona',
  'inter milan': 'internazionale',
  inter: 'internazionale',
};

export function canonicalizeTeamName(name: string): string {
  let n = normalizeTitleKey(name);
  if (!n) return '';
  if (TEAM_ALIASES[n]) n = TEAM_ALIASES[n];
  n = n
    .replace(/\b(fc|afc|cf|sc)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return TEAM_ALIASES[n] || n;
}

function teamNamesMatch(a: string, b: string): boolean {
  const ca = canonicalizeTeamName(a);
  const cb = canonicalizeTeamName(b);
  if (!ca || !cb) return false;
  return ca === cb || ca.includes(cb) || cb.includes(ca);
}

/** Parse "Home vs Away" (or "Home - Away") from a match title. */
export function parseTitleTeams(
  title: string,
): { home: string; away: string } | null {
  const raw = String(title || '').trim();
  if (!raw) return null;
  const vs = raw.split(/\s+vs\.?\s+/i);
  if (vs.length === 2 && vs[0].trim() && vs[1].trim()) {
    return { home: vs[0].trim(), away: vs[1].trim() };
  }
  const dash = raw.split(/\s+[-–—]\s+/);
  if (dash.length === 2 && dash[0].trim() && dash[1].trim()) {
    return { home: dash[0].trim(), away: dash[1].trim() };
  }
  return null;
}

/**
 * Upstream sometimes flips `teams.home/away` names relative to `title`
 * (and badges). Title order wins; keep badge slots so logos stay put.
 */
export function reconcileMatchTeams(match: APIMatch): APIMatch {
  const parsed = parseTitleTeams(match.title || '');
  if (!parsed || !match.teams?.home || !match.teams?.away) return match;

  const homeName = match.teams.home.name || '';
  const awayName = match.teams.away.name || '';
  if (!homeName || !awayName) return match;

  const aligned =
    teamNamesMatch(homeName, parsed.home) && teamNamesMatch(awayName, parsed.away);
  if (aligned) return match;

  const swapped =
    teamNamesMatch(homeName, parsed.away) && teamNamesMatch(awayName, parsed.home);
  if (!swapped) return match;

  return {
    ...match,
    teams: {
      home: { ...match.teams.home, name: parsed.home },
      away: { ...match.teams.away, name: parsed.away },
    },
  };
}

function matchTeamsKey(m: APIMatch): string {
  const home = m.teams?.home?.name;
  const away = m.teams?.away?.name;
  if (home && away) {
    const pair = [canonicalizeTeamName(home), canonicalizeTeamName(away)]
      .filter(Boolean)
      .sort();
    if (pair.length === 2) return pair.join(' vs ');
  }
  // Title fallback: split on vs and canonicalize each side when possible.
  const raw = normalizeTitleKey(m.title);
  const parts = raw.split(/\s+vs\s+/);
  if (parts.length === 2) {
    const pair = parts.map(canonicalizeTeamName).filter(Boolean).sort();
    if (pair.length === 2) return pair.join(' vs ');
  }
  return raw;
}

function matchDedupeKey(m: APIMatch): string {
  const cat = (m.category || '').toLowerCase();
  const title = matchTeamsKey(m);
  const bucket = Math.floor(Number(m.date || 0) / DEDUPE_WINDOW_MS);
  return `${cat}|${bucket}|${title}`;
}

function bareMatchId(id: string): string {
  return String(id || '').replace(/^sportsrc:/, '');
}

function attachSportsrcSource(existing: APIMatch, stub: StreamSource): void {
  const has = (existing.sources || []).some(
    s => isSportsrcSource(s) && s.id === stub.id,
  );
  if (!has) {
    existing.sources = rankSources([...(existing.sources || []), stub]);
  }
}

/**
 * Merge Streamed + SportSRC lists. Prefer Streamed cards on fuzzy match;
 * append a sportsrc source. Prefix SportSRC-only ids with `sportsrc:`.
 */
export function mergeMatchLists(
  streamed: APIMatch[],
  sportsrc: APIMatch[],
): APIMatch[] {
  const byKey = new Map<string, APIMatch>();
  const byId = new Map<string, APIMatch>();
  const out: APIMatch[] = [];

  for (const m of streamed) {
    if (!m?.id) continue;
    const copy: APIMatch = {
      ...m,
      sources: rankSources([...(m.sources || [])]),
    };
    byKey.set(matchDedupeKey(copy), copy);
    byId.set(bareMatchId(copy.id), copy);
    out.push(copy);
  }

  for (const raw of sportsrc) {
    if (!raw?.id) continue;
    const category = raw.category || 'football';
    const bareId = bareMatchId(raw.id);
    const stub: StreamSource = {
      source: 'sportsrc',
      id: bareId,
      category,
    };
    const key = matchDedupeKey(raw);
    const existing = byId.get(bareId) || byKey.get(key);
    if (existing) {
      attachSportsrcSource(existing, stub);
      // Alias keys (e.g. Wolves → Wolverhampton) onto the survivor.
      byKey.set(key, existing);
      byId.set(bareId, existing);
      continue;
    }
    const id = raw.id.startsWith(SPORTSRC_ID_PREFIX)
      ? raw.id
      : `${SPORTSRC_ID_PREFIX}${raw.id}`;
    const card: APIMatch = {
      ...raw,
      id,
      sources: [stub],
    };
    byKey.set(key, card);
    byId.set(bareId, card);
    out.push(card);
  }

  return out;
}

/**
 * Ask `/api/stream/{source}/{id}` (and SportSRC detail) which listed sources
 * actually have embeds. Drop empty stubs so cards never show a fake "1 src".
 */
export async function filterToPlayableMatches(matches: APIMatch[]): Promise<APIMatch[]> {
  const uniqueSources = new Map<string, StreamSource>();
  for (const match of matches) {
    for (const source of match.sources || []) {
      if (!source?.source || !source?.id) continue;
      const key = isSportsrcSource(source)
        ? `sportsrc:${source.id}:${source.category || ''}`
        : `${source.source}:${source.id}`;
      if (!uniqueSources.has(key)) uniqueSources.set(key, source);
    }
  }

  const uniqueEntries = [...uniqueSources.entries()];
  const probeHits = await mapPool(uniqueEntries, STREAM_PROBE_CONCURRENCY, async ([key, source]) => {
    try {
      const streams = await loadStreams(source.source, source.id, source.category);
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
      (match.sources || []).filter(s => {
        const key = isSportsrcSource(s)
          ? `sportsrc:${s.id}:${s.category || ''}`
          : `${s.source}:${s.id}`;
        return workingKeys.has(key);
      }),
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

  const sportsrcPath = endpoint.replace(/^\/api\//, '/api/sportsrc/');
  const sportsrcFallbacks = fallbacks.map(fb => fb.replace(/^\/api\//, '/api/sportsrc/'));

  const streamedPromise = (async () => {
    let data = await fetchJSON<APIMatch[]>(endpoint);
    let matches: APIMatch[] = Array.isArray(data) ? data : [];
    if (matches.length === 0 && fallbacks.length > 0) {
      for (const fb of fallbacks) {
        data = await fetchJSON<APIMatch[]>(fb);
        matches = Array.isArray(data) ? data : [];
        if (matches.length > 0) {
          log('debug', `Matches fallback ${fb} returned ${matches.length}`);
          break;
        }
      }
    }
    return matches;
  })().catch(err => {
    log('warn', 'Streamed matches failed:', err);
    return [] as APIMatch[];
  });

  const sportsrcPromise = (async () => {
    const tryPath = async (path: string) => {
      const res = await fetch(path, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`SportSRC HTTP ${res.status}`);
      const data = await res.json();
      return (Array.isArray(data) ? data : []) as APIMatch[];
    };
    let matches = await tryPath(sportsrcPath).catch(() => [] as APIMatch[]);
    if (matches.length === 0 && sportsrcFallbacks.length > 0) {
      for (const fb of sportsrcFallbacks) {
        matches = await tryPath(fb).catch(() => [] as APIMatch[]);
        if (matches.length > 0) break;
      }
    }
    return matches;
  })().catch(err => {
    log('warn', 'SportSRC matches failed:', err);
    return [] as APIMatch[];
  });

  const [streamedRaw, sportsrcRaw] = await Promise.all([streamedPromise, sportsrcPromise]);
  if (requestId !== loadMatchesRequestId) return state.allMatches;

  let matches = mergeMatchLists(streamedRaw, sportsrcRaw).map(reconcileMatchTeams);

  // Narrow merged catalog. For Live: trust Streamed's live slate (API may keep
  // long events like motorsport past our 3h window). Only date-gate SportSRC-only
  // rows so popular stubs cannot pollute Live.
  matches = matches.filter(m => m.sources && m.sources.length > 0);
  if (state.currentCategory === 'today') {
    const todayStr = new Date().toDateString();
    matches = matches.filter(m => m.date && new Date(m.date).toDateString() === todayStr);
  } else if (state.currentCategory === 'live') {
    matches = matches.filter(m => {
      if (!String(m.id).startsWith('sportsrc:')) return true;
      return isMatchLive(m) || m.status === 'inprogress';
    });
  } else if (state.currentCategory === 'popular') {
    matches = matches.filter(m => m.popular);
  }

  if (clientSportFilter || state.currentSport !== 'all') {
    const sport = state.currentSport.toLowerCase();
    if (sport !== 'all') {
      matches = matches.filter(m => (m.category || '').toLowerCase() === sport);
    }
  }

  matches = await filterToPlayableMatches(matches);
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

export async function loadStreams(
  source: string,
  id: string,
  category?: string,
): Promise<Stream[]> {
  const cacheKey = `${source}:${id}:${category || ''}`;
  const cached = streamsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  let streams: Stream[] = [];
  if (isSportsrcSource(source)) {
    const cat = category || 'football';
    const matchId = id.replace(/^sportsrc:/, '');
    const res = await fetch(
      `/api/sportsrc/stream/${encodeURIComponent(cat)}/${encodeURIComponent(matchId)}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) throw new Error(`SportSRC stream HTTP ${res.status}`);
    const data = await res.json();
    streams = Array.isArray(data) ? data : [];
  } else {
    const data = await fetchJSON<Stream[]>(`/api/stream/${source}/${id}`);
    streams = Array.isArray(data) ? data : [];
  }

  streamsCache.set(cacheKey, { data: streams, ts: Date.now() });
  return streams;
}
