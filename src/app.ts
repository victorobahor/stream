import { state } from './state';
import { loadSports, loadMatches } from './api';
import { applyFilters } from './filters';
import { showSkeleton, hideError, showError, renderSportsBar } from './ui';
import { updateSectionTitle } from './filters';
import { applyMultiviewSidebarFilters } from './multiview/sidebar';
import { loadMultiviewState } from './multiview/slots';
import { attachGlobalDelegates } from './delegates';

// ── Orchestrated loadMatches with UI feedback ──

async function loadMatchesWithUI(): Promise<void> {
  showSkeleton(true);
  hideError();
  try {
    await loadMatches();
    applyFilters();
    if (typeof applyMultiviewSidebarFilters === 'function') {
      applyMultiviewSidebarFilters();
    }
    showSkeleton(false);
    updateSectionTitle();
  } catch (err) {
    showSkeleton(false);
    showError(`Could not load matches: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Sports load with UI ──

async function loadSportsWithUI(): Promise<void> {
  try {
    await loadSports();
    renderSportsBar();
  } catch (e) {
    // Sports load failure is non-fatal
  }
}

// ── Filter category (wired to HTML) ──

export { filterCategory, filterSport, handleSearch } from './filters';
export { showHome, showSkeleton, hideError, showError, retryLoad, toggleMobileMenu, closeMobileMenu } from './ui';
export { showMultiview, changeMultiviewLayout } from './multiview/grid';
export { clearAllMultiviewSlots, toggleMultiviewSidebar } from './multiview/slots';
export { handleMultiviewSearch } from './multiview/sidebar';
export { closeMvModal, showMvModalMatchesView, filterMvModalMatches } from './multiview/modal';

// ── Auto-refresh ──

function startAutoRefresh(): void {
  if (state.refreshInterval) clearInterval(state.refreshInterval);
  state.refreshInterval = setInterval(() => {
    if (state.currentCategory === 'live' && !state.currentMatch) loadMatchesWithUI();
  }, 60_000);
}

// ── Init ──

async function init(): Promise<void> {
  attachGlobalDelegates();
  await loadSportsWithUI();
  await loadMatchesWithUI();
  loadMultiviewState();
  startAutoRefresh();
}

document.addEventListener('DOMContentLoaded', init);
