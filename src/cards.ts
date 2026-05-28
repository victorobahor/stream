import type { APIMatch } from './types';
import { state, getImgUrl } from './state';
import { el, escapeHtml, sanitizeUrl } from './helpers';
import { capitalize, getSportEmoji, isMatchLive, isEPLMatch, getPosterUrl, formatDate } from './format';
import { openPlayer } from './player';

// ── Badge helpers ──

export function buildCardBadges(match: APIMatch, live: boolean): string {
  const parts: string[] = [];
  if (live) parts.push('<span class="live-badge">LIVE</span>');
  if (match.popular) parts.push('<span class="popular-badge">🔥 Hot</span>');
  if (isEPLMatch(match)) parts.push(
    '<span class="epl-badge">🏴\uDB40\uDC67\uDB40\uDC62\uDB40\uDC65\uDB40\uDC6E\uDB40\uDC67\uDB40\uDC7F EPL</span>'
  );
  return parts.length ? `<div style="display:flex;gap:6px">${parts.join('')}</div>` : '';
}

export function buildCardPoster(posterUrl: string | null): string {
  if (!posterUrl) return '';
  const safe = sanitizeUrl(posterUrl).replace(/['"\\]/g, '');
  return `<div class="card-poster" style="background-image:url('${escapeHtml(safe)}')"></div>`;
}

export function buildCardTeams(match: APIMatch, hasTeams: boolean, sportEmoji: string): string {
  if (!hasTeams) {
    return `<div class="card-title">${escapeHtml(match.title || 'Match')}</div>`;
  }
  const home = match.teams!.home!;
  const away = match.teams!.away!;
  const hImg = home?.badge
    ? `<img src="${escapeHtml(getImgUrl('/badge/' + home.badge + '.webp'))}" alt="${escapeHtml(home.name || '')}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
    : '';
  const aImg = away?.badge
    ? `<img src="${escapeHtml(getImgUrl('/badge/' + away.badge + '.webp'))}" alt="${escapeHtml(away.name || '')}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
    : '';
  return `
    <div class="card-teams">
      <div class="team">
        <div class="team-badge-wrap">${hImg}<span class="team-badge-placeholder" style="${home?.badge ? 'display:none' : ''}">${sportEmoji}</span></div>
        <span class="team-name">${escapeHtml(home?.name || 'Home')}</span>
      </div>
      <span class="vs-separator">VS</span>
      <div class="team">
        <div class="team-badge-wrap">${aImg}<span class="team-badge-placeholder" style="${away?.badge ? 'display:none' : ''}">${sportEmoji}</span></div>
        <span class="team-name">${escapeHtml(away?.name || 'Away')}</span>
      </div>
    </div>`;
}

export function buildCardFooter(timestamp: string, srcCount: number): string {
  const srcDots = Array.from({ length: Math.min(srcCount, 5) }, () => '<span class="source-dot"></span>').join('');
  return `
    <div class="card-footer">
      <span class="card-time">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        ${escapeHtml(timestamp)}
      </span>
      <div style="display:flex;align-items:center;gap:8px">
        <div class="card-sources" title="${srcCount} source${srcCount !== 1 ? 's' : ''}">${srcDots}</div>
        <span class="source-label">${srcCount} src</span>
      </div>
      <button class="watch-btn">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg>
        Watch
      </button>
    </div>`;
}

// ── Main card builder ──

export function buildMatchCard(match: APIMatch): string {
  const hasTeams = !!(match.teams && (match.teams.home || match.teams.away));
  const live = isMatchLive(match);
  const timestamp = match.date ? formatDate(match.date) : '';
  const sportEmoji = getSportEmoji(match.category);
  const posterUrl = getPosterUrl(match);
  const srcCount = (match.sources || []).length;

  return `
    <div class="match-card${posterUrl ? ' has-poster' : ''}" data-id="${escapeHtml(match.id)}" role="button" tabindex="0" aria-label="Watch ${escapeHtml(match.title || 'match')}">
      ${buildCardPoster(posterUrl)}
      <div class="card-sport-tag">
        <span class="sport-label">${sportEmoji} ${escapeHtml(capitalize(match.category || 'Sport'))}</span>
        ${buildCardBadges(match, live)}
      </div>
      ${buildCardTeams(match, hasTeams, sportEmoji)}
      ${buildCardFooter(timestamp, srcCount)}
    </div>`;
}

// ── Render grid ──

export function renderMatches(matches: APIMatch[]): void {
  const grid = el('matches-grid')!;
  const empty = el('empty-state')!;
  if (!matches || matches.length === 0) {
    grid.classList.add('hidden');
    empty.classList.remove('hidden');
    el('match-count')!.textContent = '0 matches';
    return;
  }
  empty.classList.add('hidden');
  grid.classList.remove('hidden');
  el('match-count')!.textContent = `${matches.length} match${matches.length !== 1 ? 'es' : ''}`;
  grid.innerHTML = matches.map(m => buildMatchCard(m)).join('');
  grid.querySelectorAll('.match-card').forEach(card => {
    card.addEventListener('click', () => {
      const match = state.allMatches.find(m => m.id === (card as HTMLElement).dataset.id);
      if (match) openPlayer(match);
    });
  });
}
