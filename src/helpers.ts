import type { APIMatch } from './types';
import { LOG_LEVEL } from './state';

export function el(id: string): HTMLElement | null {
  return document.getElementById(id);
}

export function escapeHtml(str: unknown): string {
  if (!str) return '';
  const s = String(str);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

export function matchTextIncludes(match: APIMatch, query: string): boolean {
  const t = (match.title || '').toLowerCase();
  const h = (match.teams?.home?.name || '').toLowerCase();
  const a = (match.teams?.away?.name || '').toLowerCase();
  const c = (match.category || '').toLowerCase();
  return t.includes(query) || h.includes(query) || a.includes(query) || c.includes(query);
}

export function filterMatchesBySport(matches: APIMatch[], sportFilter: string): APIMatch[] {
  if (sportFilter === 'all') return matches;
  return matches.filter(
    m => (m.category || '').toLowerCase() === sportFilter.toLowerCase()
  );
}

export function filterMatchesBySearch(matches: APIMatch[], searchQuery: string): APIMatch[] {
  if (!searchQuery) return matches;
  return matches.filter(m => matchTextIncludes(m, searchQuery));
}

export function filterMatchesWithSources(matches: APIMatch[]): APIMatch[] {
  return matches.filter(m => m.sources && m.sources.length > 0);
}

export function sortMatchesByLive(matches: APIMatch[], liveMatchIds?: Set<string>): APIMatch[] {
  return [...matches].sort((a, b) => {
    const aLive = liveMatchIds?.has(a.id) ? 1 : 0;
    const bLive = liveMatchIds?.has(b.id) ? 1 : 0;
    return bLive - aLive;
  });
}

export function debounce<T extends (...args: unknown[]) => void>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      func(...args);
    }, wait);
  };
}

export function debounceString<T extends (arg: string) => void>(
  func: T,
  wait: number
): (arg: string) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return (arg: string) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      func(arg);
    }, wait);
  };
}
