import type { APIMatch } from './types';
import { LOG_LEVEL, API_HOSTS, getActiveHostIndex, imageUrlForHost } from './state';
import { isEPLMatch, isMatchLive } from './format';
import { stopNativePlayback } from './mediaStop';

export function el(id: string): HTMLElement | null {
  return document.getElementById(id);
}

const BLOCKED_PROTOCOLS = ['javascript:', 'data:', 'vbscript:', 'blob:'];

const BLOCKED_SCHEMES = ['javascript', 'data', 'vbscript', 'blob'];

export function sanitizeUrl(url: unknown): string {
  if (!url) return '';
  // eslint-disable-next-line no-control-regex
  const str = String(url).replace(/[\x00-\x1F\x7F]/g, '').trim();
  try {
    const parsed = new URL(str);
    if (BLOCKED_PROTOCOLS.includes(parsed.protocol)) {
      return 'about:blank';
    }
    return str;
  } catch {
    const schemeMatch = str.match(/^([a-zA-Z0-9+\-.]+):/);
    if (schemeMatch) {
      if (BLOCKED_SCHEMES.includes(schemeMatch[1].toLowerCase())) {
        return 'about:blank';
      }
    }
    return str;
  }
}

/**
 * Sanitize a URL for use inside a CSS `url('…')` literal. Quotes and
 * backslashes are stripped so the value cannot break out of the literal.
 */
export function cssUrl(url: unknown): string {
  const safe = sanitizeUrl(url);
  if (!safe || safe === 'about:blank') return '';
  return safe.replace(/['"\\()]/g, '');
}

export function log(level: string, ...args: unknown[]): void {
  const levels: Record<string, number> = { debug: 0, warn: 1, error: 2, none: 9 };
  if ((levels[level] || 0) >= (levels[LOG_LEVEL] || 0)) {
    const method = level === 'debug' ? 'log' : level;
    const consoleFn = console[method as keyof Console];
    if (typeof consoleFn === 'function') {
      (consoleFn as (...a: unknown[]) => void).apply(console, args);
    }
  }
}

// ── Images ──

/**
 * Point an <img> at an API-hosted image path, retrying the remaining mirror
 * hosts on error. Without this an image rendered before `rotateActiveHost()`
 * keeps pointing at the dead host forever.
 */
export function setHostImage(img: HTMLImageElement, path: string, onExhausted?: () => void): void {
  if (/^https?:\/\//i.test(path)) {
    img.onerror = () => {
      img.onerror = null;
      onExhausted?.();
    };
    img.src = path;
    return;
  }
  let attempt = 0;
  img.onerror = () => {
    attempt++;
    if (attempt >= API_HOSTS.length) {
      img.onerror = null;
      onExhausted?.();
      return;
    }
    img.src = imageUrlForHost(path, getActiveHostIndex() + attempt);
  };
  img.src = imageUrlForHost(path, getActiveHostIndex());
}

// ── Match filtering / sorting ──

export function matchTextIncludes(match: APIMatch, query: string): boolean {
  // Early returns short-circuit the remaining lowercase conversions.
  if ((match.title || '').toLowerCase().includes(query)) return true;
  if ((match.teams?.home?.name || '').toLowerCase().includes(query)) return true;
  if ((match.teams?.away?.name || '').toLowerCase().includes(query)) return true;
  if ((match.category || '').toLowerCase().includes(query)) return true;
  return false;
}

export function filterMatchesBySport(matches: APIMatch[], sportFilter: string): APIMatch[] {
  if (sportFilter === 'all') return matches;
  const lowerFilter = sportFilter.toLowerCase();
  return matches.filter(
    m => (m.category || '').toLowerCase() === lowerFilter
  );
}

export function filterMatchesBySearch(matches: APIMatch[], searchQuery: string): APIMatch[] {
  if (!searchQuery) return matches;
  return matches.filter(m => matchTextIncludes(m, searchQuery));
}

export function filterMatchesWithSources(matches: APIMatch[]): APIMatch[] {
  return matches.filter(m => m.sources && m.sources.length > 0);
}

/**
 * Refine the merged catalog by UI category. Load-time endpoints already narrow
 * the slate; this keeps Live/Today/Popular correct when SportSRC + Streamed
 * rows are combined.
 *
 * Live: prefer `liveMatchIds` (Streamed live slate, including long events) and
 * only date-gate SportSRC-only cards that were never on that slate.
 */
export function filterMatchesByCategory(
  matches: APIMatch[],
  category: string,
): APIMatch[] {
  if (category === 'live') {
    return matches.filter(m => {
      // Streamed / merged cards from the live fetch — keep even if kickoff is
      // outside the 3h badge window (e.g. motorsport endurance).
      if (!String(m.id).startsWith('sportsrc:')) return true;
      return isMatchLive(m) || m.status === 'inprogress';
    });
  }
  if (category === 'today') {
    const todayStr = new Date().toDateString();
    return matches.filter(m => m.date && new Date(m.date).toDateString() === todayStr);
  }
  if (category === 'popular') {
    return matches.filter(m => m.popular);
  }
  return matches;
}

/**
 * The one ordering every match list uses: live first, then EPL, then soonest.
 * Returns a new array — callers must not rely on the input being sorted.
 */
export function sortMatchesForDisplay(matches: APIMatch[]): APIMatch[] {
  return [...matches].sort((a, b) => {
    const liveDelta = Number(isMatchLive(b)) - Number(isMatchLive(a));
    if (liveDelta !== 0) return liveDelta;
    // Prefer API-flagged popular matches (Streamed `popular` field).
    const popularDelta = Number(!!b.popular) - Number(!!a.popular);
    if (popularDelta !== 0) return popularDelta;
    const eplDelta = Number(isEPLMatch(b)) - Number(isEPLMatch(a));
    if (eplDelta !== 0) return eplDelta;
    return (a.date || 0) - (b.date || 0);
  });
}

export function debounce<A extends unknown[]>(
  func: (...args: A) => void,
  wait: number
): (...args: A) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return (...args: A) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      func(...args);
    }, wait);
  };
}

