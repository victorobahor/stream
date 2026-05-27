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
  filteredMatches: [],
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

export function getImgUrl(path: string): string {
  return `${API_HOSTS[hostIndex.current]}/api/images${path}`;
}
