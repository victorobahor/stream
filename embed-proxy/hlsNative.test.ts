import { describe, it, expect } from 'vitest';
import { __test } from './hlsNative.mjs';

const { unwrapPngTs, rewriteM3uForProxy, absolutizePlaylistUri, isAllowedEmbedUrl } = __test;

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
});
