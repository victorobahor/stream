/** CSP + security headers for the SPA shell. */

export const APP_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data:; media-src 'self' blob:; worker-src 'self' blob:; frame-src 'none'; connect-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; frame-ancestors 'self'";

const STATIC_EXTENSIONS = new Set([
  '.svg',
  '.ico',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.woff',
  '.woff2',
  '.js',
  '.css',
  '.json',
  '.map',
  '.txt',
  '.xml',
]);

export function isStaticAssetPath(pathname) {
  const lower = String(pathname || '').toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot === -1) return false;
  return STATIC_EXTENSIONS.has(lower.slice(dot));
}

function isHttpsRequest(req) {
  if (req?.socket?.encrypted) return true;
  const proto = String(req?.headers?.['x-forwarded-proto'] || '').toLowerCase();
  return proto === 'https';
}

function baseHeaders(req) {
  const headers = {
    'X-Frame-Options': 'SAMEORIGIN',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
    'Cross-Origin-Embedder-Policy': 'unsafe-none',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  };
  if (isHttpsRequest(req)) {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
    // Nothing here opens windows; isolate from any opener/popup tricks.
    headers['Cross-Origin-Opener-Policy'] = 'same-origin';
  }
  return headers;
}

export function appSecurityHeaders(req) {
  return {
    ...baseHeaders(req),
    'Content-Security-Policy': APP_CSP,
  };
}

