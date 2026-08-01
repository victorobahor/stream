import type { MultiviewLayout, MultiviewSlot } from '../types';
import { state } from '../state';
import { el, sanitizeUrl, applyEmbed, clearEmbed, log } from '../helpers';
import { mountPlayGate } from '../adShield';
import { getMatchById, loadMatches } from '../api';
import { setActiveNav } from '../ui';
import { applyFilters } from '../filters';
import { renderMultiviewSidebar, applyMultiviewSidebarFilters } from './sidebar';
import {
  loadMultiviewSlotStream,
  changeSlotSource,
  changeSlotStreamIndex,
  fullscreenMultiviewSlot,
  clearMultiviewSlot,
  saveMultiviewState,
  markActiveSlotPicked,
} from './slots';
import { openMvModal } from './modal';

// ── Layout utils ──

export function getNumSlotsForLayout(layout: MultiviewLayout): number {
  const map: Record<MultiviewLayout, number> = {
    '1x2': 2,
    '2x2': 4,
  };
  return map[layout] || 2;
}

const EMBED_LOAD_TIMEOUT_MS = 8000;

/** Per-slot load-fallback timers, so stream switches cannot pile them up. */
const slotLoadTimers = new Map<number, ReturnType<typeof setTimeout>>();

function clearSlotLoadTimer(i: number): void {
  const timer = slotLoadTimers.get(i);
  if (timer !== undefined) {
    clearTimeout(timer);
    slotLoadTimers.delete(i);
  }
}

// ── Markup templates (parsed once) ──

function template(markup: string): HTMLTemplateElement {
  const tmpl = document.createElement('template');
  tmpl.innerHTML = markup;
  return tmpl;
}

const EMPTY_SLOT_TEMPLATE = template(`
    <div class="mv-slot-num"></div>
    <div class="mv-slot-add-label">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Empty Slot
    </div>
    <button class="mv-slot-add-btn" data-slot-action="add">Add Stream</button>
  `);

const SLOT_HEADER_TEMPLATE = template(
  '<div class="mv-slot-header"><div class="mv-slot-title"></div><div class="mv-slot-controls">' +
    '<select class="mv-source-select" data-slot-action="change-source" aria-label="Select stream source"></select>' +
    '<select class="mv-source-select" data-slot-action="change-stream" aria-label="Select stream quality"></select>' +
    '<button class="mv-control-btn" aria-label="Fullscreen stream" data-slot-action="fullscreen" title="Fullscreen"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg></button>' +
    '<button class="mv-control-btn close-btn" aria-label="Close stream" data-slot-action="clear" title="Close Stream"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
    '</div></div>'
);

const LOADING_TEMPLATE = template('<div class="mv-loading"><div class="spinner"></div><span>Loading stream…</span></div>');

// ── Slot events ──

/**
 * Slot-level listeners, attached once when the element is created. Child
 * controls are reached by delegation, so rebuilding a slot's contents never
 * needs to rebind anything.
 */
function attachSlotEvents(slotEl: HTMLDivElement, i: number): void {
  slotEl.addEventListener('dragover', e => {
    e.preventDefault();
  });
  slotEl.addEventListener('dragenter', e => {
    e.preventDefault();
    slotEl.classList.add('drag-over');
  });
  slotEl.addEventListener('dragleave', () => {
    slotEl.classList.remove('drag-over');
  });
  slotEl.addEventListener('drop', e => {
    e.preventDefault();
    slotEl.classList.remove('drag-over');
    const matchId = (e as DragEvent).dataTransfer?.getData('text/plain');
    if (!matchId) return;
    const match = getMatchById(matchId);
    if (match?.sources?.length) {
      void loadMultiviewSlotStream(i, match, match.sources[0].source, 0);
    }
  });

  slotEl.addEventListener('change', e => {
    const select = (e.target as HTMLElement).closest<HTMLSelectElement>('select[data-slot-action]');
    if (!select) return;
    e.stopPropagation();
    if (select.dataset.slotAction === 'change-source') {
      changeSlotSource(i, select.value);
    } else {
      changeSlotStreamIndex(i, parseInt(select.value, 10));
    }
  });

  slotEl.addEventListener('click', e => {
    const control = (e.target as HTMLElement).closest<HTMLElement>('[data-slot-action]');
    if (control) {
      e.stopPropagation();
      switch (control.dataset.slotAction) {
        case 'fullscreen':
          fullscreenMultiviewSlot(i);
          return;
        case 'clear':
          clearMultiviewSlot(i);
          return;
        case 'add':
          openMvModal(i);
          return;
        default:
          return;
      }
    }
    // Clicks on the header chrome should not retarget the active slot.
    if ((e.target as HTMLElement).closest('.mv-slot-header')) return;
    setActiveSlot(i);
  });
}

