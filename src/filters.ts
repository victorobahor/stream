import type { Category } from './types';
import { state } from './state';
import { el, filterMatchesWithSources, filterMatchesBySearch, sortMatchesForDisplay, log } from './helpers';
import { getSportEmoji, formatSportLabel } from './format';
import { syncSportChips, ALL_SPORTS } from './chips';
import { renderMatches } from './cards';
import { showHome, showSkeleton, hideError, showError } from './ui';
import { loadMatches } from './api';

/**
 * Refresh the multiview sidebar, but only when it is actually on screen — this
 * also keeps the multiview chunk out of the home view's critical path.
 */
function refreshMultiviewSidebar(): void {
  const view = document.getElementById('multiview-view');
  if (!view || view.classList.contains('hidden')) return;
  import('./multiview/sidebar')
    .then(m => m.applyMultiviewSidebarFilters())
    .catch(err => log('error', 'Failed to refresh multiview sidebar:', err));
}

const CATEGORIES: readonly Category[] = ['live', 'all', 'today', 'popular'];

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

/** Bumps on every UI load so a slow sport/category click cannot paint over a newer one. */
let loadMatchesUiId = 0;

/**
 * The single load-and-refilter path: fetch matches, refresh every view that
 * derives from them, and surface progress/errors in the UI.
 */
export async function loadMatchesWithUI(options: { skeleton?: boolean } = {}): Promise<void> {
  const { skeleton = true } = options;
  const uiId = ++loadMatchesUiId;
  if (skeleton) showSkeleton(true);
  hideError();
  // Title tracks the chip/nav immediately — don't wait on the probe.
  updateSectionTitle();
  try {
    // Wait for playable probing before paint — a preliminary source-only paint
    // flashed dead cards (and wrong filters) until the prune finished.
    await loadMatches();
    if (uiId !== loadMatchesUiId) return;
    if (skeleton) showSkeleton(false);
    applyFilters();
    refreshMultiviewSidebar();
  } catch (err) {
    if (uiId !== loadMatchesUiId) return;
    if (skeleton) showSkeleton(false);
    showError(`Could not load matches: ${err instanceof Error ? err.message : String(err)}`);
    log('error', 'Failed to load matches:', err);
  }
}

export function filterCategory(cat: string): void {
  if (!isCategory(cat)) {
    log('warn', `Ignoring unknown category "${cat}"`);
    return;
  }
  state.currentCategory = cat;
  state.currentSport = ALL_SPORTS;
  state.searchQuery = '';
  const searchInput = el('search-input') as HTMLInputElement | null;
  if (searchInput) searchInput.value = '';
  syncSportChips(el('sports-bar'), ALL_SPORTS);
  showHome();
  void loadMatchesWithUI();
}

export function filterSport(sportId: string): void {
  state.currentSport = sportId;
  syncSportChips(el('sports-bar'), sportId);
  void loadMatchesWithUI();
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

  renderMatches(sortMatchesForDisplay(matches));
}

export function updateSectionTitle(): void {
  const titles: Record<string, string> = {
    live: 'Live Matches',
    all: 'All Matches',
    today: "Today's Matches",
    popular: '🔥 Popular Matches',
  };
  let title = titles[state.currentCategory] || 'Matches';
  if (state.currentSport !== ALL_SPORTS) {
    title = `${getSportEmoji(state.currentSport)} ${formatSportLabel(state.currentSport)} — ${title}`;
  }
  const titleEl = el('section-title');
  if (titleEl) titleEl.textContent = title;
}
