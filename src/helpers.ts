import type { APIMatch } from './types';
import { LOG_LEVEL, API_HOSTS, getActiveHostIndex, imageUrlForHost } from './state';
import { isEPLMatch, isMatchLive } from './format';

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
 * The one ordering every match list uses: live first, then EPL, then soonest.
 * Returns a new array — callers must not rely on the input being sorted.
 */
export function sortMatchesForDisplay(matches: APIMatch[]): APIMatch[] {
  return [...matches].sort((a, b) => {
    const liveDelta = Number(isMatchLive(b)) - Number(isMatchLive(a));
    if (liveDelta !== 0) return liveDelta;
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
 * Navigate an iframe to a stream embed. No `sandbox` attribute is applied.
 *
 * This is a deliberate trade, and it was settled empirically:
 *
 * - Sandboxed *without* `allow-popups`, the players refuse to start and show
 *   their own "sandbox detected" notice. They monetise through the popunder
 *   that fires on the first click, so they gate playback on being able to open
 *   it — the same gate behind the "disable your ad blocker" hint in index.html.
 *   Keeping `allow-same-origin` does not avoid this; the check is deliberate,
 *   not an incidental storage error.
 * - Sandboxed *with* `allow-popups`, the players start but the ad window opens
 *   anyway, so the sandbox buys nothing against the actual complaint.
 *
 * Since `window.open` inside a cross-origin frame cannot be intercepted from
 * this page, there is no client-side configuration that both plays and
 * suppresses the ad. Blocking it needs a server-side proxy that strips the ad
 * scripts and reserves the embed from our own origin (see REVIEW.md, Part 1).
 *
 * Middle ground if tab-hijacking is a concern and the popup is tolerable:
 *   iframe.setAttribute('sandbox',
 *     'allow-scripts allow-same-origin allow-forms allow-modals ' +
 *     'allow-presentation allow-popups');
 * That keeps players working and still blocks top-level navigation, forced
 * downloads, and lets the popup inherit the sandbox rather than escape it.
 */
export function applyEmbed(iframe: HTMLIFrameElement, embedUrl: string): void {
  const safe = sanitizeUrl(embedUrl);
  if (!safe || safe === 'about:blank') return;
  iframe.removeAttribute('srcdoc');
  // Cleared explicitly: an attribute left over from earlier markup or a prior
  // navigation would silently keep restricting the frame.
  iframe.removeAttribute('sandbox');
  iframe.setAttribute('allow', EMBED_ALLOW);
  iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  iframe.setAttribute('src', safe);
}

export function clearEmbed(iframe: HTMLIFrameElement): void {
  iframe.onload = null;
  iframe.removeAttribute('srcdoc');
  // Navigating to about:blank is what actually stops playback; removing the
  // src attribute leaves the current document running.
  iframe.setAttribute('src', 'about:blank');
}

export function stopAllIframes(): void {
  const mainIframe = document.getElementById('stream-iframe') as HTMLIFrameElement | null;
  if (mainIframe) clearEmbed(mainIframe);
  document.querySelectorAll<HTMLIFrameElement>('.mv-iframe').forEach(iframe => {
    clearEmbed(iframe);
  });
}
