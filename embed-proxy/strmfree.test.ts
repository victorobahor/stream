import { describe, it, expect, vi } from 'vitest';
import { __test, resolveStrmfreePlaylist, isStrmfreeEmbedUrl } from './strmfree.mjs';
import { isAllowedMediaHost } from './hlsNative.mjs';

const { normalizeStream, normalizeStreamList, normalizeSources, parseEmbedPage, playlistPathFor, mapCategory } = __test;

const embedHtml = (live: boolean) => `
  const STREAM_NAME = 'Sky Sports F1';
  const SOURCE_SUFFIX = '2';
  const QUALITY = '1080p';
  const VARIANT = 'skyf1' + QUALITY + SOURCE_SUFFIX;
  const IS_LIVE = ${live};
  const _0x = {"1080p": {"_e": 1793214897, "_n": "7016d758", "_t": "TUPK-v5"}, "720p": {"_e": 1, "_n": "x", "_t": "y"}};
  const data = await window.sfFetch('/get-stream-key/skyf1').then(r => r.json());`;

describe('StreamFree catalog', () => {
  it('maps provider categories onto the app sport ids', () => {
    expect(mapCategory('soccer')).toBe('football');
    expect(mapCategory('football')).toBe('american-football');
    expect(mapCategory('combat')).toBe('fight');
    expect(mapCategory('racing')).toBe('motor-sports');
    expect(mapCategory('tennis')).toBe('tennis');
  });

  it('normalizes a scheduled match with teams and a strmfree source stub', () => {
    const m = normalizeStream({
      name: 'Chelsea vs Liverpool', category: 'soccer', stream_key: 'chelsea-vs-liverpool',
      match_timestamp: 1793215000, viewers: 0, thumbnail_url: 'https://streamfree.top/thumbnails/x',
      sources: ['https://strmfree.st/embed/soccer/chelsea-vs-liverpool1080p'], live_sources: [],
      team1: { name: 'Chelsea', logo: 'https://a.espncdn.com/c.png' }, team2: { name: 'Liverpool', logo: '' },
    });
    expect(m).toMatchObject({
      id: 'chelsea-vs-liverpool', title: 'Chelsea vs Liverpool', category: 'football',
      date: 1793215000_000, popular: false, status: undefined,
      teams: { home: { name: 'Chelsea', badge: 'https://a.espncdn.com/c.png' }, away: { name: 'Liverpool' } },
      sources: [{ source: 'strmfree', id: 'chelsea-vs-liverpool', category: 'football' }],
    });
  });

  it('flags streams with live variants as in progress and drops external ones', () => {
    const list = normalizeStreamList({ streams: [
      { name: 'Sky Sports F1', category: 'racing', stream_key: 'skyf1', match_timestamp: 1782403200, viewers: 80, live_sources: ['x'] },
      { name: 'Elsewhere', category: 'soccer', stream_key: 'ext', is_external: true, live_sources: ['x'] },
    ] });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: 'inprogress', popular: true, category: 'motor-sports' });
  });

  it('lists only live variants once any are up, with readable labels', () => {
    const streams = normalizeSources({
      stream_key: 'skyf1',
      sources: ['https://strmfree.st/embed/racing/skyf11080p', 'https://strmfree.st/embed/racing/skyf11080p2'],
      live_sources: ['https://strmfree.st/embed/racing/skyf11080p2', 'https://evil.example/embed/x/1'],
    });
    expect(streams).toEqual([{
      id: 'skyf1-1', streamNo: 1, language: '1080p · Source 2', hd: true,
      embedUrl: 'https://strmfree.st/embed/racing/skyf11080p2', source: 'strmfree',
    }]);
    expect(normalizeSources({ stream_key: 'k', sources: ['https://strmfree.st/embed/soccer/k720p'], live_sources: [] }))
      .toMatchObject([{ language: '720p', hd: false }]);
  });
});

describe('StreamFree playlist resolution', () => {
  it('parses the playlist recipe from the embed page without running it', () => {
    expect(parseEmbedPage(embedHtml(true))).toEqual({
      variant: 'skyf11080p2', streamKey: 'skyf1', isLive: true,
      token: { _e: 1793214897, _n: '7016d758', _t: 'TUPK-v5' },
    });
    expect(parseEmbedPage('<html>nothing</html>')).toBeNull();
  });

  it('follows the embed player server choice', () => {
    expect(playlistPathFor('v', 'origin')).toBe('/live/v/index.m3u8');
    expect(playlistPathFor('v', 'tiktok')).toBe('/live-tiktok/v/index.m3u8');
    expect(playlistPathFor('v', 'edge-2')).toBe('/live-cdn/v/index.m3u8');
  });

  it('builds the signed playlist URL and the Referer upstream requires', async () => {
    const read = vi.fn()
      .mockResolvedValueOnce({ status: 200, body: embedHtml(true) })
      .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ server_name: 'origin', is_external: false }) });
    const out = await resolveStrmfreePlaylist('https://strmfree.st/embed/racing/skyf11080p2', read);
    expect(out).toEqual({
      playlistUrl: 'https://strmfree.st/live/skyf11080p2/index.m3u8?_t=TUPK-v5&_e=1793214897&_n=7016d758',
      referer: 'https://strmfree.st/embed/racing/skyf11080p2',
    });
    expect(read).toHaveBeenLastCalledWith('https://strmfree.st/get-stream-key/skyf1', 'https://strmfree.st/embed/racing/skyf11080p2');
  });

  it('reports streams that are not live yet as not started', async () => {
    const read = vi.fn().mockResolvedValue({ status: 200, body: embedHtml(false) });
    await expect(resolveStrmfreePlaylist('https://strmfree.st/embed/soccer/x1080p', read))
      .rejects.toMatchObject({ statusCode: 425, code: 'STREAM_NOT_STARTED' });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('only accepts StreamFree embed URLs', async () => {
    expect(isStrmfreeEmbedUrl('https://strmfree.st/embed/racing/skyf11080p')).toBe(true);
    expect(isStrmfreeEmbedUrl('https://strmfree.st/api/v1/streams')).toBe(false);
    expect(isStrmfreeEmbedUrl('https://strmfree.st.evil.example/embed/a/b')).toBe(false);
    await expect(resolveStrmfreePlaylist('https://evil.example/embed/a/b', vi.fn())).rejects.toMatchObject({ statusCode: 400 });
  });

  it('lets the media proxy reach StreamFree hosts and CDN shards only', () => {
    expect(isAllowedMediaHost('strmfree.st')).toBe(true);
    expect(isAllowedMediaHost('cdn1.strmfree.st')).toBe(true);
    expect(isAllowedMediaHost('strmfree.st.evil.example')).toBe(false);
    expect(isAllowedMediaHost('evilstrmfree.st')).toBe(false);
  });
});
