import type { APIMatch } from './types';
import { state } from './state';
import { el, bindListDelegation, log } from './helpers';
import { capitalize, getSportEmoji, isMatchLive } from './format';
import { getMatchById } from './api';

const RELATED_LIMIT = 12;

/** Same-sport matches first, then everything else, capped at RELATED_LIMIT. */
function pickRelated(currentMatch: APIMatch): APIMatch[] {
  const sameSport: APIMatch[] = [];
  const otherSport: APIMatch[] = [];

  for (const m of state.allMatches) {
    if (m.id === currentMatch.id) continue;
    if (m.category === currentMatch.category) {
      if (sameSport.length < RELATED_LIMIT) sameSport.push(m);
    } else if (otherSport.length < RELATED_LIMIT) {
      otherSport.push(m);
    }
    if (sameSport.length >= RELATED_LIMIT) break;
  }

  return sameSport.concat(otherSport).slice(0, RELATED_LIMIT);
}

export function renderRelated(currentMatch: APIMatch): void {
  const list = el('related-list');
  if (!list) return;

  const related = pickRelated(currentMatch);

  if (related.length === 0) {
    const p = document.createElement('p');
    p.className = 'related-empty';
    p.textContent = 'No other matches available';
    list.replaceChildren(p);
    return;
  }

  const fragment = document.createDocumentFragment();

  related.forEach(m => {
    const live = isMatchLive(m);
    const title =
      m.title ||
      (m.teams
        ? `${m.teams?.home?.name || ''} vs ${m.teams?.away?.name || ''}`
        : 'Match');

    const card = document.createElement('div');
    card.className = 'related-card';
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    card.setAttribute('aria-label', `Watch ${title}`);
    card.dataset.matchId = m.id;

    const meta = document.createElement('div');
    meta.className = 'related-card-meta';

    const sport = document.createElement('span');
    sport.className = 'related-sport';
    sport.textContent = `${getSportEmoji(m.category)} ${capitalize(m.category)}`;
    meta.appendChild(sport);

    if (live) {
      const liveSpan = document.createElement('span');
      liveSpan.className = 'related-live';
      const dot = document.createElement('span');
      dot.className = 'live-dot';
      liveSpan.append(dot, ' LIVE');
      meta.appendChild(liveSpan);
    }

    const titleDiv = document.createElement('div');
    titleDiv.className = 'related-card-title';
    titleDiv.textContent = title;

    card.appendChild(meta);
    card.appendChild(titleDiv);
    fragment.appendChild(card);
  });

  list.replaceChildren(fragment);

  bindListDelegation(list, '.related-card', card => {
    const match = getMatchById(card.dataset.matchId);
    if (!match) return;
    // Dynamic import to avoid a circular dependency with player.ts
    import('./player')
      .then(m => m.openPlayer(match))
      .catch(err => log('error', 'Failed to open player:', err));
  });
}
