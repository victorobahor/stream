import type { AppState, LogLevel } from './types';

export const API_HOSTS: readonly [string, string] = [
  'https://streamed.pk',
  'https://strmd.link',
] as const;

const hostIndex = { current: 0 };

export function getActiveHostIndex(): number {
  return hostIndex.current;
}

export function rotateActiveHost(): void {
  hostIndex.current = (hostIndex.current + 1) % API_HOSTS.length;
}

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
  liveMatchIds: new Set<string>(),
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

export function imageUrlForHost(path: string, index: number): string {
  return `${API_HOSTS[index % API_HOSTS.length]}/api/images${path}`;
}

export function getImgUrl(path: string): string {
  return imageUrlForHost(path, hostIndex.current);
}

/** Absolute URLs pass through; relative Streamed image paths go through mirrors. */
export function resolveImageUrl(path: string): string {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (normalized.startsWith('/api/images')) {
    return `${API_HOSTS[hostIndex.current]}${normalized}`;
  }
  return getImgUrl(normalized.startsWith('/badge') || normalized.startsWith('/poster') || normalized.startsWith('/proxy')
    ? normalized
    : `/badge/${path.replace(/^\//, '')}`);
}

/** Badge path for setHostImage: absolute SportSRC URLs or Streamed /badge/… paths. */
export function badgeImagePath(badge: string): string {
  if (!badge) return '';
  if (/^https?:\/\//i.test(badge)) return badge;
  const id = badge.replace(/\.webp$/i, '');
  return `/badge/${id}.webp`;
}
