import { describe, it, expect } from 'vitest';
import { __test } from './vitePlugin';

const { isAllowedEmbedUrl, ALLOWED_EMBED_HOSTS } = __test;

describe('embed proxy allowlist (unified)', () => {
  it('should accept embed.st https URLs', () => {
    const u = isAllowedEmbedUrl('https://embed.st/embed/admin/foo/1');
    expect(u?.hostname).toBe('embed.st');
  });

  it('should accept embed.streamapi.cc https URLs', () => {
    const u = isAllowedEmbedUrl('https://embed.streamapi.cc/sport/abc/');
    expect(u?.hostname).toBe('embed.streamapi.cc');
  });

  it('should reject arbitrary hosts', () => {
    expect(isAllowedEmbedUrl('https://evil.com/embed/x')).toBeNull();
  });

  it('should list Streamed and SportSRC hosts', () => {
    expect(ALLOWED_EMBED_HOSTS.has('embed.st')).toBe(true);
    expect(ALLOWED_EMBED_HOSTS.has('embed.streamapi.cc')).toBe(true);
  });
});
