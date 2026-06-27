import type { Category, MultiviewLayout } from './types';
import { state } from './state';
import { filterCategory, filterSport, handleSearch } from './filters';
import { showHome, retryLoad, toggleMobileMenu, closeMobileMenu } from './ui';
import { showMultiview, changeMultiviewLayout } from './multiview/grid';
import { clearAllMultiviewSlots, toggleMultiviewSidebar } from './multiview/slots';
import { handleMultiviewSearch } from './multiview/sidebar';
import { closeMvModal, showMvModalMatchesView, filterMvModalMatches } from './multiview/modal';
import { debounceString } from './helpers';

type ActionHandler = (target: HTMLElement, value?: string) => void;

const ACTION_MAP: Record<string, ActionHandler> = {
  filterCategory: (_, value) => {
    if (value) filterCategory(value as Category);
  },
  showHome: () => showHome(),
  showMultiview: () => showMultiview(),
  toggleMobileMenu: () => toggleMobileMenu(),
  closeMobileMenu: () => closeMobileMenu(),
  retryLoad: () => retryLoad(),
  filterSport: (target, value) => {
    if (value) filterSport(value, target);
  },
  changeMultiviewLayout: (_, value) => {
    if (value) changeMultiviewLayout(value as MultiviewLayout);
  },
  clearAllMultiviewSlots: () => clearAllMultiviewSlots(),
  toggleMultiviewSidebar: () => toggleMultiviewSidebar(),
  closeMvModal: () => closeMvModal(),
  showMvModalMatchesView: () => showMvModalMatchesView(),
};

const debouncedSearch = debounceString((query: string) => handleSearch(query), 300);
const debouncedMultiviewSearch = debounceString((query: string) => handleMultiviewSearch(query), 300);
const debouncedModalSearch = debounceString((query: string) => filterMvModalMatches(query), 300);

export function attachGlobalDelegates(): void {
  // Click delegation for all data-action elements
  document.addEventListener('click', e => {
    const target = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
    if (!target) return;

    const action = target.dataset.action!;
    const value = target.dataset.value;

    // Also handle nav links that set active state
    if (target.classList.contains('nav-link') || target.closest('.nav-link')) {
      const navLink = target.classList.contains('nav-link') ? target : target.closest('.nav-link') as HTMLElement;
      document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
      navLink.classList.add('active');
    }

    if (action === 'setActiveNav') {
      document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
      target.classList.add('active');
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
    switch (target.id) {
      case 'search-input':
        debouncedSearch(target.value);
        break;
      case 'multiview-search':
        debouncedMultiviewSearch(target.value);
        break;
      case 'mv-modal-search':
        debouncedModalSearch(target.value);
        break;
    }
  });

  // Keyboard: Escape to close modal or go home, / to search
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
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
        closeMvModal();
      } else if (state.currentMatch) {
        showHome();
      }
    }
  });
}