function setActiveSlot(i: number): void {
  state.multiviewActiveSlot = i;
  markActiveSlotPicked();
  document.querySelectorAll('.mv-slot').forEach((s, idx) => {
    s.classList.toggle('active-target', idx === i);
  });
}

// ── Slot content ──

function buildSlotHeader(slot: MultiviewSlot): DocumentFragment {
  const content = SLOT_HEADER_TEMPLATE.content.cloneNode(true) as DocumentFragment;
  const match = slot.match;
  const title = match.teams
    ? `${match.teams.home?.name ?? ''} vs ${match.teams.away?.name ?? ''}`
    : (match.title || '');

  const titleEl = content.querySelector('.mv-slot-title') as HTMLElement;
  titleEl.title = title;
  titleEl.textContent = title;

  const [sourceSelect, streamSelect] = content.querySelectorAll<HTMLSelectElement>('.mv-source-select');

  match.sources.forEach(src => {
    const opt = document.createElement('option');
    opt.value = src.source;
    opt.textContent = src.source;
    opt.selected = src.source === slot.sourceName;
    sourceSelect.appendChild(opt);
  });

  (slot.streams || []).forEach((str, sIdx) => {
    const opt = document.createElement('option');
    opt.value = String(sIdx);
    opt.textContent = `Stream ${str.streamNo ?? sIdx + 1} (${str.language || 'EN'}) ${str.hd ? 'HD' : 'SD'}`;
    opt.selected = sIdx === slot.streamIndex;
    streamSelect.appendChild(opt);
  });

  return content;
}

function buildEmptySlot(slotEl: HTMLDivElement, i: number): void {
  const content = EMPTY_SLOT_TEMPLATE.content.cloneNode(true) as DocumentFragment;
  (content.querySelector('.mv-slot-num') as HTMLElement).textContent = `Slot ${i + 1}`;
  slotEl.replaceChildren(content);
}

/**
 * Bring one slot element in line with `state.multiviewSlots[i]`.
 *
 * A live iframe is only ever replaced when the embed URL actually changes:
 * re-inserting (or even re-parenting) an iframe discards its browsing context,
 * which is what used to restart every other stream on any grid render.
 */
function updateSlotElement(slotEl: HTMLDivElement, i: number): void {
  const slot = state.multiviewSlots[i];
  slotEl.classList.toggle('active-target', i === state.multiviewActiveSlot);

  if (!slot) {
    clearSlotLoadTimer(i);
    slotEl.querySelectorAll<HTMLIFrameElement>('.mv-iframe').forEach(clearEmbed);
    slotEl.classList.add('empty');
    buildEmptySlot(slotEl, i);
    return;
  }

  slotEl.classList.remove('empty');

  const desiredUrl = !slot.loading && slot.stream?.embedUrl ? sanitizeUrl(slot.stream.embedUrl) : '';
  const existing = slotEl.querySelector<HTMLIFrameElement>('.mv-iframe');
  const keepExisting = !!existing && !!desiredUrl && existing.dataset.embedUrl === desiredUrl;

  // Drop everything except an iframe we are keeping — it must stay attached.
  for (const child of Array.from(slotEl.children)) {
    if (keepExisting && child === existing) continue;
    if (child === existing) clearEmbed(existing);
    child.remove();
  }

  if (!keepExisting) clearSlotLoadTimer(i);

  slotEl.appendChild(buildSlotHeader(slot));

  if (!keepExisting && desiredUrl) {
    const iframe = document.createElement('iframe');
    iframe.className = 'mv-iframe';
    iframe.dataset.embedUrl = desiredUrl;
    iframe.allowFullscreen = true;
    iframe.setAttribute('scrolling', 'no');

    const overlay = LOADING_TEMPLATE.content.cloneNode(true) as DocumentFragment;
    // The overlay is opaque and sits above the iframe, so the iframe itself
    // stays visible in the layout — a display:none frame is a poor bet to load.
    const overlayEl = overlay.querySelector('.mv-loading') as HTMLElement;

    const reveal = () => {
      clearSlotLoadTimer(i);
      overlayEl.remove();
      mountPlayGate(slotEl, { message: 'Click to start' });
    };
    iframe.onload = reveal;

    slotEl.appendChild(iframe);
    slotEl.appendChild(overlayEl);
    applyEmbed(iframe, desiredUrl);
    slotLoadTimers.set(i, setTimeout(reveal, EMBED_LOAD_TIMEOUT_MS));
  }

  if (slot.loading) {
    slotEl.appendChild(LOADING_TEMPLATE.content.cloneNode(true));
  }
}

