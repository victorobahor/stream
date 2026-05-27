import type { APIMatch, SportEmojiMap } from './types';
import { state, getImgUrl, API_HOSTS, getActiveHostIndex } from './state';

// ── Date / time ──

export function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = d.getTime() - now.getTime();
  if (diff < 0 && diff > -18_000_000) return '🔴 Live now';
  if (diff >= 0 && diff < 3_600_000) {
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

// ── Match utilities ──

export function isMatchLive(match: APIMatch): boolean {
  if (state.liveMatchIds.has(match.id)) return true;
  if (match.date) {
    const diff = Date.now() - match.date;
    if (diff > 0 && diff < 18_000_000) return true;
  }
  return false;
}

const EPL_TEAMS_REGEX =
  /arsenal|aston villa|brentford|brighton|bournemouth|chelsea|crystal palace|everton|fulham|ipswich|leicester|liverpool|manchester city|man city|manchester united|man united|man utd|newcastle|nottingham forest|southampton|tottenham|spurs|west ham|wolves|wolverhampton|luton|burnley|sheffield united/;

export function isEPLMatch(match: APIMatch): boolean {
  if (match.isEPL !== undefined) return match.isEPL;
  if ((match.category || '').toLowerCase() !== 'football') {
    match.isEPL = false;
    return false;
  }
  const title = (match.title || '').toLowerCase();
  if (title.includes('premier league') || title.includes('epl')) {
    match.isEPL = true;
    return true;
  }
  const home = (match.teams?.home?.name || '').toLowerCase();
  const away = (match.teams?.away?.name || '').toLowerCase();
  match.isEPL = EPL_TEAMS_REGEX.test(home) || EPL_TEAMS_REGEX.test(away);
  return match.isEPL;
}

export function getSportEmoji(sport: string): string {
  const map: SportEmojiMap = {
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
  return map[(sport || '').toLowerCase().replace(/[- ]/g, '_')] || map.default;
}

// ── Poster URL ──

export function getPosterUrl(match: APIMatch): string | null {
  if (match.poster) {
    let p = match.poster;
    if (p.startsWith('http://') || p.startsWith('https://')) return p;
    if (p.includes('/api/images/proxy/')) {
      p = p.replace(/^\/?api\/images\/proxy\//, '');
      p = p.replace(/^\/?api\/images\//, '');
    }
    if (p.startsWith('/api/images/') || p.startsWith('api/images/')) {
      const path = p.startsWith('/') ? p : '/' + p;
      return `${API_HOSTS[getActiveHostIndex()]}${path}`;
    }
    return getImgUrl(`/proxy/${p}.webp`);
  }
  if (match.teams?.home?.badge && match.teams?.away?.badge) {
    return getImgUrl(`/poster/${match.teams.home.badge}/${match.teams.away.badge}.webp`);
  }
  return null;
}

export function showToast(msg: string, type: string = 'info', duration: number = 3000): void {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `toast show ${type}`;
  setTimeout(() => {
    t.className = 'toast';
  }, duration);
}
