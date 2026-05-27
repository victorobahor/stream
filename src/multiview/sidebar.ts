import type { APIMatch } from '../types';
import { state } from '../state';
import { el, escapeHtml, matchTextIncludes } from '../helpers';
import { capitalize, getSportEmoji, isMatchLive, showToast } from '../format';
import { getNumSlotsForLayout } from './grid';
import { loadMatchStreamsIntoActiveSlot } from './slots';

// ── Sidebar search ──

export function handleMultiviewSearch(query: string): void {
  state.multiviewSearchQuery = query.toLowerCase().trim();
  applyMultiviewSidebarFilters();
}

export function applyMultiviewSidebarFilters(): void {
  let matches = [...state.allMatches];
  matches = matches.filter(m => m.sources && m.sources.length > 0);

  if (state.multiviewSearchQuery) {
    matches = matches.filter(m => matchTextIncludes(m, state.multiviewSearchQuery));
  }

  if (state.multiviewSportFilter !== 'all') {
    matches = matches.filter(
      m => (m.category || '').toLowerCase() === state.multiviewSportFilter.toLowerCase()
    );
  }

  matches.sort((a, b) => {
    const aEpl = isMatchLive(a) ? 1 : 0; // simplified: live matches first
    const bEpl = isMatchLive(b) ? 1 : 0;
    return bEpl - aEpl;
  });

  renderMultiviewSidebarList(matches);
}

// ── Render sidebar ──

export function renderMultiviewSidebar(): void {
  const bar = el('multiview-sports-filter');
  if (!bar) return;
  bar.innerHTML = '';

  const allChip = document.createElement('button');
  allChip.className = 'mini-sport-chip' + (state.multiviewSportFilter === 'all' ? ' active' : '');
  allChip.textContent = 'All';
  allChip.onclick = () => {
    state.multiviewSportFilter = 'all';
    bar.querySelectorAll('.mini-sport-chip').forEach(c => c.classList.remove('active'));
    allChip.classList.add('active');
    applyMultiviewSidebarFilters();
  };
  bar.appendChild(allChip);

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
    bar.appendChild(chip);
  });

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
      <div class="sidebar-match-card" draggable="true" data-id="${escapeHtml(match.id)}">
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

  container.querySelectorAll('.sidebar-match-card').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      const de = e as DragEvent;
      de.dataTransfer!.setData('text/plain', (card as HTMLElement).dataset.id!);
      card.classList.add('dragging');
      document.querySelectorAll('.mv-slot').forEach(s => s.classList.add('active-target'));
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      document.querySelectorAll('.mv-slot').forEach(s => s.classList.remove('active-target'));
    });
  });

  container.querySelectorAll('.mv-stream-mini-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      loadMatchStreamsIntoActiveSlot((btn as HTMLElement).dataset.loadMatchId!);
    });
  });
}
