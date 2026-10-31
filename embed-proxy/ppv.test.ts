import { afterEach, describe, it, expect, vi } from 'vitest';
import { __test, isPpvEmbedUrl, resolvePpvEmbed, tryHandlePpvRequest } from './ppv.mjs';

const { normalizeStream, normalizeStreams, catalogRows, mapCategory, broadcasterLabel } = __test;

const NOW = 1_793_460_000_000;
const row = {
  id: 31091,
  name: 'Notre Dame at Navy',
  source_tag: 'HD | ABC',
  poster: 'https://static.ppvservices.st/p.jpg',
  uri_name: 'cfb/2026-10-31/nd-navy',
  starts_at: NOW / 1000 - 600,
  ends_at: NOW / 1000 + 600,
  always_live: 0,
  category_name: 'American Football',
  iframe: 'https://burner.example/embed/cfb/2026-10-31/nd-navy',
  viewers: '120',
  substreams: [
    { id: 1031091, uri_name: 'cfb/2026-10-31/nd-navy_540p', source_tag: 'SD | ABC', iframe: 'https://burner.example/embed/x_540p' },
    { id: 31092, uri_name: 'no-player', source_tag: 'HD | ESPN' },
  ],
};

describe('ppv normalize', () => {
  it('maps a live row onto APIMatch', () => {
    expect(normalizeStream(row, NOW)).toEqual({
      id: '31091',
      title: 'Notre Dame at Navy',
      category: 'american-football',
      date: row.starts_at * 1000,
      popular: true,
      status: 'inprogress',
      poster: row.poster,
      sources: [{ source: 'ppv', id: '31091', category: 'american-football' }],
    });
  });

  it('keeps upcoming rows off Live and 24/7 rows on it', () => {
    const upcoming = normalizeStream({ ...row, starts_at: NOW / 1000 + 60, ends_at: NOW / 1000 + 120 }, NOW);
    expect(upcoming.status).toBeUndefined();
    expect(upcoming.popular).toBe(false);
    const channel = normalizeStream({ ...row, always_live: 1, starts_at: 0, ends_at: 0 }, NOW);
    expect(channel.status).toBe('inprogress');
    expect(channel.date).toBe(0);
    expect(channel.category).toBe('24-7');
  });

  it('maps categories onto the sports bar ids', () => {
    expect(mapCategory('Football')).toBe('football');
    expect(mapCategory('Ice Hockey')).toBe('hockey');
    expect(mapCategory('Combat Sports')).toBe('fight');
    expect(mapCategory('Motorsports')).toBe('motor-sports');
    expect(mapCategory('24/7 Streams')).toBe('24-7');
    expect(mapCategory('Wrestling')).toBe('wrestling');
    expect(mapCategory('')).toBe('other');
  });

  it('dedupes rows across categories and drops rows without a player', () => {
    const rows = catalogRows({ streams: [{ streams: [row, { id: 2 }] }, { streams: [row] }] });
    expect([...rows.keys()]).toEqual(['31091']);
  });

  it('lists the main stream then playable substreams behind stable handles', () => {
    expect(normalizeStreams(row)).toEqual([
      { id: '31091', streamNo: 1, language: 'ABC', hd: true, embedUrl: 'https://ppv.st/embed/cfb/2026-10-31/nd-navy', source: 'ppv', viewers: 120 },
      { id: '1031091', streamNo: 2, language: 'ABC', hd: false, embedUrl: 'https://ppv.st/embed/cfb/2026-10-31/nd-navy_540p', source: 'ppv' },
    ]);
    expect(broadcasterLabel('')).toBe('Stream');
  });
});

describe('ppv embed handles', () => {
  const load = async () => ({ embeds: new Map([[row.uri_name, { iframe: row.iframe, row }]]), rows: new Map() });

  it('accepts only stream handles on ppv.st', () => {
    expect(isPpvEmbedUrl('https://ppv.st/embed/cfb/2026-10-31/nd-navy')).toBe(true);
    expect(isPpvEmbedUrl('https://ppv.st/embed/a_540p')).toBe(true);
    expect(isPpvEmbedUrl('https://ppv.st/embed/../admin')).toBe(false);
    expect(isPpvEmbedUrl('https://ppv.st/embed/%2e%2e/admin')).toBe(false);
    expect(isPpvEmbedUrl('https://ppv.st/embed/a?x=1')).toBe(false);
    expect(isPpvEmbedUrl('http://ppv.st/embed/a')).toBe(false);
    expect(isPpvEmbedUrl('https://evil.example/embed/a')).toBe(false);
  });

  it('resolves a handle to the iframe the catalog lists', async () => {
    await expect(resolvePpvEmbed('https://ppv.st/embed/cfb/2026-10-31/nd-navy', load, NOW)).resolves.toBe(row.iframe);
  });

  it('refuses handles the catalog does not list', async () => {
    await expect(resolvePpvEmbed('https://ppv.st/embed/other', load, NOW)).rejects.toMatchObject({ statusCode: 502 });
  });

  it('reports a stream far from kick-off as not started', async () => {
    await expect(resolvePpvEmbed(`https://ppv.st/embed/${row.uri_name}`, load, row.starts_at * 1000 - 3_600_000))
      .rejects.toMatchObject({ statusCode: 425, code: 'STREAM_NOT_STARTED' });
  });
});

describe('ppv routes', () => {
  afterEach(() => vi.unstubAllGlobals());

  function call(url: string) {
    const res = { statusCode: 0, body: '', setHeader() {}, end(b: string) { this.body = b; } };
    return tryHandlePpvRequest({ url } as never, res as never).then(handled => ({ handled, res }));
  }

  it('leaves other paths alone and serves the sports list offline', async () => {
    expect((await call('/api/strmfree/matches')).handled).toBe(false);
    const { res } = await call('/api/ppv/sports');
    const ids = JSON.parse(res.body).map((s: { id: string }) => s.id);
    expect(ids.slice(0, 3)).toEqual(['24-7', 'football', 'basketball']);
    expect(ids).toEqual(expect.arrayContaining(['american-football', 'wrestling']));
  });

  it('shares one upstream fetch between matches and stream lookups', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, streams: [{ streams: [row] }] })));
    vi.stubGlobal('fetch', fetchMock);
    const matches = (await call('/api/ppv/matches')).res;
    expect(JSON.parse(matches.body)[0].id).toBe('31091');
    const streams = (await call('/api/ppv/stream/31091')).res;
    expect(JSON.parse(streams.body)).toHaveLength(2);
    const unlisted = (await call('/api/ppv/stream/999')).res;
    expect(unlisted.statusCode).toBe(200);
    expect(JSON.parse(unlisted.body)).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
