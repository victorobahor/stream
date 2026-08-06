import type { APIMatch } from '../types';
import { state } from '../state';
import {
  el,
  filterMatchesWithSources,
  filterMatchesBySearch,
  filterMatchesBySport,
  filterMatchesByCategory,
  sortMatchesForDisplay,
} from '../helpers';
import { formatSportLabel, getSportEmoji, isMatchLive } from '../format';
import { renderSportChips, ALL_SPORTS } from '../chips';
import { loadMatchStreamsIntoActiveSlot } from './slots';

// ── Sidebar search ──

export function handleMultiviewSearch(query: string): void {
  state.multiviewSearchQuery = query.toLowerCase().trim();
  applyMultiviewSidebarFilters();
}

function isMultiviewVisible(): boolean {
  const view = document.getElementById('multiview-view');
  return !!view && !view.classList.contains('hidden');
}

export function applyMultiviewSidebarFilters(): void {
  // Rebuilding a list nobody can see is pure waste; `renderMultiviewSidebar`
  // re-runs this when the view is opened.
  if (!isMultiviewVisible()) return;

  let matches = filterMatchesWithSources(state.allMatches);
  matches = filterMatchesByCategory(matches, state.currentCategory);

  if (state.multiviewSearchQuery) {
    matches = filterMatchesBySearch(matches, state.multiviewSearchQuery);
  }

  if (state.multiviewSportFilter !== ALL_SPORTS) {
    matches = filterMatchesBySport(matches, state.multiviewSportFilter);
  }

  renderMultiviewSidebarList(sortMatchesForDisplay(matches));
}

// ── Render sidebar ──

export function renderMultiviewSidebar(): void {
  renderSportChips(el('multiview-sports-filter'), {
    chipClass: 'mini-sport-chip',
    allLabel: 'All',
    activeId: state.multiviewSportFilter,
    onSelect: id => {
      state.multiviewSportFilter = id;
      applyMultiviewSidebarFilters();
    },
  });

  applyMultiviewSidebarFilters();
}

/** Keep the sidebar list light — same window as the home grid. */
export const SIDEBAR_RENDER_LIMIT = 48;

export function renderMultiviewSidebarList(matches: APIMatch[]): void {
  const container = el('multiview-match-list');
  if (!container) return;

  if (matches.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'sidebar-empty';
    empty.textContent = 'No matches found';
    container.replaceChildren(empty);
    return;
  }

  const visible = matches.slice(0, SIDEBAR_RENDER_LIMIT);
  const fragment = document.createDocumentFragment();

  if (matches.length > SIDEBAR_RENDER_LIMIT) {
    const note = document.createElement('p');
    note.className = 'sidebar-empty';
    note.textContent = `Showing ${visible.length} of ${matches.length} — refine search to narrow.`;
    fragment.appendChild(note);
  }

  visible.forEach(match => {
    const live = isMatchLive(match);
    const title =
      match.title || (match.teams ? `${match.teams.home?.name ?? ''} vs ${match.teams.away?.name ?? ''}` : 'Match');
    const sportEmoji = getSportEmoji(match.category);

    const card = document.createElement('div');
    card.className = 'sidebar-match-card';
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    card.draggable = true;
    card.setAttribute('aria-label', `Select ${title}`);
    card.dataset.id = match.id;

    const meta = document.createElement('div');
    meta.className = 'mv-card-meta';

    const sportSpan = document.createElement('span');
    sportSpan.className = 'mv-card-sport';
    sportSpan.textContent = `${sportEmoji} ${formatSportLabel(match.category || '')}`;
    meta.appendChild(sportSpan);

    if (live) {
      const liveSpan = document.createElement('span');
      liveSpan.className = 'mv-card-live';
      const dot = document.createElement('span');
      dot.className = 'live-dot';
      liveSpan.append(dot, ' LIVE');
      meta.appendChild(liveSpan);
    }

    const teams = document.createElement('div');
    teams.className = 'mv-card-teams';
    teams.textContent = title;

    const streams = document.createElement('div');
    streams.className = 'sidebar-match-streams';

    const btn = document.createElement('button');
    btn.className = 'mv-stream-mini-btn';
    btn.textContent = 'Load Stream';
    streams.appendChild(btn);

    card.append(meta, teams, streams);
    fragment.appendChild(card);
  });

  container.replaceChildren(fragment);

  if (!container.dataset.eventsBound) {
    container.dataset.eventsBound = 'true';

    const activate = (card: HTMLElement) => {
      if (card.dataset.id) loadMatchStreamsIntoActiveSlot(card.dataset.id);
    };

    container.addEventListener('click', e => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('.sidebar-match-card');
      if (card) activate(card);
    });

    container.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = (e.target as HTMLElement).closest<HTMLElement>('.sidebar-match-card');
      if (!card) return;
      e.preventDefault();
      activate(card);
    });

    container.addEventListener('dragstart', e => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('.sidebar-match-card');
      const de = e as DragEvent;
      if (!card?.dataset.id || !de.dataTransfer) return;
      de.dataTransfer.setData('text/plain', card.dataset.id);
      card.classList.add('dragging');
      document.querySelectorAll('.mv-slot').forEach(s => s.classList.add('active-target'));
    });

    container.addEventListener('dragend', e => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('.sidebar-match-card');
      if (!card) return;
      card.classList.remove('dragging');
      // Restore the real active-slot highlight rather than clearing all of them.
      const activeSelector = `.mv-slot[data-index="${state.multiviewActiveSlot}"]`;
      document.querySelectorAll('.mv-slot').forEach(s => {
        s.classList.toggle('active-target', s.matches(activeSelector));
      });
    });
  }
}
