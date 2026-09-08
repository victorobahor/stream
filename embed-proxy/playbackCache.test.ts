import { describe, it, expect, vi } from 'vitest';
import { cacheMedia, cachedMedia, loadMedia } from './playbackCache.mjs';

describe('playback cache', () => {
  it('coalesces concurrent segment requests and serves retries from cache', async () => {
    const session = {};
    const fetcher = vi.fn(async () => ({ buf: Buffer.alloc(188), ct: 'video/mp2t' }));
    await Promise.all(Array.from({ length: 4 }, () => loadMedia(session, 'https://cdn/seg.ts', fetcher)));
    await loadMedia(session, 'https://cdn/seg.ts', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('evicts old live playlists without replacing one quality with another', () => {
    const session = {};
    cacheMedia(session, 'https://cdn/low.m3u8', { buf: Buffer.from('#EXTM3U') }, 1_000);
    expect(cachedMedia(session, 'https://cdn/high.m3u8', 1_010)).toBeNull();
    expect(cachedMedia(session, 'https://cdn/low.m3u8', 2_001)).toBeNull();
  });
  it('bounds long-running segment caches by bytes and count', () => {
    const session = { bodyCache: new Map() };
    for (let i = 0; i < 100; i++) cacheMedia(session, String(i), { buf: Buffer.alloc(1024 * 1024) });
    expect(session.bodyCache.size).toBeLessThanOrEqual(16);
    expect([...session.bodyCache.values()].reduce((n, v) => n + v.buf.length, 0)).toBeLessThanOrEqual(16 * 1024 * 1024);
  });
  it('does not cache errors or repopulate a closed session', async () => {
    const session = { closed: false, bodyCache: new Map() };
    await expect(loadMedia(session, 'x', () => Promise.reject(new Error('offline')))).rejects.toThrow('offline');
    session.closed = true;
    await loadMedia(session, 'x', async () => ({ buf: Buffer.alloc(188) }));
    expect(session.bodyCache.size).toBe(0);
  });
});
