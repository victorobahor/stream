import { describe, it, expect } from 'vitest';
import { __test } from './vitePlugin';

const { isAllowedEmbedUrl, rewriteEmbedHtml, ALLOWED_EMBED_HOSTS } = __test;

describe('embed proxy allowlist (SportSRC)', () => {
  it('should accept football77.org https URLs', () => {
    const u = isAllowedEmbedUrl('https://football77.org/embed/?id=x&source=rapid');
    expect(u?.hostname).toBe('football77.org');
  });

  it('should accept embed.sportsrc.org channel URLs', () => {
    const u = isAllowedEmbedUrl('https://embed.sportsrc.org/channel/?id=ae-espn');
    expect(u?.hostname).toBe('embed.sportsrc.org');
  });

  it('should reject embed.st', () => {
    expect(isAllowedEmbedUrl('https://embed.st/embed/admin/x/1')).toBeNull();
  });

  it('should reject arbitrary hosts', () => {
    expect(isAllowedEmbedUrl('https://evil.com/embed/x')).toBeNull();
  });

  it('should list SportSRC hosts', () => {
    expect(ALLOWED_EMBED_HOSTS.has('football77.org')).toBe(true);
    expect(ALLOWED_EMBED_HOSTS.has('embed.sportsrc.org')).toBe(true);
  });

  it('should inject the ad-sink bootstrap into HTML', () => {
    const html = '<meta charset="utf-8"><body>hi</body>';
    const out = rewriteEmbedHtml(html, 'https://football77.org');
    expect(out).toContain('ad-sink');
    expect(out).toContain('window.open');
  });
});
