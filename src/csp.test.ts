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

  it('should use allowlisted frame-src instead of wildcard', () => {
    expect(csp).toContain('frame-src https://streamed.pk https://strmd.link https://embed.st');
  });

  it('should have restrictive connect-src', () => {
    expect(csp).toContain("connect-src 'self' https://streamed.pk https://strmd.link");
  });

  it('should have base-uri self', () => {
    expect(csp).toContain("base-uri 'self'");
  });

  it('should have form-action self', () => {
    expect(csp).toContain("form-action 'self'");
  });
});
