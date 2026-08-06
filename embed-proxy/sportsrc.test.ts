import { describe, it, expect } from 'vitest';
import { __test } from './sportsrc.mjs';

const { flattenMatches, normalizeMatch, normalizeStreams } = __test;

describe('sportsrc normalize', () => {
  it('flattens league-grouped matches', () => {
    const payload = {
      data: [
        {
          league: { name: 'Serie A', country: 'Italy' },
          matches: [
            {
              id: 'a-vs-b-1',
              title: 'A vs B',
              timestamp: 1_700_000_000_000,
              status: 'inprogress',
              teams: {
                home: { name: 'A', badge: 'https://img.sportsrc.org/a.png' },
                away: { name: 'B', badge: 'https://img.sportsrc.org/b.png' },
              },
            },
          ],
        },
      ],
    };
    const matches = flattenMatches(payload, 'football');
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe('a-vs-b-1');
    expect(matches[0].league).toBe('Serie A');
    expect(matches[0].category).toBe('football');
    expect(matches[0].popular).toBe(true);
    expect(matches[0].sources).toEqual([{ source: 'sportsrc', id: 'a-vs-b-1' }]);
    expect(matches[0].teams?.home?.badge).toContain('img.sportsrc.org');
  });

  it('maps detail sources to Stream objects', () => {
    const streams = normalizeStreams({
      data: {
        sources: [
          {
            id: 'stream-1',
            streamNo: 1,
            embedUrl: 'https://football77.org/embed/?id=x&source=rapid',
            source: 'rapid',
            hd: true,
            language: 'English',
          },
        ],
      },
    });
    expect(streams).toHaveLength(1);
    expect(streams[0].embedUrl).toContain('football77.org');
    expect(streams[0].hd).toBe(true);
  });

  it('marks finished matches as not popular', () => {
    const m = normalizeMatch(
      { id: 'x', title: 'T', timestamp: 1, status: 'finished', teams: {} },
      { sport: 'football' },
    );
    expect(m.popular).toBe(false);
    expect(m.status).toBe('finished');
  });
});