// ── List delegation ──

/**
 * Bind click + Enter/Space activation for `selector` items to their container,
 * once. The listener lives on the container, so re-rendering the list does not
 * need to rebind anything.
 */
export function bindListDelegation(
  container: HTMLElement,
  selector: string,
  onActivate: (item: HTMLElement) => void
): void {
  if (container.dataset.eventsBound) return;
  container.dataset.eventsBound = 'true';

  container.addEventListener('click', e => {
    const item = (e.target as HTMLElement).closest<HTMLElement>(selector);
    if (item) onActivate(item);
  });

  container.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const item = (e.target as HTMLElement).closest<HTMLElement>(selector);
    if (!item) return;
    e.preventDefault(); // Space would otherwise scroll the page
    onActivate(item);
  });
}

// ── Embeds ──

export const EMBED_ALLOW = 'autoplay; encrypted-media; fullscreen; picture-in-picture';

/**
 * When true, all allowlisted embeds go through `/__embed?u=…`.
 * Opt in with `VITE_EMBED_PROXY=1`. SportSRC streamapi wrappers are always
 * proxied via `shouldProxyEmbed` (outer page is an ad shell + nested player).
 * Never always-proxy embed.st — that trips the WASM lock.
 */
export function isEmbedProxyEnabled(): boolean {
  const flag = import.meta.env.VITE_EMBED_PROXY;
  return flag === '1' || flag === 'true';
}

const STREAMED_EMBED_HOSTS = new Set(['embed.st', 'www.embed.st']);

const SPORTSRC_EMBED_HOSTS = new Set([
  'embed.streamapi.cc',
  'streamapi.cc',
  'football77.org',
  'www.football77.org',
  'embed.sportsrc.org',
  'www.embed.sportsrc.org',
]);

const ALWAYS_PROXY_HOSTS = new Set(['embed.streamapi.cc', 'streamapi.cc']);

export function shouldProxyEmbed(embedUrl: string): boolean {
  if (isEmbedProxyEnabled()) return true;
  try {
    return ALWAYS_PROXY_HOSTS.has(new URL(embedUrl).hostname);
  } catch {
    return false;
  }
}

