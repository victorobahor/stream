/* =====================================================
   StreamZone — TypeScript Type Definitions
   ===================================================== */

// ── API response types ──

export interface Sport {
  id: string;
  name: string;
}

export interface TeamInfo {
  name: string;
  badge: string;
}

export interface MatchTeams {
  home?: TeamInfo;
  away?: TeamInfo;
}

export interface StreamSource {
  source: string;
  id: string;
}

export interface APIMatch {
  id: string;
  title: string;
  category: string;
  date: number;
  poster?: string;
  popular: boolean;
  teams?: MatchTeams;
  sources: StreamSource[];
  // Runtime augmentation (not from API):
  isEPL?: boolean;
}

export interface Stream {
  id: string;
  streamNo: number;
  language: string;
  hd: boolean;
  embedUrl: string;
  source: string;
}

// ── App state types ──

export type Category = 'live' | 'all' | 'today' | 'popular';
export type MultiviewLayout = '1x1' | '1x2' | '2x1' | '3' | '2x2';
export type LogLevel = 'debug' | 'warn' | 'error' | 'none';

export interface MultiviewSlot {
  match: APIMatch;
  sourceName: string;
  streamIndex: number;
  stream?: Stream;
  streams: Stream[];
  loading: boolean;
}

export interface AppState {
  currentCategory: Category;
  currentSport: string;
  allMatches: APIMatch[];
  filteredMatches: APIMatch[];
  sports: Sport[];
  searchQuery: string;
  currentMatch: APIMatch | null;
  selectedStream: Stream | null;
  activeSourceIndex: number;
  liveMatchIds: Set<string>;
  refreshInterval: ReturnType<typeof setInterval> | null;

  multiviewLayout: MultiviewLayout;
  multiviewSlots: (MultiviewSlot | null)[];
  multiviewActiveSlot: number;
  multiviewSidebarOpen: boolean;
  multiviewSearchQuery: string;
  multiviewSportFilter: string;
  mvModalActiveSlot: number | null;
  mvModalSearchQuery: string;
  mvModalSportFilter: string;
}

// ── Saved multiview state (from localStorage) ──

export interface SavedSlotData {
  matchId: string;
  sourceName: string;
  streamIndex: number;
}

export interface SavedMultiviewState {
  layout: MultiviewLayout;
  slots: (SavedSlotData | null)[];
}

// ── Sport emoji map ──

export type SportEmojiMap = Record<string, string>;
