import type { APIMatch } from '../types';
import { state } from '../state';
import { el, escapeHtml, filterMatchesWithSources, filterMatchesBySearch, filterMatchesBySport, sortMatchesByLive } from '../helpers';
import { capitalize, getSportEmoji, isMatchLive } from '../format';
import { loadMatchStreamsIntoActiveSlot } from './slots';

// ── Sidebar search ──

export function handleMultiviewSearch(query: string): void {
  state.multiviewSearchQuery = query.toLowerCase().trim();
  applyMultiviewSidebarFilters();
}

export function applyMultiviewSidebarFilters(): void {
  let matches = filterMatchesWithSources(state.allMatches);

  if (state.multiviewSearchQuery) {
    matches = filterMatchesBySearch(matches, state.multiviewSearchQuery);
  }

  if (state.multiviewSportFilter !== 'all') {
    matches = filterMatchesBySport(matches, state.multiviewSportFilter);
  }

  matches = sortMatchesByLive(matches);

  renderMultiviewSidebarList(matches);
}

// ── Render sidebar ──

export function renderMultiviewSidebar(): void {
  const bar = el('multiview-sports-filter');
  if (!bar) return;
  bar.innerHTML = '';

  const fragment = document.createDocumentFragment();

  const allChip = document.createElement('button');
  allChip.className = 'mini-sport-chip' + (state.multiviewSportFilter === 'all' ? ' active' : '');
  allChip.textContent = 'All';
  allChip.onclick = () => {
    state.multiviewSportFilter = 'all';
    bar.querySelectorAll('.mini-sport-chip').forEach(c => c.classList.remove('active'));
    allChip.classList.add('active');
    applyMultiviewSidebarFilters();
  };
  fragment.appendChild(allChip);

  const seen = new Set<string>();
  state.sports.forEach(sport => {
    const id = sport.id || sport.name || (sport as unknown as string);
    if (seen.has(id)) return;
    seen.add(id);
    const name = sport.name || sport.id || (sport as unknown as string);
    const chip = document.createElement('button');
    chip.className = 'mini-sport-chip' + (state.multiviewSportFilter === id ? ' active' : '');
    chip.textContent = capitalize(name);
    chip.onclick = () => {
      state.multiviewSportFilter = id;
      bar.querySelectorAll('.mini-sport-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      applyMultiviewSidebarFilters();
    };
    fragment.appendChild(chip);
  });

  bar.appendChild(fragment);

  applyMultiviewSidebarFilters();
}

export function renderMultiviewSidebarList(matches: APIMatch[]): void {
  const container = el('multiview-match-list');
  if (!container) return;
  if (matches.length === 0) {
    container.innerHTML =
      '<p style="color:var(--text3);font-size:0.75rem;text-align:center;padding:12px;">No matches found</p>';
    return;
  }

  container.innerHTML = matches
    .map(match => {
      const live = isMatchLive(match);
      const title =
        match.title || (match.teams ? `${match.teams.home!.name} vs ${match.teams.away!.name}` : 'Match');
      const sportEmoji = getSportEmoji(match.category);

      return `
      <div class="sidebar-match-card" role="button" tabindex="0" draggable="true" data-id="${escapeHtml(match.id)}">
        <div class="mv-card-meta">
          <span class="mv-card-sport">${sportEmoji} ${escapeHtml(capitalize(match.category))}</span>
          ${live ? '<span class="mv-card-live"><span class="live-dot"></span> LIVE</span>' : ''}
        </div>
        <div class="mv-card-teams">${escapeHtml(title)}</div>
        <div class="sidebar-match-streams">
          <button class="mv-stream-mini-btn" data-load-match-id="${escapeHtml(match.id)}">
            Load Stream
          </button>
        </div>
      </div>
    `;
    })
    .join('');

  if (!container.dataset.eventsBound) {
    // ⚡ Bolt Optimization: Use event delegation for list items to reduce DOM memory and CPU overhead.
    container.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.mv-stream-mini-btn') as HTMLElement;
      if (btn && container.contains(btn)) {
        e.stopPropagation();
        loadMatchStreamsIntoActiveSlot(btn.dataset.loadMatchId!);
      }
    });

    container.addEventListener('keydown', (e) => {
      const event = e as KeyboardEvent;
      if (event.key === 'Enter' || event.key === ' ') {
        const card = (e.target as HTMLElement).closest('.sidebar-match-card') as HTMLElement;
        if (card && container.contains(card)) {
          event.preventDefault();
          const btn = card.querySelector('.mv-stream-mini-btn');
          if (btn) (btn as HTMLElement).click();
        }
      }
    });

    container.addEventListener('dragstart', (e) => {
      const card = (e.target as HTMLElement).closest('.sidebar-match-card') as HTMLElement;
      if (card && container.contains(card)) {
        const de = e as DragEvent;
        de.dataTransfer!.setData('text/plain', card.dataset.id!);
        card.classList.add('dragging');
        document.querySelectorAll('.mv-slot').forEach(s => s.classList.add('active-target'));
      }
    });

    container.addEventListener('dragend', (e) => {
      const card = (e.target as HTMLElement).closest('.sidebar-match-card') as HTMLElement;
      if (card && container.contains(card)) {
        card.classList.remove('dragging');
        document.querySelectorAll('.mv-slot').forEach(s => s.classList.remove('active-target'));
      }
    });

    container.dataset.eventsBound = 'true';
  }
}
