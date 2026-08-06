import type { AppState, LogLevel } from './types';

/**
 * SportSRC experiment: the browser only talks to the same-origin BFF
 * (`embed-proxy`), which holds SPORTSRC_API_KEY. No streamed.pk rotation.
 */
export const API_BASE = '';

export const LOG_LEVEL: LogLevel = 'warn';

export const state: AppState = {
  currentCategory: 'live',
  currentSport: 'all',
  allMatches: [],
  sports: [],
  searchQuery: '',
  currentMatch: null,
  selectedStream: null,
  activeSourceIndex: 0,
  liveMatchIds: new Set(),
  refreshInterval: null,

  multiviewLayout: '1x2',
  multiviewSlots: [null, null, null, null],
  multiviewActiveSlot: 0,
  multiviewSidebarOpen: true,
  multiviewSearchQuery: '',
  multiviewSportFilter: 'all',
  mvModalActiveSlot: null,
  mvModalSearchQuery: '',
  mvModalSportFilter: 'all',
};

/** Absolute SportSRC image URLs pass through; relative paths are unused now. */
export function resolveImageUrl(pathOrUrl: string): string {
  const raw = String(pathOrUrl || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('//')) return `https:${raw}`;
  return raw;
}

/** @deprecated kept for call-site compat — always returns absolute-or-raw URL */
export function getImgUrl(path: string): string {
  return resolveImageUrl(path);
}

/** @deprecated no host rotation on SportSRC BFF */
export function getActiveHostIndex(): number {
  return 0;
}

/** @deprecated no-op */
export function rotateActiveHost(): void {
  /* SportSRC is single-origin via BFF */
}

/** @deprecated */
export function imageUrlForHost(path: string, _index: number): string {
  return resolveImageUrl(path);
}

/** @deprecated */
export const API_HOSTS: readonly [string, string] = ['', ''] as const;
