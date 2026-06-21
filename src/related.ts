import type { APIMatch } from './types';
import { state } from './state';
import { el, escapeHtml } from './helpers';
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

  if (related.length === 0) {
    list.innerHTML = '<p style="color:var(--text3);font-size:0.85rem">No other matches available</p>';
    return;
  }

  list.innerHTML = related
    .map(m => {
      const live = isMatchLive(m);
      const title =
        m.title ||
        (m.teams
          ? `${m.teams?.home?.name || ''} vs ${m.teams?.away?.name || ''}`
          : 'Match');
      return `
      <div class="related-card" role="button" tabindex="0" aria-label="Watch ${escapeHtml(title)}" data-match-id="${escapeHtml(m.id)}">
        <div class="related-card-meta">
          <span class="related-sport">${getSportEmoji(m.category)} ${escapeHtml(capitalize(m.category))}</span>
          ${live ? '<span class="related-live"><span class="live-dot"></span> LIVE</span>' : ''}
        </div>
        <div class="related-card-title">${escapeHtml(title)}</div>
      </div>`;
    })
    .join('');

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