// ── Rendering ──

function createSlotElement(i: number): HTMLDivElement {
  const slotEl = document.createElement('div');
  slotEl.className = 'mv-slot';
  slotEl.dataset.index = String(i);
  attachSlotEvents(slotEl, i);
  return slotEl;
}

/**
 * Re-render a single slot. This is the normal path — loading a stream must not
 * touch the other slots.
 */
export function renderMultiviewSlot(i: number): void {
  const container = el('multiview-grid-container');
  const slotEl = container?.querySelector<HTMLDivElement>(`.mv-slot[data-index="${i}"]`);
  if (!slotEl) {
    // Slot is not currently on screen (e.g. layout shrank) — nothing to draw.
    return;
  }
  updateSlotElement(slotEl, i);
}

/**
 * Reconcile the whole grid. Reserved for layout changes and first paint: slot
 * elements are reused where possible so surviving streams keep playing.
 */
export function renderMultiviewGrid(): void {
  const container = el('multiview-grid-container');
  if (!container) return;

  container.className = `multiview-grid-container layout-${state.multiviewLayout}`;

  const numSlots = getNumSlotsForLayout(state.multiviewLayout);

  while (container.children.length > numSlots) {
    const last = container.lastElementChild as HTMLElement;
    clearSlotLoadTimer(container.children.length - 1);
    last.querySelectorAll<HTMLIFrameElement>('.mv-iframe').forEach(clearEmbed);
    last.remove();
  }
  while (container.children.length < numSlots) {
    container.appendChild(createSlotElement(container.children.length));
  }

  for (let i = 0; i < numSlots; i++) {
    updateSlotElement(container.children[i] as HTMLDivElement, i);
  }
}

// ── Show multiview ──

export function showMultiview(): void {
  document.body.classList.add('multiview-active', 'bg-paused');
  document.body.classList.remove('player-active');
  el('home-view')?.classList.add('hidden');
  el('player-view')?.classList.add('hidden');
  el('multiview-view')?.classList.remove('hidden');

  const mainIframe = el('stream-iframe') as HTMLIFrameElement | null;
  if (mainIframe) clearEmbed(mainIframe);

  setActiveNav(el('nav-multiview'));

  renderMultiviewGrid();
  renderMultiviewSidebar();

  window.scrollTo({ top: 0, behavior: 'smooth' });

  // If matches haven't loaded yet, fetch them and refresh all views
  if (!state.allMatches || state.allMatches.length === 0) {
    loadMatches()
      .then(() => {
        applyFilters();
        applyMultiviewSidebarFilters();
      })
      .catch(err => log('error', 'Failed to load matches for multiview:', err));
  }
}

export function changeMultiviewLayout(layout: MultiviewLayout): void {
  state.multiviewLayout = layout;

  document.querySelectorAll('.layout-btn').forEach(btn => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.layout === layout);
  });

  const numSlots = getNumSlotsForLayout(layout);
  if (state.multiviewActiveSlot >= numSlots) {
    state.multiviewActiveSlot = 0;
  }

  renderMultiviewGrid();
  saveMultiviewState();
}
