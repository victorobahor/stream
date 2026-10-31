import type { APIMatch, SportEmojiMap } from './types';
import { state } from './state';

const ONE_HOUR_MS = 3_600_000;

/**
 * Single definition of "live": a match that started within this window is
 * treated as in progress by both the card timestamp and the LIVE badge.
 * Wide enough to cover a full football/tennis/basketball fixture.
 */
export const LIVE_WINDOW_MS = 3 * ONE_HOUR_MS;

// ── Date / time ──

export function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = d.getTime() - now.getTime();
  if (diff < 0 && diff > -LIVE_WINDOW_MS) return '🔴 Live now';
  if (diff >= 0 && diff < ONE_HOUR_MS) {
    return `In ${Math.round(diff / 60_000)}m`;
  }
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return (
    d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  );
}

/** Upcoming games have no provider player yet; give them a grace window before kick-off. */
const PRE_KICKOFF_GRACE_MS = 15 * 60_000;

/** Why a stream failed when the game has not kicked off yet, or null once it is near/under way. */
export function notStartedMessage(match: APIMatch | null | undefined, now: number = Date.now()): string | null {
  if (!match?.date || match.status === 'inprogress' || match.date - now <= PRE_KICKOFF_GRACE_MS) return null;
  return `This match hasn't started yet (kick-off ${formatDate(match.date)}). Streams usually go live shortly before kick-off.`;
}

/** Kicked off longer ago than any live window — providers keep these listed for the day. */
export function isMatchFinished(match: APIMatch | null | undefined, now: number = Date.now()): boolean {
  // StreamFree's 24/7 channels carry stale timestamps but are flagged live.
  return !!match?.date && match.status !== 'inprogress' && now - match.date >= LIVE_WINDOW_MS;
}

/** Why every stream failed for a game that is probably over, or null. */
export function finishedMessage(match: APIMatch | null | undefined, now: number = Date.now()): string | null {
  if (!isMatchFinished(match, now)) return null;
  return 'This match has probably finished — providers take streams down after the final whistle.';
}

export function capitalize(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

let lastSportsRef: typeof state.sports | null = null;
const sportLabelCache = new Map<string, string>();

/**
 * Human label for a sport id or raw category (`american-football` → `American Football`).
 * Prefers the API sports list name when available.
 * ⚡ Bolt: Uses O(1) Map caching to eliminate O(N) array scans during list rendering.
 */
export function formatSportLabel(sport: string): string {
  const raw = (sport || '').trim();
  if (!raw) return 'Sport';
  const key = raw.toLowerCase();

  // Rebuild the O(1) cache if the API sports list reference changes
  if (state.sports !== lastSportsRef) {
    sportLabelCache.clear();
    lastSportsRef = state.sports;
    for (const s of state.sports) {
      if (s.name) {
        if (s.id) sportLabelCache.set(s.id.toLowerCase(), s.name);
        sportLabelCache.set(s.name.toLowerCase(), s.name);
      }
    }
  }

  const cached = sportLabelCache.get(key);
  if (cached) return cached;

  return raw
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

// ── Match utilities ──

/** True when the kick-off time is within the live window, ignoring the sticky Live set. */
export function isInLiveWindow(date: number | undefined): boolean {
  if (!date) return false;
  const diff = Date.now() - date;
  return diff >= 0 && diff < LIVE_WINDOW_MS;
}

export function isMatchLive(match: APIMatch): boolean {
  return state.liveMatchIds.has(match.id) || isInLiveWindow(match.date);
}

const EPL_TEAMS_REGEX =
  /arsenal|aston villa|brentford|brighton|bournemouth|chelsea|crystal palace|everton|fulham|ipswich|leicester|liverpool|manchester city|man city|manchester united|man united|man utd|newcastle|nottingham forest|southampton|tottenham|spurs|west ham|wolves|wolverhampton|luton|burnley|sheffield united/;

// Memoised off to the side so the API object is never mutated.
const eplCache = new WeakMap<APIMatch, boolean>();

export function isEPLMatch(match: APIMatch): boolean {
  const cached = eplCache.get(match);
  if (cached !== undefined) return cached;

  const result = computeIsEPL(match);
  eplCache.set(match, result);
  return result;
}

function computeIsEPL(match: APIMatch): boolean {
  if ((match.category || '').toLowerCase() !== 'football') return false;
  const title = (match.title || '').toLowerCase();
  if (title.includes('premier league') || title.includes('epl')) return true;
  const home = (match.teams?.home?.name || '').toLowerCase();
  const away = (match.teams?.away?.name || '').toLowerCase();
  return EPL_TEAMS_REGEX.test(home) || EPL_TEAMS_REGEX.test(away);
}

const SPORT_EMOJI_MAP: SportEmojiMap = {
  football: '⚽',
  soccer: '⚽',
  basketball: '🏀',
  tennis: '🎾',
  baseball: '⚾',
  hockey: '🏒',
  american_football: '🏈',
  cricket: '🏏',
  golf: '⛳',
  rugby: '🏉',
  volleyball: '🏐',
  boxing: '🥊',
  mma: '🥋',
  ufc: '🥋',
  formula1: '🏎️',
  motorsport: '🏎️',
  cycling: '🚴',
  darts: '🎯',
  snooker: '🎱',
  handball: '🤾',
  swimming: '🏊',
  athletics: '🏃',
  fighting: '🥊',
  fight: '🥊',
  wrestling: '🤼',
  afl: '🏉',
  billiards: '🎱',
  '24_7': '📺',
  motor_sports: '🏎️',
  default: '🏆',
};

export function getSportEmoji(sport: string): string {
  return SPORT_EMOJI_MAP[(sport || '').toLowerCase().replace(/[- ]/g, '_')] || SPORT_EMOJI_MAP.default;
}

// ── Poster URL ──

/**
 * Provider poster (absolute URL only). Relative paths were Streamed image-API
 * paths; that host is gone, so they would only ever 404.
 */
export function getPosterUrl(match: APIMatch): string | null {
  return match.poster && /^https:\/\//i.test(match.poster) ? match.poster : null;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function showToast(msg: string, type: string = 'info', duration: number = 3000): void {
  const t = document.getElementById('toast');
  if (!t) return;
  // Back-to-back toasts share one element: cancel the previous timer so it
  // cannot clear the message that replaced it.
  if (toastTimer) clearTimeout(toastTimer);
  t.textContent = msg;
  t.className = `toast show ${type}`;
  toastTimer = setTimeout(() => {
    t.className = 'toast';
    toastTimer = null;
  }, duration);
}
