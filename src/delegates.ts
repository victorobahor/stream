import type { MultiviewLayout } from './types';
import { state } from './state';
import { filterCategory, filterSport, handleSearch } from './filters';
import { showHome, retryLoad, toggleMobileMenu, closeMobileMenu, setActiveNav } from './ui';
import { debounce, log } from './helpers';

type ActionHandler = (target: HTMLElement, value?: string) => void;

const VALID_LAYOUTS: readonly MultiviewLayout[] = ['1x2', '2x2'];

// Multiview is a separate chunk; importing it on demand keeps it off the
// critical path for visitors who only ever use the home and player views.
function withGrid(run: (mod: typeof import('./multiview/grid')) => void): void {
  import('./multiview/grid').then(run).catch(err => log('error', 'Failed to load multiview:', err));
}
function withSlots(run: (mod: typeof import('./multiview/slots')) => void): void {
  import('./multiview/slots').then(run).catch(err => log('error', 'Failed to load multiview:', err));
}
function withModal(run: (mod: typeof import('./multiview/modal')) => void): void {
  import('./multiview/modal').then(run).catch(err => log('error', 'Failed to load stream picker:', err));
}

const ACTION_MAP: Record<string, ActionHandler> = {
  filterCategory: (_, value) => {
    if (value) filterCategory(value);
  },
  showHome: () => showHome(),
  showMultiview: () => withGrid(m => m.showMultiview()),
  toggleMobileMenu: () => toggleMobileMenu(),
  closeMobileMenu: () => closeMobileMenu(),
  retryLoad: () => retryLoad(),
  filterSport: (_, value) => {
    if (value) filterSport(value);
  },
  changeMultiviewLayout: (_, value) => {
    if (!value) return;
    if (!(VALID_LAYOUTS as readonly string[]).includes(value)) {
      log('warn', `Ignoring unknown multiview layout "${value}"`);
      return;
    }
    withGrid(m => m.changeMultiviewLayout(value as MultiviewLayout));
  },
  clearAllMultiviewSlots: () => withSlots(m => m.clearAllMultiviewSlots()),
  fullscreenMultiviewGrid: () => withSlots(m => m.fullscreenMultiviewGrid()),
  toggleMultiviewSidebar: () => withSlots(m => m.toggleMultiviewSidebar()),
  closeMvModal: () => withModal(m => m.closeMvModal()),
  showMvModalMatchesView: () => withModal(m => m.showMvModalMatchesView()),
};

const SEARCH_HANDLERS: Record<string, (query: string) => void> = {
  'search-input': debounce(handleSearch, 300),
  // Both multiview inputs only exist once the chunk that renders them is loaded.
  'multiview-search': debounce((query: string) => {
    import('./multiview/sidebar')
      .then(m => m.handleMultiviewSearch(query))
      .catch(err => log('error', 'Failed to search multiview matches:', err));
  }, 300),
  'mv-modal-search': debounce((query: string) => {
    withModal(m => m.filterMvModalMatches(query));
  }, 300),
};

/** Typing in a text field should not be captured by the `/` hotkey. */
function isTextEntryTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true;
}

let delegatesAttached = false;

export function attachGlobalDelegates(): void {
  // Every action would fire twice on a second call.
  if (delegatesAttached) return;
  delegatesAttached = true;

  // Click delegation for all data-action elements
  document.addEventListener('click', e => {
    const target = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
    if (!target) return;

    const action = target.dataset.action!;
    const value = target.dataset.value;

    // Also handle nav links that set active state
    if (target.classList.contains('nav-link') || target.closest('.nav-link')) {
      const navLink = target.classList.contains('nav-link') ? target : target.closest('.nav-link') as HTMLElement;
      setActiveNav(navLink);
    }

    if (action === 'setActiveNav') {
      setActiveNav(target);
      return;
    }

    if (action === 'filterCategory' && value) {
      if (target.classList.contains('nav-link') || target.closest('.mobile-nav')) {
        closeMobileMenu();
      }
    }

    if (action === 'showMultiview') {
      if (target.closest('.mobile-nav')) {
        closeMobileMenu();
      }
    }

    const handler = ACTION_MAP[action];
    if (handler) {
      e.preventDefault();
      handler(target, value);
    }
  });

  // Input delegation
  document.addEventListener('input', e => {
    const target = e.target as HTMLInputElement;
    SEARCH_HANDLERS[target.id]?.(target.value);
  });

  // Keyboard: Escape to close modal or go home, / to search
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !isTextEntryTarget(e.target)) {
      e.preventDefault();
      const modal = document.getElementById('mv-modal');
      const isModalOpen = modal && !modal.classList.contains('hidden');
      const isMultiviewOpen = document.body.classList.contains('multiview-active');

      let targetInputId = 'search-input';
      if (isModalOpen) {
        targetInputId = 'mv-modal-search';
      } else if (isMultiviewOpen) {
        targetInputId = 'multiview-search';
      }

      const searchInput = document.getElementById(targetInputId);
      if (searchInput) {
        searchInput.focus();
        if (!isModalOpen) {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }
    } else if (e.key === 'Escape') {
      const modal = document.getElementById('mv-modal');
      if (modal && !modal.classList.contains('hidden')) {
        withModal(m => m.closeMvModal());
      } else if (state.currentMatch) {
        showHome();
      }
    }
  });
}
