import { state } from './state';
import { el, stopAllIframes } from './helpers';
import { renderSportChips, ALL_SPORTS } from './chips';
import { filterSport, loadMatchesWithUI } from './filters';

// ── View switching ──

export function showHome(): void {
  document.body.classList.remove('multiview-active', 'player-active');
  // Resume orb animation only when the tab itself is visible.
  document.body.classList.toggle('bg-paused', document.hidden);
  el('player-view')?.classList.add('hidden');
  el('multiview-view')?.classList.add('hidden');
  el('home-view')?.classList.remove('hidden');
  state.currentMatch = null;
  stopAllIframes();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  document.title = 'StreamZone — Live Sports Streaming';
}

// ── Loading states ──

export function showSkeleton(show: boolean): void {
  el('skeleton-grid')?.classList.toggle('hidden', !show);
  if (show) {
    // Loading replaces both outcomes; do not toggle the grid visible again when
    // the skeleton hides — renderMatches owns grid vs empty-state visibility.
    // Toggling the grid here re-showed stale cards under "No matches found".
    el('matches-grid')?.classList.add('hidden');
    el('empty-state')?.classList.add('hidden');
  }
}

export function hideError(): void {
  el('error-state')?.classList.add('hidden');
}

export function showError(msg: string): void {
  el('error-state')?.classList.remove('hidden');
  const errorMsg = el('error-msg');
  if (errorMsg) errorMsg.textContent = msg || 'Something went wrong.';
  el('matches-grid')?.classList.add('hidden');
  el('skeleton-grid')?.classList.add('hidden');
  el('empty-state')?.classList.add('hidden');
}

export function retryLoad(): void {
  void loadMatchesWithUI();
}

// ── Navigation ──

export function setActiveNav(linkEl: HTMLElement | null): void {
  // Cleared by query rather than from a cached reference: the mobile nav can be
  // rebuilt, and a retained node would both miss the live link and leak the
  // detached one.
  document.querySelectorAll('.nav-link.active').forEach(l => l.classList.remove('active'));
  if (linkEl) linkEl.classList.add('active');
}

export function toggleMobileMenu(): void {
  el('mobile-nav')?.classList.toggle('open');
}

export function closeMobileMenu(): void {
  el('mobile-nav')?.classList.remove('open');
}

// ── Sports bar rendering ──

export function renderSportsBar(): void {
  renderSportChips(el('sports-bar'), {
    chipClass: 'sport-chip',
    allLabel: 'All Sports',
    withEmoji: true,
    activeId: state.currentSport || ALL_SPORTS,
    onSelect: filterSport,
  });
}
