import { describe, it, expect, vi } from 'vitest';
import { resolveNativeEmbed } from './resolveEmbed.mjs';

describe('provider resolution', () => {
  it('resolves Streamed without fetching or executing HTML', async () => {
    const read = vi.fn();
    const url = 'https://embed.st/embed/admin/game/1';
    await expect(resolveNativeEmbed(url, read)).resolves.toBe(url);
    expect(read).not.toHaveBeenCalled();
  });
  it('unwraps SportSRC and nested wrappers, ignoring ad frames and scripts', async () => {
    const read = vi.fn()
      .mockResolvedValueOnce({ status: 200, body: '<script src="https://ads.example/x.js"></script><iframe src="https://ads.example/ad"></iframe><iframe src="https://football77.org/player"></iframe>' })
      .mockResolvedValueOnce({ status: 200, body: '<iframe src="https://embed.st/embed/admin/game/1?a=1&amp;b=2"></iframe>' });
    await expect(resolveNativeEmbed('https://embed.streamapi.cc/sport/game/', read))
      .resolves.toBe('https://embed.st/embed/admin/game/1?a=1&b=2');
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('rejects arbitrary hosts, unsupported pages, and wrapper cycles', async () => {
    const read = vi.fn(async () => ({ status: 200, body: '<iframe src="https://embed.streamapi.cc/sport/game/"></iframe>' }));
    await expect(resolveNativeEmbed('https://example.com/embed/game', read)).rejects.toThrow('no supported');
    expect(read).not.toHaveBeenCalled();
    await expect(resolveNativeEmbed('https://embed.streamapi.cc/sport/game/', read)).rejects.toThrow('no supported');
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('follows provider redirects only within the player allowlist', async () => {
    const read = vi.fn(async () => ({ status: 302, location: 'https://embed.st/embed/golf/123/1' }));
    await expect(resolveNativeEmbed('https://embed.streamapi.cc/sport/game/', read))
      .resolves.toBe('https://embed.st/embed/golf/123/1');
    const unsafe = vi.fn(async () => ({ status: 302, location: 'http://127.0.0.1/private' }));
    await expect(resolveNativeEmbed('https://embed.streamapi.cc/sport/game/', unsafe)).rejects.toThrow('no supported');
    expect(unsafe).toHaveBeenCalledTimes(1);
  });
});
