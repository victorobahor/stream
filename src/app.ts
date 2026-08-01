import { state } from './state';
import { loadSports } from './api';
import { loadMatchesWithUI } from './filters';
import { renderSportsBar } from './ui';
import { attachGlobalDelegates } from './delegates';
import { MULTIVIEW_STORAGE_KEY } from './multiview/storageKey';
import { log, stopAllIframes } from './helpers';
import { installAdShield } from './adShield';

// ── Sports load with UI ──

async function loadSportsWithUI(): Promise<void> {
  try {
    await loadSports();
    renderSportsBar();
  } catch (e) {
    // Sports load failure is non-fatal, but log for debugging
    log('warn', 'Failed to load sports:', e);
  }
}

// ── Multiview restore ──

/**
 * Only pull in the multiview bundle when there is actually something saved to
 * restore — otherwise the home view never pays for it.
 */
function restoreMultiviewIfSaved(): void {
  let hasSavedState = false;
  try {
    hasSavedState = localStorage.getItem(MULTIVIEW_STORAGE_KEY) !== null;
  } catch (e) {
    log('warn', 'Could not read multiview state:', e);
  }
  if (!hasSavedState) return;

  import('./multiview/slots')
    .then(m => m.loadMultiviewState())
    .catch(err => log('error', 'Failed to restore multiview state:', err));
}

// ── Auto-refresh ──

const REFRESH_INTERVAL_MS = 60_000;

let refreshPending = false;

function shouldRefresh(): boolean {
  return state.currentCategory === 'live' && !state.currentMatch;
}

function refreshMatches(): void {
  if (!shouldRefresh()) return;
  if (document.hidden) {
    // Nothing is on screen to update — catch up when the tab is looked at again.
    refreshPending = true;
    return;
  }
  refreshPending = false;
  // Refresh into the existing grid: the skeleton would throw away scroll and
  // hover state every minute.
  void loadMatchesWithUI({ skeleton: false });
}

function startAutoRefresh(): void {
  if (state.refreshInterval) clearInterval(state.refreshInterval);
  state.refreshInterval = setInterval(refreshMatches, REFRESH_INTERVAL_MS);
}

// ── Init ──

async function init(): Promise<void> {
  // Surface frames the parent CSP is dropping — otherwise a blocked embed is
  // indistinguishable from a dead source. Registered first so nothing is missed.
  document.addEventListener('securitypolicyviolation', e => {
    log('warn', 'CSP blocked', e.blockedURI, e.violatedDirective);
  });

  // Parent-page PopUnder shield (click gate is mounted per player/slot).
  installAdShield();

  attachGlobalDelegates();

  // Independent requests — no reason to serialise them on cold start.
  await Promise.all([loadSportsWithUI(), loadMatchesWithUI()]);

  restoreMultiviewIfSaved();
  startAutoRefresh();

  document.addEventListener('visibilitychange', () => {
    // Pause orbs while the tab is hidden, or while player/multiview already
    // asked for a quieter background.
    const viewPaused =
      document.body.classList.contains('player-active') ||
      document.body.classList.contains('multiview-active');
    document.body.classList.toggle('bg-paused', document.hidden || viewPaused);
    if (!document.hidden && refreshPending) refreshMatches();
  });

  // `pagehide` instead of `beforeunload`: the latter disqualifies the page from
  // the back/forward cache for no benefit, since a discarded document stops its
  // own iframes anyway.
  window.addEventListener('pagehide', () => {
    stopAllIframes();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch(err => log('error', 'Initialisation failed:', err));
});
