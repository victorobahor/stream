import type { APIMatch } from './types';
import { LOG_LEVEL, resolveImageUrl } from './state';
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
 * Point an <img> at a badge/poster URL. SportSRC badges are absolute
 * `img.sportsrc.org` URLs — no host rotation.
 */
export function setHostImage(img: HTMLImageElement, path: string, onExhausted?: () => void): void {
  const url = resolveImageUrl(path);
  img.onerror = () => {
    img.onerror = null;
    onExhausted?.();
  };
  img.src = url;
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
 * When true, embeds are loaded through the same-origin rewrite proxy
 * (`/__embed?u=…`). That changes the document origin away from `embed.st`,
 * which trips their WASM lock — playback stays black. Keep off unless
 * experimenting. PopUnder mitigation lives in `adShield.ts` instead.
 *
 * Opt in with `VITE_EMBED_PROXY=1`. Off by default in dev and production.
 */
export function isEmbedProxyEnabled(): boolean {
  const flag = import.meta.env.VITE_EMBED_PROXY;
  return flag === '1' || flag === 'true';
}

const SPORTSRC_EMBED_HOSTS = new Set([
  'football77.org',
  'www.football77.org',
  'embed.sportsrc.org',
  'www.embed.sportsrc.org',
]);

/** Same-origin proxy URL for an upstream embed, or null if not proxyable. */
export function toProxiedEmbedUrl(embedUrl: string): string | null {
  const safe = sanitizeUrl(embedUrl);
  if (!safe || safe === 'about:blank') return null;
  try {
    const host = new URL(safe).hostname;
    if (!SPORTSRC_EMBED_HOSTS.has(host)) return null;
  } catch {
    return null;
  }
  return `/__embed?u=${encodeURIComponent(safe)}`;
}

/** True when the URL is an allowlisted SportSRC embed host. */
export function isAllowedEmbedHost(embedUrl: string): boolean {
  try {
    const u = new URL(embedUrl);
    if (u.protocol !== 'https:') return false;
    return SPORTSRC_EMBED_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Navigate an iframe to a stream embed. No `sandbox` attribute — SportSRC docs
 * forbid it (breaks player scripts). PopUnder mitigation is in `adShield.ts`.
 * Only allowlisted SportSRC embed hosts are accepted (OWASP A03).
 */
export function applyEmbed(iframe: HTMLIFrameElement, embedUrl: string): void {
  const safe = sanitizeUrl(embedUrl);
  if (!safe || safe === 'about:blank') return;
  if (!isAllowedEmbedHost(safe) && !safe.startsWith('/__embed?')) return;
  const src =
    isEmbedProxyEnabled() ? (toProxiedEmbedUrl(safe) ?? safe) : safe;
  if (!src.startsWith('/') && !isAllowedEmbedHost(src)) return;
  const proxied = src.startsWith('/');
  iframe.removeAttribute('srcdoc');
  // Cleared explicitly: leftover sandbox from markup/prior nav would trip the
  // player's detector and refuse playback.
  iframe.removeAttribute('sandbox');
  iframe.setAttribute('allow', EMBED_ALLOW);
  // Direct embeds need a normal referrer for CDN/token checks. Proxied docs are
  // same-origin to us; no-referrer avoids leaking the app URL if proxy is on.
  iframe.setAttribute(
    'referrerpolicy',
    proxied ? 'no-referrer' : 'strict-origin-when-cross-origin',
  );
  iframe.setAttribute('src', src);
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
