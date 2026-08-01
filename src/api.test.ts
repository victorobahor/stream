import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { APIMatch } from './types';
import {
  resolveMatchesEndpoint,
  mapPool,
  filterToPlayableMatches,
  clearStreamsCache,
} from './api';

describe('resolveMatchesEndpoint', () => {
  it('should return live endpoint for live category with all sports', () => {
    const result = resolveMatchesEndpoint('live', 'all');
    expect(result.endpoint).toBe('/api/matches/live');
    expect(result.clientSportFilter).toBe(false);
  });

  it('should return all-today endpoint for today category', () => {
    const result = resolveMatchesEndpoint('today', 'all');
    expect(result.endpoint).toBe('/api/matches/all-today');
    expect(result.clientSportFilter).toBe(false);
  });

  it('should return popular endpoint for popular category with all sports', () => {
    const result = resolveMatchesEndpoint('popular', 'all');
    expect(result.endpoint).toBe('/api/matches/all/popular');
    expect(result.clientSportFilter).toBe(false);
  });

  it('should return all endpoint for all category', () => {
    const result = resolveMatchesEndpoint('all', 'all');
    expect(result.endpoint).toBe('/api/matches/all');
    expect(result.clientSportFilter).toBe(false);
  });

  it('should return sport-specific popular endpoint', () => {
    const result = resolveMatchesEndpoint('popular', 'football');
    expect(result.endpoint).toBe('/api/matches/football/popular');
    expect(result.clientSportFilter).toBe(false);
  });

  it('should return sport-specific all endpoint', () => {
    const result = resolveMatchesEndpoint('all', 'basketball');
    expect(result.endpoint).toBe('/api/matches/basketball');
    expect(result.clientSportFilter).toBe(false);
  });

  it('should return live endpoint with client sport filter for live + specific sport', () => {
    const result = resolveMatchesEndpoint('live', 'tennis');
    expect(result.endpoint).toBe('/api/matches/live');
    expect(result.clientSportFilter).toBe(true);
  });

  it('should return all-today endpoint with client sport filter for today + specific sport', () => {
    const result = resolveMatchesEndpoint('today', 'football');
    expect(result.endpoint).toBe('/api/matches/all-today');
    expect(result.clientSportFilter).toBe(true);
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

  it('should keep matches with at least one working source and prune dead ones', async () => {
    mockStreamResponses({
      '/api/stream/echo/dead': [],
      '/api/stream/admin/live': [{ id: 's1', streamNo: 1, language: 'en', hd: true, embedUrl: 'https://embed.st/x', source: 'admin' }],
    });
    const matches: APIMatch[] = [
      {
        ...base,
        id: '1',
        sources: [
          { source: 'echo', id: 'dead' },
          { source: 'admin', id: 'live' },
        ],
      },
      { ...base, id: '2', sources: [{ source: 'echo', id: 'dead' }] },
    ];
    const result = await filterToPlayableMatches(matches);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
    expect(result[0].sources).toEqual([{ source: 'admin', id: 'live' }]);
  });

  it('should preserve original source order among working sources', async () => {
    mockStreamResponses({
      '/api/stream/a/1': [{ id: '1', streamNo: 1, language: 'en', hd: false, embedUrl: 'https://e/1', source: 'a' }],
      '/api/stream/b/2': [{ id: '2', streamNo: 1, language: 'en', hd: false, embedUrl: 'https://e/2', source: 'b' }],
    });
    const matches: APIMatch[] = [
      {
        ...base,
        id: '1',
        sources: [
          { source: 'b', id: '2' },
          { source: 'a', id: '1' },
        ],
      },
    ];
    const result = await filterToPlayableMatches(matches);
    expect(result[0].sources).toEqual([
      { source: 'b', id: '2' },
      { source: 'a', id: '1' },
    ]);
  });

  it('should probe a shared source:id only once across matches', async () => {
    mockStreamResponses({
      '/api/stream/admin/shared': [
        { id: 's1', streamNo: 1, language: 'en', hd: true, embedUrl: 'https://embed.st/x', source: 'admin' },
      ],
    });
    const matches: APIMatch[] = [
      { ...base, id: '1', sources: [{ source: 'admin', id: 'shared' }] },
      { ...base, id: '2', title: 'Other', sources: [{ source: 'admin', id: 'shared' }] },
    ];
    const result = await filterToPlayableMatches(matches);
    expect(result).toHaveLength(2);
    expect(vi.mocked(fetch).mock.calls.length).toBe(1);
  });
});
