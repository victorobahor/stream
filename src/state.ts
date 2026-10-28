import type { AppState, LogLevel } from './types';

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