/** Same-origin proxy URL for an upstream embed, or null if not proxyable. */
export function toProxiedEmbedUrl(embedUrl: string): string | null {
  const safe = sanitizeUrl(embedUrl);
  if (!safe || safe === 'about:blank') return null;
  try {
    const host = new URL(safe).hostname;
    if (!STREAMED_EMBED_HOSTS.has(host) && !SPORTSRC_EMBED_HOSTS.has(host)) return null;
  } catch {
    return null;
  }
  return `/__embed?u=${encodeURIComponent(safe)}`;
}

/** True when the URL is an allowlisted Streamed or SportSRC embed host. */
export function isAllowedEmbedHost(embedUrl: string): boolean {
  try {
    const u = new URL(embedUrl);
    if (u.protocol !== 'https:') return false;
    if (STREAMED_EMBED_HOSTS.has(u.hostname)) {
      return u.pathname.startsWith('/embed/');
    }
    return SPORTSRC_EMBED_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Navigate an iframe to a stream embed. No `sandbox` — players detect it.
 * Streamed embed.st: direct (HLS preferred). SportSRC streamapi: always proxy
 * + ad strip. PopUnder gate lives in `adShield.ts`.
 */
export function applyEmbed(iframe: HTMLIFrameElement, embedUrl: string): void {
  const safe = sanitizeUrl(embedUrl);
  if (!safe || safe === 'about:blank') return;
  if (!isAllowedEmbedHost(safe) && !safe.startsWith('/__embed?')) return;
  const src = shouldProxyEmbed(safe) ? (toProxiedEmbedUrl(safe) ?? safe) : safe;
  if (!src.startsWith('/') && !isAllowedEmbedHost(src)) return;
  const proxied = src.startsWith('/');
  iframe.removeAttribute('srcdoc');
  iframe.removeAttribute('sandbox');
  iframe.setAttribute('allow', EMBED_ALLOW);
  iframe.setAttribute(
    'referrerpolicy',
    proxied ? 'no-referrer' : 'strict-origin-when-cross-origin',
  );
  iframe.setAttribute('src', src);
}

/**
 * SportSRC streamapi pages wrap embed.st. Ask the embed proxy for the nested
 * player URL so we can mint native HLS instead of framing the ad shell.
 */
export async function resolveEmbedForPlayback(embedUrl: string): Promise<string> {
  const safe = sanitizeUrl(embedUrl);
  if (!safe || safe === 'about:blank') return embedUrl;
  if (!shouldProxyEmbed(safe)) return safe;

  const proxied = toProxiedEmbedUrl(safe);
  if (!proxied) return safe;

  try {
    const metaUrl = `${proxied}${proxied.includes('?') ? '&' : '?'}meta=1`;
    const res = await fetch(metaUrl, { headers: { Accept: 'application/json' } });
    if (!res.ok) return safe;
    const data = (await res.json()) as { nestedEmbedUrl?: string | null };
    const nested = typeof data.nestedEmbedUrl === 'string' ? sanitizeUrl(data.nestedEmbedUrl) : '';
    if (nested && nested !== 'about:blank' && isAllowedEmbedHost(nested)) {
      log('debug', 'Unwrapped SportSRC embed →', nested);
      return nested;
    }
  } catch (e) {
    log('warn', 'Embed unwrap failed, using proxied iframe path:', e);
  }
  return safe;
}

export function clearEmbed(iframe: HTMLIFrameElement): void {
  iframe.onload = null;
  iframe.removeAttribute('srcdoc');
  // Navigating to about:blank is what actually stops playback; removing the
  // src attribute leaves the current document running.
  iframe.setAttribute('src', 'about:blank');
}

export function stopAllIframes(): void {
  stopNativePlayback();
  const mainIframe = document.getElementById('stream-iframe') as HTMLIFrameElement | null;
  if (mainIframe) clearEmbed(mainIframe);
  document.querySelectorAll<HTMLIFrameElement>('.mv-iframe').forEach(iframe => {
    clearEmbed(iframe);
  });
}
