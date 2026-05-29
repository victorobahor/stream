import type { APIMatch, Category } from './types';
import { state } from './state';
import { el, matchTextIncludes, filterMatchesWithSources, filterMatchesBySearch } from './helpers';
import { isEPLMatch, getSportEmoji, capitalize } from './format';
import { renderMatches } from './cards';
import { showHome } from './ui';
import { loadMatches } from './api';
import { applyMultiviewSidebarFilters } from './multiview/sidebar';

export function filterCategory(cat: string): void {
  state.currentCategory = cat as Category;
  state.currentSport = 'all';
  state.searchQuery = '';
  const searchInput = el('search-input') as HTMLInputElement;
  if (searchInput) searchInput.value = '';
  document.querySelectorAll('.sport-chip').forEach(c => c.classList.remove('active'));
  const firstChip = document.querySelector('.sport-chip');
  if (firstChip) firstChip.classList.add('active');
  showHome();
  loadMatches().then(() => {
    applyFilters();
    applyMultiviewSidebarFilters();
  }).catch(err => {
    console.error('Failed to load matches:', err);
  });
}

export function filterSport(sportId: string, chipEl?: HTMLElement): void {
  state.currentSport = sportId;
  document.querySelectorAll('.sport-chip').forEach(c => c.classList.remove('active'));
  if (chipEl) chipEl.classList.add('active');
  loadMatches().then(() => {
    applyFilters();
    applyMultiviewSidebarFilters();
  }).catch(err => {
    console.error('Failed to load matches:', err);
  });
}

export function handleSearch(query: string): void {
  state.searchQuery = query.toLowerCase().trim();
  applyFilters();
}

export function applyFilters(): void {
  let matches = filterMatchesWithSources(state.allMatches);

  if (state.searchQuery) {
    matches = filterMatchesBySearch(matches, state.searchQuery);
  }

  matches.sort((a, b) => {
    const aEpl = isEPLMatch(a);
    const bEpl = isEPLMatch(b);
    if (aEpl && !bEpl) return -1;
    if (!aEpl && bEpl) return 1;
    return 0;
  });

  state.filteredMatches = matches;
  renderMatches(matches);
}

export function updateSectionTitle(): void {
  const titles: Record<string, string> = {
    live: 'Live Matches',
    all: 'All Matches',
    today: "Today's Matches",
    popular: '🔥 Popular Matches',
  };
  let title = titles[state.currentCategory] || 'Matches';
  if (state.currentSport !== 'all') {
    title = `${getSportEmoji(state.currentSport)} ${capitalize(state.currentSport)} — ${title}`;
  }
  const titleEl = el('section-title');
  if (titleEl) titleEl.textContent = title;
}
