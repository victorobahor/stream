import type { APIMatch } from './types';
import { el, bindListDelegation, setHostImage } from './helpers';
import { formatSportLabel, getSportEmoji, isMatchLive, isEPLMatch, getPosterUrl, formatDate } from './format';
import { getMatchById } from './api';

// ── Icon templates ──
// Parsed once at module load instead of once per icon per card.

function iconTemplate(markup: string): HTMLTemplateElement {
  const tmpl = document.createElement('template');
  tmpl.innerHTML = markup;
  return tmpl;
}

const CLOCK_ICON = iconTemplate(
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
);
const PLAY_ICON = iconTemplate(
  '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5 3 19 12 5 21"/></svg>'
);

function icon(tmpl: HTMLTemplateElement): Node {
  return tmpl.content.cloneNode(true);
}

// ── Main card builder ──

export function buildMatchCard(match: APIMatch): HTMLElement {
  const hasTeams = !!(match.teams && (match.teams.home || match.teams.away));
  const live = isMatchLive(match);
  const isEPL = isEPLMatch(match);
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
    // An <img> rather than a CSS background so posters below the fold are
    // actually deferred — background-image is never lazy.
    const poster = document.createElement('img');
    poster.className = 'card-poster';
    poster.src = posterUrl;
    poster.alt = '';
    poster.loading = 'lazy';
    poster.decoding = 'async';
    poster.setAttribute('aria-hidden', 'true');
    poster.onerror = () => {
      // The URL was resolved against whichever host was active at render time.
      // If that host has since rotated, re-resolve before giving up.
      const retry = getPosterUrl(match);
      if (retry && retry !== poster.getAttribute('src')) {
        poster.src = retry;
        return;
      }
      poster.remove();
    };
    card.appendChild(poster);
  }

  const sportTag = document.createElement('div');
  sportTag.className = 'card-sport-tag';
  const sportLabel = document.createElement('span');
  sportLabel.className = 'sport-label';
  sportLabel.textContent = `${sportEmoji} ${formatSportLabel(match.category || 'Sport')}`;
  sportTag.appendChild(sportLabel);

  if (live || match.popular || isEPL) {
    const badges = document.createElement('div');
    badges.className = 'card-badges';
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
    if (isEPL) {
      const eplBadge = document.createElement('span');
      eplBadge.className = 'epl-badge';
      eplBadge.textContent = '🏴󠁧󠁢󠁥󠁮󠁧󠁿 EPL';
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

      const placeholder = document.createElement('span');
      placeholder.className = 'team-badge-placeholder';
      placeholder.textContent = sportEmoji;

      if (teamData.badge) {
        const img = document.createElement('img');
        img.alt = teamData.name || '';
        img.loading = 'lazy';
        img.decoding = 'async';
        placeholder.style.display = 'none';
        // SportSRC badges are absolute URLs; legacy relative ids still work via resolveImageUrl.
        const badgeSrc = /^https?:\/\//i.test(teamData.badge)
          ? teamData.badge
          : `/badge/${teamData.badge}.webp`;
        setHostImage(img, badgeSrc, () => {
          img.style.display = 'none';
          placeholder.style.display = 'flex';
        });
        wrap.appendChild(img);
      }

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
  cardTime.appendChild(icon(CLOCK_ICON));
  const timeText = document.createElement('span');
  timeText.className = 'time-text';
  timeText.textContent = timestamp;
  cardTime.appendChild(timeText);
  footer.appendChild(cardTime);

  const sourcesWrap = document.createElement('div');
  sourcesWrap.className = 'card-sources-wrap';

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
  watchBtn.appendChild(icon(PLAY_ICON));
  watchBtn.appendChild(document.createTextNode(' Watch'));
  footer.appendChild(watchBtn);

  card.appendChild(footer);

  return card;
}

/** Cap DOM size for large catalogs — search still filters the full set first. */
export const MATCH_GRID_RENDER_LIMIT = 48;

// ── Render grid ──

export function renderMatches(matches: APIMatch[]): void {
  const grid = el('matches-grid');
  const empty = el('empty-state');
  const matchCount = el('match-count');

  if (!grid || !empty) return;

  if (!matches || matches.length === 0) {
    // Clear stale cards — hiding alone left the previous filter's DOM in place,
    // and any later un-hide showed them stacked above the empty state.
    grid.replaceChildren();
    grid.classList.add('hidden');
    empty.classList.remove('hidden');
    if (matchCount) matchCount.textContent = '0 matches';
    return;
  }
  empty.classList.add('hidden');
  grid.classList.remove('hidden');

  const total = matches.length;
  const visible = matches.slice(0, MATCH_GRID_RENDER_LIMIT);
  if (matchCount) {
    matchCount.textContent =
      total > MATCH_GRID_RENDER_LIMIT
        ? `Showing ${visible.length} of ${total}`
        : `${total} match${total !== 1 ? 'es' : ''}`;
  }

  const frag = document.createDocumentFragment();
  for (const m of visible) {
    frag.appendChild(buildMatchCard(m));
  }
  grid.replaceChildren(frag);

  bindListDelegation(grid, '.match-card', card => {
    const match = getMatchById(card.dataset.id);
    if (!match) return;
    // Lazy-load player (+ hls.js) only when a match is opened.
    void import('./player').then(m => m.openPlayer(match));
  });
}
