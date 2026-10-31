import type { APIMatch, Category, Stream, StreamSource, Sport } from './types';
import { state } from './state';
import { log } from './helpers';
import { isInLiveWindow } from './format';

// ── Request tracking for race condition prevention ──

let loadMatchesRequestId = 0;

/** PPV BFF mount (see embed-proxy/ppv.mjs). */
export const PPV_API = '/api/ppv';
/** StreamFree BFF mount (see embed-proxy/strmfree.mjs) — Streamed's replacement. */
export const STRMFREE_API = '/api/strmfree';

/** Always-on channels have no kick-off, so Today/Popular would hide them all. */
const CHANNELS_SPORT = '24-7';

export function viewCategory(): Category {
  return state.currentSport === CHANNELS_SPORT ? 'all' : state.currentCategory;
}

// ── Generic fetcher ──

/**
 * Same-origin JSON fetch. Streamed (streamed.pk / strmd.link) shut down in
 * October 2026; catalogs now come from the StreamFree and PPV BFFs.
 */
export async function fetchJSON<T>(urlPath: string): Promise<T> {
  const res = await fetch(urlPath, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json() as T;
}

// ── Sports ──

export async function loadSports(): Promise<Sport[]> {
  const data = await fetchJSON<Sport[]>(`${PPV_API}/sports`);
  const sports = Array.isArray(data) ? data : [];
  state.sports = sports;
  return sports;
}

// ── Matches ──

/** StreamFree (1080p, browserless) before PPV on dual-provider cards. */
const SOURCE_PREF: Record<string, number> = {
  strmfree: 0,
  admin: 0,
  alpha: 1,
  bravo: 2,
  charlie: 3,
  echo: 4,
  foxtrot: 5,
  golf: 6,
  hotel: 7,
  intel: 8,
  ppv: 8.5,
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
const PPV_ID_PREFIX = 'ppv:';
const DEDUPE_WINDOW_MS = 30 * 60 * 1000;

export function isStrmfreeSource(source: StreamSource | string): boolean {
  const name = typeof source === 'string' ? source : source.source;
  return String(name || '').toLowerCase() === 'strmfree';
}

/** Display name for a provider/source id. */
export function sourceLabel(source: string): string {
  const name = String(source || '').toLowerCase();
  if (name === 'ppv') return 'PPV';
  if (name === 'strmfree') return 'StreamFree';
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Source';
}

export function isPpvSource(source: StreamSource | string): boolean {
  const name = typeof source === 'string' ? source : source.source;
  return String(name || '').toLowerCase() === 'ppv';
}

/** Stable probe/cache key for a catalog source stub. */
export function sourceProbeKey(source: StreamSource): string {
  return `${source.source}:${source.id}`;
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
  return String(id || '').replace(/^ppv:/, '');
}

function attachPpvSource(existing: APIMatch, stub: StreamSource): void {
  const has = (existing.sources || []).some(
    s => isPpvSource(s) && s.id === stub.id,
  );
  if (!has) {
    existing.sources = rankSources([...(existing.sources || []), stub]);
  }
}

/**
 * Merge the primary catalog (StreamFree) with PPV. Prefer primary cards on
 * fuzzy match; append a ppv source. Prefix PPV-only ids with `ppv:`.
 */
export function mergeMatchLists(
  primary: APIMatch[],
  ppv: APIMatch[],
): APIMatch[] {
  const byKey = new Map<string, APIMatch>();
  const byId = new Map<string, APIMatch>();
  const out: APIMatch[] = [];

  for (const m of primary) {
    if (!m?.id) continue;
    const copy: APIMatch = {
      ...m,
      sources: rankSources([...(m.sources || [])]),
    };
    byKey.set(matchDedupeKey(copy), copy);
    byId.set(bareMatchId(copy.id), copy);
    out.push(copy);
  }

  for (const raw of ppv) {
    if (!raw?.id) continue;
    const category = raw.category || 'football';
    const bareId = bareMatchId(raw.id);
    const stub: StreamSource = {
      source: 'ppv',
      id: bareId,
      category,
    };
    const key = matchDedupeKey(raw);
    const existing = byId.get(bareId) || byKey.get(key);
    if (existing) {
      attachPpvSource(existing, stub);
      // Alias keys (e.g. Wolves → Wolverhampton) onto the survivor.
      byKey.set(key, existing);
      byId.set(bareId, existing);
      continue;
    }
    const id = raw.id.startsWith(PPV_ID_PREFIX)
      ? raw.id
      : `${PPV_ID_PREFIX}${raw.id}`;
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
 * Ask which listed sources actually have embeds. Drop empty stubs so cards
 * never show a fake "1 src". StreamFree and PPV rows are trusted.
 */
export async function filterToPlayableMatches(matches: APIMatch[]): Promise<APIMatch[]> {
  const uniqueSources = new Map<string, StreamSource>();
  for (const match of matches) {
    for (const source of match.sources || []) {
      if (!source?.source || !source?.id) continue;
      const key = sourceProbeKey(source);
      if (!uniqueSources.has(key)) uniqueSources.set(key, source);
    }
  }

  const uniqueEntries = [...uniqueSources.entries()];
  const probeHits = await mapPool(uniqueEntries, STREAM_PROBE_CONCURRENCY, async ([key, source]) => {
    // Both catalogs only list rows that have embeds; probing each StreamFree
    // row would hammer an API that asks to be polled gently.
    if (isStrmfreeSource(source) || isPpvSource(source)) return key;
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
      (match.sources || []).filter(s => workingKeys.has(sourceProbeKey(s))),
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
  // Each provider returns its whole slate; category/sport narrowing below.
  const slate = (api: string) => fetchJSON<APIMatch[]>(`${api}/matches`)
    .then(data => (Array.isArray(data) ? data : []));
  // Each provider is optional on its own; only both failing is an outage.
  const [ppvResult, strmfreeResult] = await Promise.allSettled([slate(PPV_API), slate(STRMFREE_API)]);
  if (requestId !== loadMatchesRequestId) return state.allMatches;
  if (ppvResult.status === 'rejected' && strmfreeResult.status === 'rejected') {
    throw ppvResult.reason;
  }
  const settled = <T,>(r: PromiseSettledResult<T[]>, name: string): T[] => {
    if (r.status === 'fulfilled') return r.value;
    log('warn', `${name} matches failed:`, r.reason);
    return [];
  };

  let matches = mergeMatchLists(
    settled(strmfreeResult, 'StreamFree'),
    settled(ppvResult, 'PPV'),
  ).map(reconcileMatchTeams);

  // Narrow the catalog. Live is the provider's live flag or the kick-off window.
  matches = matches.filter(m => m.sources && m.sources.length > 0);
  const category = viewCategory();
  if (category === 'today') {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
    matches = matches.filter(m => m.date && m.date >= startOfDay && m.date < endOfDay);
  } else if (category === 'live') {
    // Not isMatchLive(): its sticky Live set would keep finished games on the
    // Live tab across auto-refreshes.
    matches = matches.filter(m => isInLiveWindow(m.date) || m.status === 'inprogress');
  } else if (category === 'popular') {
    matches = matches.filter(m => m.popular);
  }

  const sport = state.currentSport.toLowerCase();
  if (sport !== 'all') {
    matches = matches.filter(m => (m.category || '').toLowerCase() === sport);
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

/** Drop cached stream lists for one source so failover re-fetches live embeds. */
export function invalidateStreamsCache(source: string, id: string, category?: string): void {
  streamsCache.delete(`${source}:${id}:${category || ''}`);
}

export async function loadStreams(
  source: string,
  id: string,
  category?: string,
): Promise<Stream[]> {
  const cacheKey = `${source}:${id}:${category || ''}`;
  const cached = streamsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < (cached.data.length ? CACHE_TTL_MS : 10_000)) {
    return cached.data;
  }

  let streams: Stream[] = [];
  if (isPpvSource(source)) {
    streams = await fetchJSON<Stream[]>(`${PPV_API}/stream/${encodeURIComponent(bareMatchId(id))}`);
    if (!Array.isArray(streams)) streams = [];
  } else if (isStrmfreeSource(source)) {
    streams = await fetchJSON<Stream[]>(`${STRMFREE_API}/stream/${encodeURIComponent(id)}`);
    if (!Array.isArray(streams)) streams = [];
  }
  // Any other source is a Streamed stub (e.g. a saved Multi View slot); that
  // provider is gone, so it has no streams.

  streamsCache.set(cacheKey, { data: streams, ts: Date.now() });
  return streams;
}
