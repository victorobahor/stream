import type { APIMatch, SportEmojiMap } from './types';
import { state, resolveImageUrl } from './state';

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

export function capitalize(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Human label for a sport id or raw category (`american-football` → `American Football`).
 * Prefers the API sports list name when available.
 */
export function formatSportLabel(sport: string): string {
  const raw = (sport || '').trim();
  if (!raw) return 'Sport';
  const key = raw.toLowerCase();
  const fromApi = state.sports.find(
    s => (s.id || '').toLowerCase() === key || (s.name || '').toLowerCase() === key,
  );
  if (fromApi?.name) return fromApi.name;
  return raw
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

// ── Match utilities ──

export function isMatchLive(match: APIMatch): boolean {
  if (match.status === 'inprogress') return true;
  if (state.liveMatchIds.has(match.id)) return true;
  if (match.date) {
    const diff = Date.now() - match.date;
    if (diff >= 0 && diff < LIVE_WINDOW_MS) return true;
  }
  return false;
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
  const league = (match.league || '').toLowerCase();
  if (league.includes('premier league') || league.includes('epl')) return true;
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
  motor_sports: '🏎️',
  default: '🏆',
};

export function getSportEmoji(sport: string): string {
  return SPORT_EMOJI_MAP[(sport || '').toLowerCase().replace(/[- ]/g, '_')] || SPORT_EMOJI_MAP.default;
}

// ── Poster URL ──

export function getPosterUrl(match: APIMatch): string | null {
  if (match.poster) {
    const p = resolveImageUrl(match.poster);
    return p || null;
  }
  // SportSRC has no composite poster endpoint — cards use team badges instead.
  return null;
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
