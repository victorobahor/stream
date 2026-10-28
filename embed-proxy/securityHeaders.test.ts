import { describe, it, expect } from 'vitest';
import {
  APP_CSP,
  appSecurityHeaders,
  isStaticAssetPath,
} from './securityHeaders.mjs';

describe('securityHeaders', () => {
  it('should lock scripts to self and forbid frames', () => {
    expect(APP_CSP).toContain("frame-src 'none'");
    expect(APP_CSP).toMatch(/script-src 'self'/);
    expect(APP_CSP).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  it('should omit HSTS and COOP on plain HTTP', () => {
    const headers = appSecurityHeaders({ headers: {} });
    expect(headers['Strict-Transport-Security']).toBeUndefined();
    expect(headers['Cross-Origin-Opener-Policy']).toBeUndefined();
  });

  it('should send HSTS and COOP on HTTPS', () => {
    const headers = appSecurityHeaders({
      socket: { encrypted: true },
      headers: {},
    });
    expect(headers['Strict-Transport-Security']).toContain('max-age');
    expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
  });

  it('should detect static asset paths', () => {
    expect(isStaticAssetPath('/favicon.svg')).toBe(true);
    expect(isStaticAssetPath('/assets/index-abc.js')).toBe(true);
    expect(isStaticAssetPath('/player')).toBe(false);
  });
});
