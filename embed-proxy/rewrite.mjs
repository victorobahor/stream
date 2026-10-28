/**
 * Provider page reader for the native HLS unwrap (resolveEmbed.mjs). Pages are
 * fetched as text and never served to viewers — no provider markup, scripts,
 * or ads reach the browser.
 */

export const ALLOWED_EMBED_HOSTS = new Set([
  // Player SportSRC wrappers resolve to (minted in headless Chrome)
  'embed.st',
  'www.embed.st',
  // SportSRC V1 wrappers (unwrapped to embed.st)
  'embed.streamapi.cc',
  'streamapi.cc',
  'football77.org',
  'www.football77.org',
  'embed.sportsrc.org',
  'www.embed.sportsrc.org',
]);

export function isAllowedEmbedUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (!ALLOWED_EMBED_HOSTS.has(parsed.hostname)) return null;
  return parsed;
}

export async function readUpstream(url) {
  let referer = 'https://embed.streamapi.cc/';
  try {
    referer = new URL(url).origin + '/';
  } catch {
    /* keep default */
  }
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    redirect: 'manual',
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
      Referer: referer,
    },
  });
  return {
    status: res.status,
    location: res.headers.get('location'),
    body: await res.text(),
    contentType: res.headers.get('content-type') || 'text/html; charset=utf-8',
  };
}
