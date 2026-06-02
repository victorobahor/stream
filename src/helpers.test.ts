import { describe, it, expect } from 'vitest';
import { escapeHtml, sanitizeUrl, matchTextIncludes, debounce, filterMatchesWithSources } from './helpers';
import type { APIMatch } from './types';

describe('escapeHtml', () => {
  it('should escape HTML special characters', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('should escape ampersands', () => {
    expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
  });

  it('should escape single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('should return empty string for falsy values', () => {
    expect(escapeHtml('')).toBe('');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('should convert non-string values to string', () => {
    expect(escapeHtml(123)).toBe('123');
  });
});

describe('sanitizeUrl', () => {
  it('should allow https URLs', () => {
    expect(sanitizeUrl('https://example.com')).toBe('https://example.com');
  });

  it('should allow http URLs', () => {
    expect(sanitizeUrl('http://example.com')).toBe('http://example.com');
  });

  it('should block javascript: protocol', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBe('about:blank');
  });

  it('should block data: protocol', () => {
    expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBe('about:blank');
  });

  it('should block vbscript: protocol', () => {
    expect(sanitizeUrl('vbscript:alert(1)')).toBe('about:blank');
  });

  it('should return empty string for falsy values', () => {
    expect(sanitizeUrl('')).toBe('');
    expect(sanitizeUrl(null)).toBe('');
    expect(sanitizeUrl(undefined)).toBe('');
  });

  it('should handle relative URLs', () => {
    expect(sanitizeUrl('/path/to/resource')).toBe('/path/to/resource');
  });
});

describe('filterMatchesBySearch', () => {
  const matches: APIMatch[] = [
    {
      id: '1',
      title: 'Arsenal vs Chelsea',
      category: 'football',
      date: Date.now(),
      popular: false,
      sources: [],
      teams: {
        home: { name: 'Arsenal', badge: 'ars' },
        away: { name: 'Chelsea', badge: 'che' },
      },
    },
    {
      id: '2',
      title: 'Lakers vs Bulls',
      category: 'basketball',
      date: Date.now(),
      popular: false,
      sources: [],
      teams: {
        home: { name: 'Lakers', badge: 'lak' },
        away: { name: 'Bulls', badge: 'bul' },
      },
    }
  ];

  it('should return all matches when search query is empty', () => {
    expect(filterMatchesBySearch(matches, '')).toEqual(matches);
  });

  it('should return matched matches based on query', () => {
    const result = filterMatchesBySearch(matches, 'arsenal');
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('1');
  });

  it('should return empty array when no matches found', () => {
    expect(filterMatchesBySearch(matches, 'liverpool')).toEqual([]);
  });
});

describe('matchTextIncludes', () => {
  const match: APIMatch = {
    id: '1',
    title: 'Arsenal vs Chelsea',
    category: 'football',
    date: Date.now(),
    popular: false,
    sources: [],
    teams: {
      home: { name: 'Arsenal', badge: 'ars' },
      away: { name: 'Chelsea', badge: 'che' },
    },
  };

  it('should match title', () => {
    expect(matchTextIncludes(match, 'arsenal')).toBe(true);
  });

  it('should match home team name', () => {
    expect(matchTextIncludes(match, 'arsenal')).toBe(true);
  });

  it('should match away team name', () => {
    expect(matchTextIncludes(match, 'chelsea')).toBe(true);
  });

  it('should match category', () => {
    expect(matchTextIncludes(match, 'football')).toBe(true);
  });

  it('should be case insensitive when query is lowercase', () => {
    expect(matchTextIncludes(match, 'arsenal')).toBe(true);
  });

  it('should return false for non-matching query', () => {
    expect(matchTextIncludes(match, 'liverpool')).toBe(false);
  });
});

describe('filterMatchesBySport', () => {
  const matches: APIMatch[] = [
    {
      id: '1',
      title: 'Match 1',
      category: 'football',
      date: Date.now(),
      popular: false,
      sources: [],
    },
    {
      id: '2',
      title: 'Match 2',
      category: 'BASKETBALL',
      date: Date.now(),
      popular: false,
      sources: [],
    },
    {
      id: '3',
      title: 'Match 3',
      category: 'tennis',
      date: Date.now(),
      popular: false,
      sources: [],
    },
    {
      id: '4',
      title: 'Match 4',
      category: undefined,
      date: Date.now(),
      popular: false,
      sources: [],
    },
  ];

  it('should return all matches when sportFilter is "all"', () => {
    expect(filterMatchesBySport(matches, 'all')).toEqual(matches);
  });

  it('should filter matches by exact category match', () => {
    const result = filterMatchesBySport(matches, 'football');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('should filter matches case-insensitively', () => {
    const resultLowercaseFilter = filterMatchesBySport(matches, 'basketball');
    expect(resultLowercaseFilter).toHaveLength(1);
    expect(resultLowercaseFilter[0].id).toBe('2');

    const resultUppercaseFilter = filterMatchesBySport(matches, 'TENNIS');
    expect(resultUppercaseFilter).toHaveLength(1);
    expect(resultUppercaseFilter[0].id).toBe('3');
  });

  it('should handle matches with missing categories gracefully', () => {
    const matchesMissingCat: APIMatch[] = [{ ...matches[0], category: undefined }];
    const result = filterMatchesBySport(matchesMissingCat, 'football');
    expect(result).toHaveLength(0);
  });

  it('should return empty array when no matches match the filter', () => {
    const result = filterMatchesBySport(matches, 'rugby');
    expect(result).toHaveLength(0);
  });
});

describe('debounce', () => {
  it('should debounce function calls', async () => {
    let callCount = 0;
    const fn = debounce(() => { callCount++; }, 100);

    fn();
    fn();
    fn();

    expect(callCount).toBe(0);

    await new Promise(resolve => setTimeout(resolve, 150));
    expect(callCount).toBe(1);
  });
});

describe('filterMatchesWithSources', () => {
  const baseMatch = {
    id: '1',
    title: 'Test',
    category: 'test',
    date: Date.now(),
    popular: false,
  };

  it('should include matches with populated sources', () => {
    const matches: APIMatch[] = [
      { ...baseMatch, sources: [{ source: 'src1', id: '1' }] }
    ];
    const result = filterMatchesWithSources(matches);
    expect(result).toHaveLength(1);
    expect(result[0].sources).toHaveLength(1);
  });

  it('should exclude matches with empty sources array', () => {
    const matches: APIMatch[] = [
      { ...baseMatch, sources: [] }
    ];
    const result = filterMatchesWithSources(matches);
    expect(result).toHaveLength(0);
  });

  it('should exclude matches with missing sources property', () => {
    const matches = [
      { ...baseMatch }
    ] as unknown as APIMatch[];
    const result = filterMatchesWithSources(matches);
    expect(result).toHaveLength(0);
  });

  it('should exclude matches with undefined sources property', () => {
    const matches = [
      { ...baseMatch, sources: undefined }
    ] as unknown as APIMatch[];
    const result = filterMatchesWithSources(matches);
    expect(result).toHaveLength(0);
  });

  it('should handle an empty input array', () => {
    const result = filterMatchesWithSources([]);
    expect(result).toHaveLength(0);
  });

  it('should return only valid matches from a mixed array', () => {
    const matches = [
      { ...baseMatch, id: '1', sources: [{ source: 'src1', id: 's1' }] },
      { ...baseMatch, id: '2', sources: [] },
      { ...baseMatch, id: '3', sources: undefined },
      { ...baseMatch, id: '4', sources: [{ source: 'src2', id: 's2' }] },
      { ...baseMatch, id: '5' }
    ] as unknown as APIMatch[];
    const result = filterMatchesWithSources(matches);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('1');
    expect(result[1].id).toBe('4');
  });
});
