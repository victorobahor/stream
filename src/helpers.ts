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
  // Remove control characters and whitespace that can bypass protocol checks
  const str = String(url).replace(/[\x00-\x1F\x7F-\x9F\n\r\t]/g, '').trim();
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
    // eslint-disable-next-line no-console
    (console as unknown as Record<string, (...a: unknown[]) => void>)[method](...args);
  }
}

export function matchTextIncludes(match: APIMatch, query: string): boolean {
  const t = (match.title || '').toLowerCase();
  const h = (match.teams?.home?.name || '').toLowerCase();
  const a = (match.teams?.away?.name || '').toLowerCase();
  const c = (match.category || '').toLowerCase();
  return t.includes(query) || h.includes(query) || a.includes(query) || c.includes(query);
}
