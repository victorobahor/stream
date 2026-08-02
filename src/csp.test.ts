import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Content Security Policy', () => {
  const html = readFileSync(resolve(__dirname, '../index.html'), 'utf-8');
  const cspMatch = html.match(/<meta[^>]*Content-Security-Policy[^>]*content="([^"]*)"[^>]*>/i);
  const csp = cspMatch?.[1] || '';

  it('should have a CSP meta tag', () => {
    expect(cspMatch).not.toBeNull();
  });

  it('should not allow frame-src * (wildcard)', () => {
    expect(csp).not.toContain('frame-src *');
  });

  it('should allow same-origin proxy frames plus https embeds', () => {
    expect(csp).toContain("frame-src 'self' https:");
  });

  it('should keep script-src locked to self', () => {
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it('should block plugin content', () => {
    expect(csp).toContain("object-src 'none'");
  });

  it('should have restrictive connect-src', () => {
    expect(csp).toContain("connect-src 'self' https://streamed.pk https://strmd.link");
  });

  it('should allow blob media/workers for native HLS', () => {
    expect(csp).toContain("media-src 'self' blob:");
    expect(csp).toContain("worker-src 'self' blob:");
  });
  it('should not rely on header-only directives that a meta tag ignores', () => {
    // `sandbox`, `frame-ancestors` and `report-uri` are silently dropped when
    // delivered via <meta> — putting them here is a no-op that reads as safety.
    expect(csp).not.toMatch(/(^|;)\s*sandbox\b/);
    expect(csp).not.toContain('frame-ancestors');
    expect(csp).not.toContain('report-uri');
  });

  it('should have base-uri self', () => {
    expect(csp).toContain("base-uri 'self'");
  });

  it('should have form-action self', () => {
    expect(csp).toContain("form-action 'self'");
  });
});
