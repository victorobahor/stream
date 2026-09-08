import { describe, it, expect } from 'vitest';
import { __test } from './hlsNative.mjs';

const {
  unwrapPngTs,
  rewriteM3uForProxy,
  absolutizePlaylistUri,
  isAllowedEmbedUrl,
  isAllowedMediaHost,
  isCandidatePlaylistUrl,
  isLikelyMediaSegment,
  cookieHeaderFromCookies,
  cookieHeaderFromStorageState,
  cookiesForUrl,
  mediaTransportFor,
  canServeMediaWithoutPage,
  allowsInPageEvaluate,
  upstreamHeadersFromPlayerRequest,
  alternateHlsVariantUrl,
  isFreshCacheHit,
  nodeUpstreamHeaders,
  HLS_IN_PAGE_FETCH_CREDENTIALS,
} = __test;

describe('hlsNative helpers', () => {
  it('accepts embed.st embed URLs only', () => {
    expect(isAllowedEmbedUrl('https://embed.st/embed/admin/foo/1')?.hostname).toBe('embed.st');
    expect(isAllowedEmbedUrl('https://evil.com/embed/admin/foo/1')).toBeNull();
    expect(isAllowedEmbedUrl('http://embed.st/embed/admin/foo/1')).toBeNull();
  });

  it('rewrites m3u media lines through the proxy prefix', () => {
    const src = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=1',
      'high/mono.m3u8',
      'https://cdn.example/seg.ts?sig=a%2Bb',
    ].join('\n');
    const out = rewriteM3uForProxy(src, 'https://lb1.strmd.st/secure/x/1/playlist.m3u8', '/api/hls/abc/p');
    expect(out).toContain('/api/hls/abc/p?u=' + encodeURIComponent('https://lb1.strmd.st/secure/x/1/high/mono.m3u8'));
    // Absolute URIs keep their original encoding (no URL()-reserialize).
    expect(out).toContain('/api/hls/abc/p?u=' + encodeURIComponent('https://cdn.example/seg.ts?sig=a%2Bb'));
    expect(out.split('\n')[0]).toBe('#EXTM3U');
  });

  it('does not reserialize absolute playlist URIs', () => {
    const u = 'https://cdn.example/x.image?sig=a%2Bb%3D';
    expect(absolutizePlaylistUri(u, 'https://lb1.strmd.st/a/playlist.m3u8')).toBe(u);
  });

  it('keeps encryption keys, init segments, and alternate audio behind the proxy', () => {
    const prefix = '/api/hls/abc/p';
    const base = 'https://lb1.strmd.st/live/master.m3u8';
    const rewritten = rewriteM3uForProxy([
      '#EXTM3U',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
      '#EXT-X-MAP:URI="init.mp4"',
      '#EXT-X-MEDIA:TYPE=AUDIO,URI="audio.m3u8"',
      '#EXT-X-I-FRAME-STREAM-INF:URI="iframe.m3u8"',
    ].join('\n'), base, prefix);
    expect(rewritten).toContain(`URI="${prefix}?u=${encodeURIComponent('https://lb1.strmd.st/live/key.bin')}&key=1"`);
    for (const file of ['init.mp4', 'audio.m3u8', 'iframe.m3u8']) {
      expect(rewritten).toContain(`URI="${prefix}?u=${encodeURIComponent(`https://lb1.strmd.st/live/${file}`)}"`);
    }
  });

  it('strips a PNG wrapper leaving the MPEG-TS payload', () => {
    // Minimal 1x1 PNG + fake TS sync byte
    const png = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcff9fa11e000782027f3dc848ef0000000049454e44ae426082',
      'hex',
    );
    const ts = Buffer.from([0x47, 0x40, 0x11, 0x10, 0x00, 0x42]);
    const wrapped = Buffer.concat([png, ts]);
    const out = unwrapPngTs(wrapped);
    expect(out[0]).toBe(0x47);
    expect(Buffer.compare(out, ts)).toBe(0);
  });

  it('leaves non-PNG buffers unchanged', () => {
    const buf = Buffer.from([0x47, 0x40, 0x00]);
    expect(unwrapPngTs(buf)).toBe(buf);
  });

  it('allows only suffix-matched CDN / strmd hosts', () => {
    expect(isAllowedMediaHost('lb1.strmd.st')).toBe(true);
    expect(isAllowedMediaHost('p16-common-sign.tiktokcdn-eu.com')).toBe(true);
    expect(isAllowedMediaHost('evil-tiktok.com')).toBe(false);
    expect(isAllowedMediaHost('nottiktok.com')).toBe(false);
    expect(isAllowedMediaHost('127.0.0.1')).toBe(false);
    expect(isAllowedMediaHost('example.com')).toBe(false);
    expect(isAllowedMediaHost('data.corsservices.workers.dev')).toBe(true);
    expect(isAllowedMediaHost('corsservices.workers.dev')).toBe(true);
    expect(isAllowedMediaHost('evil.workers.dev')).toBe(false);
    expect(isAllowedMediaHost('workers.dev')).toBe(false);
  });

  it('should map high/low Streamed variant playlist URLs onto each other', () => {
    const high = 'https://lb1.strmd.st/secure/x/1/high/mono.m3u8';
    const low = 'https://lb1.strmd.st/secure/x/1/low/mono.m3u8';
    expect(alternateHlsVariantUrl(high)).toBe(low);
    expect(alternateHlsVariantUrl(low)).toBe(high);
    expect(alternateHlsVariantUrl('https://lb1.strmd.st/secure/x/1/playlist.m3u8')).toBeNull();
  });

  it('should treat mint playlist bodies as stale after a few seconds', () => {
    const hit = { buf: Buffer.from('#EXTM3U\n'), ct: 'application/vnd.apple.mpegurl', at: 1_000 };
    expect(isFreshCacheHit(hit, 3_000, 1_500)).toBe(true);
    expect(isFreshCacheHit(hit, 3_000, 5_000)).toBe(false);
    expect(isFreshCacheHit({ buf: Buffer.from('#EXTM3U\n') }, 3_000, 5_000)).toBe(false);
  });

  it('recognizes classic and host-allowlisted playlist URLs', () => {
    expect(isCandidatePlaylistUrl('https://lb1.strmd.st/x/playlist.m3u8', 200)).toBe(true);
    expect(isCandidatePlaylistUrl('https://cdn.tiktokcdn-eu.com/live/index.m3u8', 200)).toBe(true);
    expect(isCandidatePlaylistUrl('https://lb1.strmd.st/x/chunk.m3u8', 200)).toBe(true);
    expect(isCandidatePlaylistUrl('https://evil.com/ads/playlist.m3u8', 200)).toBe(false);
    expect(isCandidatePlaylistUrl('https://lb1.strmd.st/x/playlist.m3u8', 404)).toBe(false);
    expect(isCandidatePlaylistUrl('https://lb1.strmd.st/seg.ts', 200)).toBe(false);
  });

  it('should reject tiny Not-found segment bodies', () => {
    expect(isLikelyMediaSegment(Buffer.from('Not found'))).toBe(false);
    expect(isLikelyMediaSegment(Buffer.from([0x47, 0x40, 0x11]))).toBe(false); // too small
    const ts = Buffer.alloc(188, 0);
    ts[0] = 0x47;
    expect(isLikelyMediaSegment(ts)).toBe(true);
  });

  it('should format Playwright cookies for Node upstream fetches', () => {
    expect(
      cookieHeaderFromCookies([
        { name: 'sid', value: 'abc' },
        { name: 'tok', value: 'xyz' },
      ]),
    ).toBe('sid=abc; tok=xyz');
    expect(
      cookieHeaderFromStorageState({
        cookies: [
          { name: 'sid', value: 'abc' },
          { name: 'tok', value: 'xyz' },
        ],
      }),
    ).toBe('sid=abc; tok=xyz');
  });

  it('should only attach cookies that match the media host', () => {
    const cookies = [
      { name: 'sid', value: '1', domain: 'embed.st', path: '/' },
      { name: 'cdn', value: '2', domain: '.strmd.st', path: '/' },
    ];
    expect(cookieHeaderFromCookies(cookiesForUrl(cookies, 'https://lb12.strmd.st/m/a.ts'))).toBe(
      'cdn=2',
    );
    expect(cookieHeaderFromCookies(cookiesForUrl(cookies, 'https://embed.st/embed/x'))).toBe('sid=1');
  });

  it('should never run page.evaluate for MPEG-TS segments', () => {
    expect(allowsInPageEvaluate('https://lb12.strmd.st/m/abc.ts')).toBe(false);
    expect(allowsInPageEvaluate('https://lb1.strmd.st/secure/x/1/seg.m4s')).toBe(false);
    expect(allowsInPageEvaluate('https://lb1.strmd.st/secure/x/1/high/mono.m3u8')).toBe(true);
    expect(allowsInPageEvaluate('https://lb1.strmd.st/secure/x/1/playlist.m3u8')).toBe(true);
    expect(HLS_IN_PAGE_FETCH_CREDENTIALS).toBe('omit');
  });

  it('should proxy strmd playlists and segments with Node cookies, not page.evaluate', () => {
    expect(mediaTransportFor('https://lb12.strmd.st/m/abc.ts')).toBe('node');
    expect(mediaTransportFor('https://lb1.strmd.st/secure/x/1/high/mono.m3u8')).toBe('node');
    expect(mediaTransportFor('https://lb1.strmd.st/secure/x/1/playlist.m3u8')).toBe('node');
  });

  it('should serve media from stored cookies after the mint page is closed', () => {
    expect(
      canServeMediaWithoutPage({
        cookieHeader: 'sid=abc',
        playlistUrl: 'https://lb1.strmd.st/x/playlist.m3u8',
      }),
    ).toBe(true);
    expect(canServeMediaWithoutPage({ page: {}, playlistUrl: 'https://lb1.strmd.st/x/playlist.m3u8' })).toBe(true);
    expect(canServeMediaWithoutPage({ playlistUrl: 'https://lb1.strmd.st/x/playlist.m3u8' })).toBe(false);
    expect(
      canServeMediaWithoutPage({
        playlistBuf: Buffer.from('#EXTM3U\n'),
        playlistUrl: 'https://lb1.strmd.st/x/playlist.m3u8',
      }),
    ).toBe(true);
  });

  it('should copy Referer/Origin/Cookie from the WASM player request for Node fetches', () => {
    const headers = upstreamHeadersFromPlayerRequest(
      {
        referer: 'https://embed.st/embed/admin/foo/1',
        origin: 'https://embed.st',
        'user-agent': 'Mozilla/5.0 player',
        cookie: 'sid=from-req',
        'x-evil': 'drop-me',
      },
      'sid=from-jar',
    );
    expect(headers.Referer).toBe('https://embed.st/embed/admin/foo/1');
    expect(headers.Origin).toBe('https://embed.st');
    expect(headers['User-Agent']).toBe('Mozilla/5.0 player');
    expect(headers.Cookie).toBe('sid=from-jar');
    expect(headers['x-evil']).toBeUndefined();
    expect(headers['X-Evil']).toBeUndefined();
  });

  it('should fetch upstream with a stable UA and */* Accept, not the WASM request headers', () => {
    const headers = nodeUpstreamHeaders('sid=jar', 'https://embed.st/embed/admin/foo/1');
    expect(headers.Referer).toBe('https://embed.st/embed/admin/foo/1');
    expect(headers.Origin).toBe('https://embed.st');
    expect(headers.Accept).toBe('*/*');
    expect(headers.Cookie).toBe('sid=jar');
    expect(headers['User-Agent']).toContain('Chrome/');
    expect(headers['User-Agent']).not.toContain('player');
  });
});
