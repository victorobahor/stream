import type { APIMatch } from './types';
import { state, getImgUrl } from './state';
import { el, sanitizeUrl } from './helpers';
import { capitalize, getSportEmoji, isMatchLive, isEPLMatch, getPosterUrl, formatDate } from './format';
import { openPlayer } from './player';

// ── Main card builder ──

export function buildMatchCard(match: APIMatch): HTMLElement {
  const hasTeams = !!(match.teams && (match.teams.home || match.teams.away));
  const live = isMatchLive(match);
  const sportEmoji = getSportEmoji(match.category);
  const posterUrl = getPosterUrl(match);
  const srcCount = (match.sources || []).length;
  const timestamp = match.date ? formatDate(match.date) : '';

  const card = document.createElement('div');
  card.className = `match-card${posterUrl ? ' has-poster' : ''}`;
  card.dataset.id = match.id || '';
  card.setAttribute('role', 'button');
  card.tabIndex = 0;
  card.setAttribute('aria-label', `Watch ${match.title || 'match'}`);

  if (posterUrl) {
    const poster = document.createElement('div');
    poster.className = 'card-poster';
    poster.style.backgroundImage = `url('${sanitizeUrl(posterUrl).replace(/['"\\]/g, '')}')`;
    card.appendChild(poster);
  }

  const sportTag = document.createElement('div');
  sportTag.className = 'card-sport-tag';
  const sportLabel = document.createElement('span');
  sportLabel.className = 'sport-label';
  sportLabel.textContent = `${sportEmoji} ${capitalize(match.category || 'Sport')}`;
  sportTag.appendChild(sportLabel);

  if (live || match.popular || isEPLMatch(match)) {
    const badges = document.createElement('div');
    badges.style.display = 'flex';
    badges.style.gap = '6px';
    if (live) {
      const liveBadge = document.createElement('span');
      liveBadge.className = 'live-badge';
      liveBadge.textContent = 'LIVE';
      badges.appendChild(liveBadge);
    }
    if (match.popular) {
      const popBadge = document.createElement('span');
      popBadge.className = 'popular-badge';
      popBadge.textContent = '🔥 Hot';
      badges.appendChild(popBadge);
    }
    if (isEPLMatch(match)) {
      const eplBadge = document.createElement('span');
      eplBadge.className = 'epl-badge';
      eplBadge.textContent = '🏴\uDB40\uDC67\uDB40\uDC62\uDB40\uDC65\uDB40\uDC6E\uDB40\uDC67\uDB40\uDC7F EPL';
      badges.appendChild(eplBadge);
    }
    sportTag.appendChild(badges);
  }
  card.appendChild(sportTag);

  if (!hasTeams) {
    const title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = match.title || 'Match';
    card.appendChild(title);
  } else {
    const teams = document.createElement('div');
    teams.className = 'card-teams';

    const buildTeam = (teamData: { name?: string | null; badge?: string | null; }, isHome: boolean) => {
      const team = document.createElement('div');
      team.className = 'team';
      const wrap = document.createElement('div');
      wrap.className = 'team-badge-wrap';

      if (teamData.badge) {
        const img = document.createElement('img');
        img.src = getImgUrl(`/badge/${teamData.badge}.webp`);
        img.alt = teamData.name || '';
        img.loading = 'lazy';
        img.onerror = function() {
          (this as HTMLImageElement).style.display = 'none';
          ((this as HTMLImageElement).nextElementSibling as HTMLElement).style.display = 'flex';
        };
        wrap.appendChild(img);
      }

      const placeholder = document.createElement('span');
      placeholder.className = 'team-badge-placeholder';
      placeholder.textContent = sportEmoji;
      if (teamData.badge) placeholder.style.display = 'none';
      wrap.appendChild(placeholder);

      const name = document.createElement('span');
      name.className = `team-name ${isHome ? 'home-name' : 'away-name'}`;
      name.textContent = teamData.name || (isHome ? 'Home' : 'Away');

      team.appendChild(wrap);
      team.appendChild(name);
      return team;
    };

    teams.appendChild(buildTeam(match.teams!.home || {}, true));
    const vs = document.createElement('span');
    vs.className = 'vs-separator';
    vs.textContent = 'VS';
    teams.appendChild(vs);
    teams.appendChild(buildTeam(match.teams!.away || {}, false));

    card.appendChild(teams);
  }

  const footer = document.createElement('div');
  footer.className = 'card-footer';

  const cardTime = document.createElement('span');
  cardTime.className = 'card-time';
  cardTime.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ';
  const timeText = document.createElement('span');
  timeText.className = 'time-text';
  timeText.textContent = timestamp;
  cardTime.appendChild(timeText);
  footer.appendChild(cardTime);

  const sourcesWrap = document.createElement('div');
  sourcesWrap.style.display = 'flex';
  sourcesWrap.style.alignItems = 'center';
  sourcesWrap.style.gap = '8px';

  const sourcesDiv = document.createElement('div');
  sourcesDiv.className = 'card-sources';
  sourcesDiv.title = `${srcCount} source${srcCount !== 1 ? 's' : ''}`;
  for (let i = 0; i < Math.min(srcCount, 5); i++) {
    const dot = document.createElement('span');
    dot.className = 'source-dot';
    sourcesDiv.appendChild(dot);
  }
  sourcesWrap.appendChild(sourcesDiv);

  const srcLabel = document.createElement('span');
  srcLabel.className = 'source-label';
  srcLabel.textContent = `${srcCount} src`;
  sourcesWrap.appendChild(srcLabel);

  footer.appendChild(sourcesWrap);

  const watchBtn = document.createElement('button');
  watchBtn.className = 'watch-btn';
  watchBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg> Watch';
  footer.appendChild(watchBtn);

  card.appendChild(footer);

  return card;
}

// ── Render grid ──

export function renderMatches(matches: APIMatch[]): void {
  const grid = el('matches-grid');
  const empty = el('empty-state');
  const matchCount = el('match-count');

  if (!grid || !empty) return;

  if (!matches || matches.length === 0) {
    grid.classList.add('hidden');
    empty.classList.remove('hidden');
    if (matchCount) matchCount.textContent = '0 matches';
    return;
  }
  empty.classList.add('hidden');
  grid.classList.remove('hidden');
  if (matchCount) matchCount.textContent = `${matches.length} match${matches.length !== 1 ? 'es' : ''}`;

  grid.replaceChildren();
  const frag = document.createDocumentFragment();
  for (const m of matches) {
    frag.appendChild(buildMatchCard(m));
  }
  grid.appendChild(frag);

  if (!grid.dataset.eventsBound) {
    // ⚡ Bolt Optimization: Use event delegation for list items to reduce DOM memory and CPU overhead.
    const clickHandler = (card: HTMLElement) => {
      const match = state.allMatches.find(m => m.id === card.dataset.id);
      if (match) openPlayer(match);
    };

    grid.addEventListener('click', (e) => {
      const card = (e.target as HTMLElement).closest('.match-card') as HTMLElement;
      if (card && grid.contains(card)) {
        clickHandler(card);
      }
    });

    grid.addEventListener('keydown', (e) => {
      const event = e as KeyboardEvent;
      if (event.key === 'Enter' || event.key === ' ') {
        const card = (e.target as HTMLElement).closest('.match-card') as HTMLElement;
        if (card && grid.contains(card)) {
          event.preventDefault(); // Prevent page scroll for space
          clickHandler(card);
        }
      }
    });

    grid.dataset.eventsBound = 'true';
  }
}
