import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { APIMatch } from './types';
import {
  mapPool,
  filterToPlayableMatches,
  clearStreamsCache,
  rankSources,
  pickPreferredStream,
  mergeMatchLists,
  reconcileMatchTeams,
} from './api';
import type { Stream } from './types';

describe('rankSources', () => {
  it('should put admin ahead of delta', () => {
    const ranked = rankSources([
      { source: 'delta', id: 'd1' },
      { source: 'admin', id: 'a1' },
      { source: 'echo', id: 'e1' },
    ]);
    expect(ranked.map(s => s.source)).toEqual(['admin', 'echo', 'delta']);
  });
});

describe('pickPreferredStream', () => {
  const base = {
    id: 's',
    language: 'English',
    embedUrl: 'https://embed.st/embed/x/1',
    source: 'admin',
  };

  it('should prefer HD, then higher viewers', () => {
    const streams: Stream[] = [
      { ...base, streamNo: 1, hd: false, viewers: 500 },
      { ...base, streamNo: 2, hd: true, viewers: 10 },
      { ...base, streamNo: 3, hd: true, viewers: 200 },
    ];
    expect(pickPreferredStream(streams)?.streamNo).toBe(3);
  });

  it('should return undefined for an empty list', () => {
    expect(pickPreferredStream([])).toBeUndefined();
  });
});

describe('mapPool', () => {
  it('should preserve order and honor concurrency', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const result = await mapPool([1, 2, 3, 4, 5], 2, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(r => setTimeout(r, 10));
      inFlight--;
      return n * 2;
    });
    expect(result).toEqual([2, 4, 6, 8, 10]);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it('should return an empty array for empty input', async () => {
    expect(await mapPool([], 4, async x => x)).toEqual([]);
  });
});

