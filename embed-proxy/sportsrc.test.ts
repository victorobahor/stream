import { describe, it, expect, vi, afterEach } from 'vitest';
import { __test, tryHandleSportsrcRequest } from './sportsrc.mjs';

const { normalizeMatch, normalizeMatchList, normalizeStreams, isLiveTimestamp } = __test;

describe('sportsrc v1 normalize', () => {
  it('normalizes a flat V1 match list with sportsrc stub', () => {
    const now = Date.now();
    const payload = {
      success: true,
      data: [
        {
          id: 'a-vs-b-1',
          title: 'A vs B',
          category: 'football',
          date: now - 60_000,
          popular: true,
          poster: 'https://img.sportsrc.org/p.png',
          teams: {
            home: { name: 'A', badge: 'https://img.sportsrc.org/a.png' },
            away: { name: 'B', badge: 'https://img.sportsrc.org/b.png' },
          },
        },
      ],
    };
    const matches = normalizeMatchList(payload);
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe('a-vs-b-1');
    expect(matches[0].category).toBe('football');
    expect(matches[0].status).toBe('inprogress');
    expect(matches[0].sources).toEqual([
      { source: 'sportsrc', id: 'a-vs-b-1', category: 'football' },
    ]);
  });

  it('maps detail sources to Stream objects', () => {
    const streams = normalizeStreams({
      success: true,
      data: {
        sources: [
          {
            id: 'stream-1',
            streamNo: 1,
            embedUrl: 'https://embed.streamapi.cc/sport/abc/',
            source: 'admin',
            hd: true,
            language: 'English',
            viewers: 100,
          },
        ],
      },
    });
    expect(streams).toHaveLength(1);
    expect(streams[0].embedUrl).toContain('embed.streamapi.cc');
    expect(streams[0].hd).toBe(true);
  });

  it('drops detail rows without embedUrl', () => {
    expect(normalizeStreams({ data: { sources: [{ id: 'x' }] } })).toHaveLength(0);
  });

  it('detects live timestamps within the window', () => {
    expect(isLiveTimestamp(Date.now() - 60_000)).toBe(true);
    expect(isLiveTimestamp(Date.now() + 60_000)).toBe(false);
  });

  it('marks upcoming matches without inprogress status', () => {
    const m = normalizeMatch({
      id: 'x',
      title: 'T',
      category: 'basketball',
      date: Date.now() + 3_600_000,
      popular: false,
      teams: {},
    });
    expect(m.status).toBeUndefined();
    expect(m.sources[0]).toEqual({ source: 'sportsrc', id: 'x', category: 'basketball' });
  });
});

describe('sportsrc upstream retry', () => {
  afterEach(() => vi.unstubAllGlobals());

  function call(url: string) {
    const res = { statusCode: 0, body: '', setHeader() {}, end(b: string) { this.body = b; } };
    return tryHandleSportsrcRequest({ url } as never, res as never).then(() => res);
  }

  it('retries a transient upstream failure once', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: false, error: 'Could not retrieve match list data.' }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { sources: [{ embedUrl: 'https://embed.streamapi.cc/sport/x' }] } })));
    vi.stubGlobal('fetch', fetchMock);
    const res = await call('/api/sportsrc/stream/football/retry-once-1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveLength(1);
  });

  it('does not retry rate limits', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'slow down' }), { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await call('/api/sportsrc/stream/football/rate-limited-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(429);
  });
});
