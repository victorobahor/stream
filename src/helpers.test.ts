import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  sanitizeUrl,
  cssUrl,
  matchTextIncludes,
  filterMatchesBySport,
  filterMatchesByCategory,
  debounce,
  filterMatchesWithSources,
  filterMatchesBySearch,
  sortMatchesForDisplay,
  applyEmbed,
  clearEmbed,
  EMBED_ALLOW,
  toProxiedEmbedUrl,
  shouldProxyEmbed,
} from './helpers';
import { state } from './state';
import type { APIMatch } from './types';

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

  it('should block javascript URLs bypassing via control characters', () => {
    expect(sanitizeUrl('\x01javascript:alert(1)')).toBe('about:blank');
    expect(sanitizeUrl('java\x00script:alert(1)')).toBe('about:blank');
    expect(sanitizeUrl('\njavascript:alert(1)')).toBe('about:blank');
    expect(sanitizeUrl(' javascript:alert(1)')).toBe('about:blank');
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

describe('cssUrl', () => {
  it('should strip quotes, backslashes and parentheses so it cannot break out of url()', () => {
    const escaped = cssUrl("https://example.com/a'); background: red; x: url(\"b\\");
    expect(escaped).not.toMatch(/['"\\()]/);
    expect(escaped).toBe('https://example.com/a; background: red; x: urlb');
  });

  it('should pass a plain URL through unchanged', () => {
    expect(cssUrl('https://example.com/poster.webp')).toBe('https://example.com/poster.webp');
  });

  it('should return an empty string for blocked and missing URLs', () => {
    expect(cssUrl('javascript:alert(1)')).toBe('');
    expect(cssUrl(null)).toBe('');
    expect(cssUrl('')).toBe('');
  });
});

// Minimal stand-in: these tests run without a DOM, and all we care about is
// which attributes end up set on the element.
function fakeIframe() {
  const attrs = new Map<string, string>();
  return {
    onload: (() => undefined) as (() => void) | null,
    setAttribute(name: string, value: string) {
      attrs.set(name, value);
    },
    removeAttribute(name: string) {
      attrs.delete(name);
    },
    getAttribute(name: string) {
      return attrs.get(name) ?? null;
    },
  };
}

const ALLOWED_EMBED = 'https://embed.st/embed/admin/ppv-test/1';

describe('applyEmbed', () => {
  it('should navigate to the embed URL', () => {
    const iframe = fakeIframe();
    applyEmbed(iframe as unknown as HTMLIFrameElement, ALLOWED_EMBED);
    expect(iframe.getAttribute('src')).toBe(ALLOWED_EMBED);
  });

  it('should not sandbox the embed', () => {
    // The players detect a sandbox that withholds allow-popups and refuse to
    // start, so embeds are run unrestricted. See applyEmbed's comment.
    const iframe = fakeIframe();
    applyEmbed(iframe as unknown as HTMLIFrameElement, ALLOWED_EMBED);
    expect(iframe.getAttribute('sandbox')).toBeNull();
  });

  it('should clear a sandbox left over from markup or a prior navigation', () => {
    const iframe = fakeIframe();
    iframe.setAttribute('sandbox', 'allow-scripts');
    applyEmbed(iframe as unknown as HTMLIFrameElement, ALLOWED_EMBED);
    expect(iframe.getAttribute('sandbox')).toBeNull();
  });

  it('should grant the playback permissions the players need', () => {
    const iframe = fakeIframe();
    applyEmbed(iframe as unknown as HTMLIFrameElement, ALLOWED_EMBED);
    expect(iframe.getAttribute('allow')).toBe(EMBED_ALLOW);
  });

  it('should set a referrer policy', () => {
    const iframe = fakeIframe();
    applyEmbed(iframe as unknown as HTMLIFrameElement, ALLOWED_EMBED);
    expect(iframe.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
  });

  it('should refuse to navigate to a blocked URL', () => {
    const iframe = fakeIframe();
    applyEmbed(iframe as unknown as HTMLIFrameElement, 'javascript:alert(1)');
    expect(iframe.getAttribute('src')).toBeNull();
    expect(iframe.getAttribute('allow')).toBeNull();
  });

  it('should refuse non-allowlisted embed hosts', () => {
    const iframe = fakeIframe();
    applyEmbed(iframe as unknown as HTMLIFrameElement, 'https://evil.example/embed/x/1');
    expect(iframe.getAttribute('src')).toBeNull();
  });

  it('should load embed.st directly by default (proxy breaks origin checks)', () => {
    const iframe = fakeIframe();
    applyEmbed(
      iframe as unknown as HTMLIFrameElement,
      'https://embed.st/embed/admin/ppv-test/1',
    );
    expect(iframe.getAttribute('src')).toBe('https://embed.st/embed/admin/ppv-test/1');
    expect(iframe.getAttribute('sandbox')).toBeNull();
  });

  it('should route embed.st through /__embed when VITE_EMBED_PROXY=1', () => {
    vi.stubEnv('VITE_EMBED_PROXY', '1');
    const iframe = fakeIframe();
    applyEmbed(
      iframe as unknown as HTMLIFrameElement,
      'https://embed.st/embed/admin/ppv-test/1',
    );
    const src = iframe.getAttribute('src') || '';
    expect(src.startsWith('/__embed?u=')).toBe(true);
    expect(decodeURIComponent(src)).toContain('https://embed.st/embed/admin/ppv-test/1');
    vi.unstubAllEnvs();
  });
});

describe('toProxiedEmbedUrl', () => {
  it('should build a proxy URL for embed.st', () => {
    expect(toProxiedEmbedUrl('https://embed.st/embed/x/1')).toBe(
      '/__embed?u=' + encodeURIComponent('https://embed.st/embed/x/1'),
    );
  });

  it('should return null for non-allowlisted hosts', () => {
    expect(toProxiedEmbedUrl('https://embed.example/stream/1')).toBeNull();
  });
});

describe('shouldProxyEmbed', () => {
  it('should always proxy streamapi wrappers', () => {
    expect(shouldProxyEmbed('https://embed.streamapi.cc/sport/x/')).toBe(true);
  });

  it('should not proxy embed.st by default', () => {
    expect(shouldProxyEmbed('https://embed.st/embed/admin/x/1')).toBe(false);
  });

  it('should always proxy streamapi via applyEmbed', () => {
    const iframe = fakeIframe();
    applyEmbed(
      iframe as unknown as HTMLIFrameElement,
      'https://embed.streamapi.cc/sport/test/',
    );
    expect(iframe.getAttribute('src') || '').toMatch(/^\/__embed\?u=/);
  });
});

describe('clearEmbed', () => {
  it('should navigate to about:blank and drop the load handler', () => {
    const iframe = fakeIframe();
    applyEmbed(iframe as unknown as HTMLIFrameElement, ALLOWED_EMBED);
    clearEmbed(iframe as unknown as HTMLIFrameElement);

    // Removing the src attribute would leave the document — and its audio — running.
    expect(iframe.getAttribute('src')).toBe('about:blank');
    expect(iframe.onload).toBeNull();
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
      category: 'undefined' as unknown as string,
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
    const matchesMissingCat: APIMatch[] = [{ ...matches[0], category: undefined as unknown as string }];
    const result = filterMatchesBySport(matchesMissingCat, 'football');
    expect(result).toHaveLength(0);
  });

  it('should return empty array when no matches match the filter', () => {
    const result = filterMatchesBySport(matches, 'rugby');
    expect(result).toHaveLength(0);
  });
});

describe('filterMatchesByCategory', () => {
  const now = Date.now();
  const matches: APIMatch[] = [
    {
      id: 'live1',
      title: 'Live',
      category: 'football',
      date: now - 60_000,
      popular: true,
      sources: [{ source: 'admin', id: '1' }],
    },
    {
      id: 'ppv-motocross',
      title: 'Long motorsport',
      category: 'motor-sports',
      date: now - 5 * 3_600_000,
      popular: true,
      sources: [{ source: 'admin', id: '2' }],
    },
    {
      id: 'sportsrc:upcoming',
      title: 'SRC only',
      category: 'tennis',
      date: now + 3_600_000,
      popular: false,
      status: undefined,
      sources: [{ source: 'sportsrc', id: 'upcoming', category: 'tennis' }],
    },
    {
      id: 'sportsrc:live-src',
      title: 'SRC live',
      category: 'basketball',
      date: now - 60_000,
      popular: true,
      status: 'inprogress',
      sources: [{ source: 'sportsrc', id: 'live-src', category: 'basketball' }],
    },
  ];

  it('should keep Streamed live-slate matches even outside the 3h window', () => {
    const result = filterMatchesByCategory(matches, 'live');
    expect(result.map(m => m.id)).toContain('ppv-motocross');
    expect(result.map(m => m.id)).toContain('live1');
  });

  it('should date-gate SportSRC-only live cards', () => {
    const result = filterMatchesByCategory(matches, 'live');
    expect(result.map(m => m.id)).not.toContain('sportsrc:upcoming');
    expect(result.map(m => m.id)).toContain('sportsrc:live-src');
  });

  it('should keep popular-only for popular', () => {
    const result = filterMatchesByCategory(matches, 'popular');
    expect(result.map(m => m.id).sort()).toEqual(['live1', 'ppv-motocross', 'sportsrc:live-src'].sort());
  });

  it('should pass through for all', () => {
    expect(filterMatchesByCategory(matches, 'all')).toHaveLength(4);
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

describe('debounce', () => {
  it('should forward the arguments of the last call', async () => {
    let lastArg = '';
    const fn = debounce((arg: string) => { lastArg = arg; }, 100);

    fn('a');
    fn('b');
    fn('c');

    expect(lastArg).toBe('');

    await new Promise(resolve => setTimeout(resolve, 150));
    expect(lastArg).toBe('c');
  });
});

describe('sortMatchesForDisplay', () => {
  const HOUR = 3_600_000;

  const build = (id: string, over: Partial<APIMatch> = {}): APIMatch => ({
    id,
    title: `Match ${id}`,
    category: 'football',
    date: Date.now() + 24 * HOUR,
    popular: false,
    sources: [],
    ...over,
  });

  afterEach(() => {
    state.liveMatchIds.clear();
  });

  it('should put live matches first', () => {
    const upcoming = build('upcoming');
    const live = build('live', { date: Date.now() - HOUR });
    expect(sortMatchesForDisplay([upcoming, live]).map(m => m.id)).toEqual(['live', 'upcoming']);
  });

  it('should rank popular above non-popular at the same liveness', () => {
    const cold = build('cold', { popular: false });
    const hot = build('hot', { popular: true });
    expect(sortMatchesForDisplay([cold, hot]).map(m => m.id)).toEqual(['hot', 'cold']);
  });

  it('should rank EPL above other matches at the same liveness', () => {
    const other = build('other', { title: 'Barcelona vs Real Madrid' });
    const epl = build('epl', { title: 'Premier League: Arsenal vs Chelsea' });
    expect(sortMatchesForDisplay([other, epl]).map(m => m.id)).toEqual(['epl', 'other']);
  });

  it('should fall back to the soonest kickoff', () => {
    const later = build('later', { date: Date.now() + 48 * HOUR });
    const sooner = build('sooner', { date: Date.now() + 2 * HOUR });
    expect(sortMatchesForDisplay([later, sooner]).map(m => m.id)).toEqual(['sooner', 'later']);
  });

  it('should not mutate the input array', () => {
    const input = [build('b', { date: Date.now() + 48 * HOUR }), build('a', { date: Date.now() + 2 * HOUR })];
    sortMatchesForDisplay(input);
    expect(input.map(m => m.id)).toEqual(['b', 'a']);
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