describe('filterToPlayableMatches', () => {
  const base = {
    title: 'Test',
    category: 'football',
    date: Date.now(),
    popular: false,
  };

  beforeEach(() => {
    clearStreamsCache();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearStreamsCache();
  });

  function mockStreamResponses(map: Record<string, unknown>): void {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      const key = Object.keys(map).find(k => url.includes(k));
      const body = key ? map[key] : [];
      return new Response(JSON.stringify(body), { status: 200 });
    });
  }

  it('should drop matches whose sources all return empty streams', async () => {
    mockStreamResponses({
      '/api/stream/echo/dead': [],
    });
    const matches: APIMatch[] = [
      { ...base, id: '1', sources: [{ source: 'echo', id: 'dead' }] },
    ];
    expect(await filterToPlayableMatches(matches)).toEqual([]);
  });

  const liveStream = {
    id: 's1', streamNo: 1, language: 'en', hd: true, embedUrl: 'https://ppv.st/embed/x', source: 'ppv',
  };

  it('should drop legacy Streamed sources without a network request', async () => {
    mockStreamResponses({ '/api/stream/admin/live': [liveStream] });
    const matches: APIMatch[] = [
      { ...base, id: '1', sources: [{ source: 'admin', id: 'live' }] },
    ];
    expect(await filterToPlayableMatches(matches)).toEqual([]);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('should trust ppv and strmfree rows without a network request', async () => {
    mockStreamResponses({});
    const matches: APIMatch[] = [
      { ...base, id: 'ppv:x', sources: [{ source: 'ppv', id: 'x', category: 'football' }] },
      { ...base, id: 'y', title: 'Other', sources: [{ source: 'strmfree', id: 'y', category: 'football' }] },
    ];
    expect(await filterToPlayableMatches(matches)).toHaveLength(2);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});

describe('mergeMatchLists', () => {
  // Dedupe keys bucket by 30m windows — pin inside a window so +1m never crosses.
  const DEDUPE_WINDOW_MS = 30 * 60 * 1000;
  const now = Math.floor(Date.now() / DEDUPE_WINDOW_MS) * DEDUPE_WINDOW_MS + 5 * 60 * 1000;

  it('should prefix PPV-only ids and keep Streamed cards', () => {
    const streamed: APIMatch[] = [
      {
        id: 's1',
        title: 'Alpha vs Beta',
        category: 'football',
        date: now,
        popular: true,
        sources: [{ source: 'admin', id: 's1' }],
        teams: { home: { name: 'Alpha', badge: 'a' }, away: { name: 'Beta', badge: 'b' } },
      },
    ];
    const ppv: APIMatch[] = [
      {
        id: 'other-match',
        title: 'Gamma vs Delta',
        category: 'football',
        date: now,
        popular: false,
        sources: [{ source: 'ppv', id: 'other-match', category: 'football' }],
        teams: { home: { name: 'Gamma', badge: 'g' }, away: { name: 'Delta', badge: 'd' } },
      },
    ];
    const merged = mergeMatchLists(streamed, ppv);
    expect(merged).toHaveLength(2);
    expect(merged.find(m => m.id === 's1')).toBeTruthy();
    expect(merged.find(m => m.id === 'ppv:other-match')).toBeTruthy();
  });

  it('should dedupe fuzzy matches onto the Streamed card', () => {
    const streamed: APIMatch[] = [
      {
        id: 's1',
        title: 'Alpha vs Beta',
        category: 'football',
        date: now,
        popular: true,
        sources: [{ source: 'admin', id: 's1' }],
        teams: { home: { name: 'Alpha', badge: 'a' }, away: { name: 'Beta', badge: 'b' } },
      },
    ];
    const ppv: APIMatch[] = [
      {
        id: 'alpha-vs-beta-99',
        title: 'Alpha vs Beta',
        category: 'football',
        date: now + 60_000,
        popular: true,
        sources: [{ source: 'ppv', id: 'alpha-vs-beta-99', category: 'football' }],
        teams: { home: { name: 'Alpha', badge: 'a' }, away: { name: 'Beta', badge: 'b' } },
      },
    ];
    const merged = mergeMatchLists(streamed, ppv);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('s1');
    expect(merged[0].sources.map(s => s.source)).toEqual(['admin', 'ppv']);
  });

  it('should merge club nicknames (Wolves → Wolverhampton Wanderers)', () => {
    const streamed: APIMatch[] = [
      {
        id: 'wolverhampton-wanderers-vs-port-vale-2503731',
        title: 'Wolverhampton Wanderers vs Port Vale',
        category: 'football',
        date: now,
        popular: true,
        sources: [{ source: 'admin', id: 'ppv-wolves' }],
        teams: {
          home: { name: 'Wolverhampton Wanderers', badge: 'a' },
          away: { name: 'Port Vale', badge: 'b' },
        },
      },
    ];
    const ppv: APIMatch[] = [
      {
        id: 'wolves-vs-port-vale-football-1567419',
        title: 'Wolves vs Port Vale',
        category: 'football',
        date: now,
        popular: true,
        sources: [{ source: 'ppv', id: 'wolves-vs-port-vale-football-1567419', category: 'football' }],
        teams: {
          home: { name: 'Wolves', badge: 'a' },
          away: { name: 'Port Vale', badge: 'b' },
        },
      },
      {
        id: 'wolverhampton-wanderers-vs-port-vale-2503731',
        title: 'Wolverhampton Wanderers vs Port Vale',
        category: 'football',
        date: now,
        popular: true,
        sources: [{ source: 'ppv', id: 'wolverhampton-wanderers-vs-port-vale-2503731', category: 'football' }],
        teams: {
          home: { name: 'Wolverhampton Wanderers', badge: 'a' },
          away: { name: 'Port Vale', badge: 'b' },
        },
      },
    ];
    const merged = mergeMatchLists(streamed, ppv);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('wolverhampton-wanderers-vs-port-vale-2503731');
    expect(merged[0].sources.filter(s => s.source === 'ppv')).toHaveLength(2);
  });

  it('should merge PPV rows that reuse a Streamed match id', () => {
    const streamed: APIMatch[] = [
      {
        id: 'same-id-1',
        title: 'Gamma United vs Delta',
        category: 'football',
        date: now,
        popular: false,
        sources: [{ source: 'admin', id: 'same-id-1' }],
        teams: {
          home: { name: 'Gamma United', badge: 'g' },
          away: { name: 'Delta', badge: 'd' },
        },
      },
    ];
    const ppv: APIMatch[] = [
      {
        id: 'same-id-1',
        title: 'Gamma vs Delta FC',
        category: 'football',
        date: now + 120_000,
        popular: false,
        sources: [{ source: 'ppv', id: 'same-id-1', category: 'football' }],
        teams: {
          home: { name: 'Gamma', badge: 'g' },
          away: { name: 'Delta FC', badge: 'd' },
        },
      },
    ];
    const merged = mergeMatchLists(streamed, ppv);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('same-id-1');
    expect(merged[0].sources.map(s => s.source)).toEqual(['admin', 'ppv']);
  });
});

describe('reconcileMatchTeams', () => {
  it('should fix flipped home/away names to match the title (PSG vs Man Utd)', () => {
    const match: APIMatch = {
      id: 'paris-saint-germain-vs-manchester-united-2558870',
      title: 'Paris Saint-Germain vs Manchester United',
      category: 'football',
      date: Date.now(),
      popular: false,
      sources: [{ source: 'echo', id: 'x' }],
      teams: {
        home: { name: 'Manchester United', badge: 'psg-badge' },
        away: { name: 'Paris Saint-Germain', badge: 'utd-badge' },
      },
    };
    const fixed = reconcileMatchTeams(match);
    expect(fixed.teams?.home?.name).toBe('Paris Saint-Germain');
    expect(fixed.teams?.away?.name).toBe('Manchester United');
    // Badges stay in their slots (they already followed title order).
    expect(fixed.teams?.home?.badge).toBe('psg-badge');
    expect(fixed.teams?.away?.badge).toBe('utd-badge');
  });

  it('should leave already-aligned teams alone', () => {
    const match: APIMatch = {
      id: 'a',
      title: 'Arsenal vs Chelsea',
      category: 'football',
      date: Date.now(),
      popular: false,
      sources: [],
      teams: {
        home: { name: 'Arsenal', badge: 'a' },
        away: { name: 'Chelsea', badge: 'c' },
      },
    };
    expect(reconcileMatchTeams(match)).toBe(match);
  });
});
