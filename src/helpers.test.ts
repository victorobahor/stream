import { describe, it, expect } from 'vitest';
import { escapeHtml, sanitizeUrl, matchTextIncludes, sortMatchesByLive, debounce } from './helpers';
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

describe('sortMatchesByLive', () => {
  const match1: APIMatch = { id: '1', title: 'M1', date: 0, category: 'foo', popular: false, sources: [], teams: {} as any };
  const match2: APIMatch = { id: '2', title: 'M2', date: 0, category: 'foo', popular: false, sources: [], teams: {} as any };
  const match3: APIMatch = { id: '3', title: 'M3', date: 0, category: 'foo', popular: false, sources: [], teams: {} as any };
  const matches = [match1, match2, match3];

  it('should sort live matches before non-live matches', () => {
    const liveIds = new Set(['2', '3']);
    const sorted = sortMatchesByLive(matches, liveIds);
    expect(sorted.length).toBe(3);
    // 2 and 3 should come before 1.
    // Order between 2 and 3 should be preserved from original array (stable sort or original order).
    expect(sorted[0].id).toBe('2');
    expect(sorted[1].id).toBe('3');
    expect(sorted[2].id).toBe('1');
  });

  it('should return a new array and not mutate the original', () => {
    const liveIds = new Set(['2']);
    const sorted = sortMatchesByLive(matches, liveIds);
    expect(sorted).not.toBe(matches);
    expect(matches[0].id).toBe('1'); // original array untouched
    expect(sorted[0].id).toBe('2');
  });

  it('should handle undefined liveMatchIds gracefully', () => {
    const sorted = sortMatchesByLive(matches, undefined);
    expect(sorted).toEqual(matches);
    expect(sorted).not.toBe(matches); // still returns a new array
  });

  it('should handle an empty array correctly', () => {
    const sorted = sortMatchesByLive([], new Set(['1']));
    expect(sorted).toEqual([]);
  });

  it('should preserve original order if no matches are live', () => {
    const sorted = sortMatchesByLive(matches, new Set(['4']));
    expect(sorted).toEqual(matches);
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
