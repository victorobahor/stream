import { describe, it, expect } from 'vitest';
import type { APIMatch, Stream } from './types';
import {
  resolveMatchesEndpoint,
  mapPool,
  filterToPlayableMatches,
  rankSources,
  pickPreferredStream,
} from './api';

describe('resolveMatchesEndpoint', () => {
  it('should return live endpoint for live category with all sports', () => {
    const result = resolveMatchesEndpoint('live', 'all');
    expect(result.endpoint).toBe('/api/matches/live');
    expect(result.fallbacks).toEqual(['/api/matches/all-today']);
    expect(result.clientSportFilter).toBe(false);
  });

  it('should return all-today endpoint for today category', () => {
    const result = resolveMatchesEndpoint('today', 'all');
    expect(result.endpoint).toBe('/api/matches/all-today');
    expect(result.clientSportFilter).toBe(false);
  });

  it('should prefer live/popular with today popular fallbacks', () => {
    const result = resolveMatchesEndpoint('popular', 'all');
    expect(result.endpoint).toBe('/api/matches/live/popular');
    expect(result.fallbacks).toEqual([
      '/api/matches/all-today/popular',
      '/api/matches/all-today',
    ]);
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
    expect(result.fallbacks).toEqual([]);
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

describe('rankSources', () => {
  it('should put rapid ahead of delta', () => {
    const ranked = rankSources([
      { source: 'delta', id: 'd1' },
      { source: 'rapid', id: 'r1' },
      { source: 'sportsrc', id: 's1' },
    ]);
    expect(ranked.map(s => s.source)).toEqual(['rapid', 'sportsrc', 'delta']);
  });
});

describe('pickPreferredStream', () => {
  const base = {
    id: 's',
    language: 'English',
    embedUrl: 'https://football77.org/embed/?id=x',
    source: 'rapid',
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

  it('should drop matches with no id or sources', async () => {
    const matches: APIMatch[] = [
      { ...base, id: '', sources: [{ source: 'sportsrc', id: 'x' }] },
      { ...base, id: '2', sources: [] },
    ];
    expect(await filterToPlayableMatches(matches)).toEqual([]);
  });

  it('should keep stub sources without probing (rate-limit safe)', async () => {
    const matches: APIMatch[] = [
      { ...base, id: '1', sources: [{ source: 'sportsrc', id: '1' }] },
      { ...base, id: '2', title: 'Other', sources: [{ source: 'rapid', id: '2' }] },
    ];
    const result = await filterToPlayableMatches(matches);
    expect(result).toHaveLength(2);
    expect(result[0].sources[0].source).toBe('sportsrc');
  });

  it('should rank rapid ahead of delta on stub sources', async () => {
    const matches: APIMatch[] = [
      {
        ...base,
        id: '1',
        sources: [
          { source: 'delta', id: '1' },
          { source: 'rapid', id: '1' },
        ],
      },
    ];
    const result = await filterToPlayableMatches(matches);
    expect(result[0].sources.map(s => s.source)).toEqual(['rapid', 'delta']);
  });
});
