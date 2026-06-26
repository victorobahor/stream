import type { APIMatch } from './types';
import { state } from './state';
import { el } from './helpers';
import { capitalize, getSportEmoji, isMatchLive } from './format';

export function renderRelated(currentMatch: APIMatch): void {
  const list = el('related-list');
  if (!list) return;
  // Prefer same-sport matches, then others
  const sameSport = state.allMatches.filter(
    m => m.id !== currentMatch.id && m.category === currentMatch.category
  );
  const otherSport = state.allMatches.filter(
    m => m.id !== currentMatch.id && m.category !== currentMatch.category
  );
  const related = [...sameSport, ...otherSport].slice(0, 12);

  list.innerHTML = '';

  if (related.length === 0) {
    const p = document.createElement('p');
    p.style.color = 'var(--text3)';
    p.style.fontSize = '0.85rem';
    p.textContent = 'No other matches available';
    list.appendChild(p);
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
      liveSpan.innerHTML = '<span class="live-dot"></span> LIVE';
      meta.appendChild(liveSpan);
    }

    const titleDiv = document.createElement('div');
    titleDiv.className = 'related-card-title';
    titleDiv.textContent = title;

    card.appendChild(meta);
    card.appendChild(titleDiv);
    fragment.appendChild(card);
  });

  list.appendChild(fragment);

  if (!list.dataset.eventsBound) {
    // ⚡ Bolt Optimization: Use event delegation for list items to reduce DOM memory and CPU overhead.
    const clickHandler = (card: HTMLElement) => {
      const match = state.allMatches.find(m => m.id === card.dataset.matchId);
      if (match) {
        // Dynamic import to avoid circular dependency with player.ts
        import('./player').then(m => m.openPlayer(match));
      }
    };

    list.addEventListener('click', (e) => {
      const card = (e.target as HTMLElement).closest('.related-card') as HTMLElement;
      if (card && list.contains(card)) {
        clickHandler(card);
      }
    });

    list.addEventListener('keydown', (e) => {
      const event = e as KeyboardEvent;
      if (event.key === 'Enter' || event.key === ' ') {
        const card = (e.target as HTMLElement).closest('.related-card') as HTMLElement;
        if (card && list.contains(card)) {
          event.preventDefault(); // Prevent page scroll for space
          clickHandler(card);
        }
      }
    });

    list.dataset.eventsBound = 'true';
  }
}
