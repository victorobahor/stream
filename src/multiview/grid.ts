import type { MultiviewLayout, MultiviewSlot } from '../types';
import { state } from '../state';
import { el, sanitizeUrl, applySandboxedSrcdoc, clearSandboxedSrcdoc } from '../helpers';
import { renderMultiviewSidebar, applyMultiviewSidebarFilters } from './sidebar';

// ── Layout utils ──

export function getNumSlotsForLayout(layout: MultiviewLayout): number {
  const map: Record<MultiviewLayout, number> = {
    '1x2': 2,
    '2x2': 4,
  };
  return map[layout] || 2;
}

// ── Slot events ──

export function attachSlotEvents(slotEl: HTMLDivElement, i: number): void {
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
  slotEl.addEventListener('drop', (e) => {
    e.preventDefault();
    slotEl.classList.remove('drag-over');
    const de = e as DragEvent;
    const matchId = de.dataTransfer?.getData('text/plain');
    if (!matchId) return;
    const match = state.allMatches.find(m => m.id === matchId);
    if (match && match.sources && match.sources.length > 0) {
      import('./slots').then(m => m.loadMultiviewSlotStream(i, match, match.sources[0].source, 0));
    }
  });

  slotEl.addEventListener('click', () => {
    state.multiviewActiveSlot = i;
    document.querySelectorAll('.mv-slot').forEach((s, idx) => {
      s.classList.toggle('active-target', idx === i);
    });
  });
}

// ── Slot content ──

export function buildEmptySlotContent(i: number): string {
  return `
    <div class="mv-slot-num">Slot ${i + 1}</div>
    <div class="mv-slot-add-label">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Empty Slot
    </div>
    <button class="mv-slot-add-btn" data-slot="${i}" aria-label="Add stream to slot ${i + 1}">Add Stream</button>
  `;
}

export function buildFilledSlotContent(slot: MultiviewSlot, i: number): DocumentFragment {
  const match = slot.match;
  const title = match.teams ? `${match.teams.home?.name ?? ''} vs ${match.teams.away?.name ?? ''}` : (match.title || '');

  const frag = document.createDocumentFragment();

  if (slot.stream && slot.stream.embedUrl && !slot.loading) {
    const ifr = document.createElement('iframe');
    ifr.className = 'mv-iframe';
    ifr.dataset.embedUrl = sanitizeUrl(slot.stream.embedUrl);
    ifr.allowFullscreen = true;
    ifr.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
    ifr.frameBorder = '0';
    ifr.scrolling = 'no';
    ifr.setAttribute('referrerpolicy', 'no-referrer');
    frag.appendChild(ifr);
  }

  if (slot.loading) {
    const ld = document.createElement('div');
    ld.className = 'mv-loading';
    ld.innerHTML = '<div class="spinner"></div><span>Loading stream...</span>';
    frag.appendChild(ld);
  }

  const tmpl = document.createElement('template');
  tmpl.innerHTML = `<div class="mv-slot-header"><div class="mv-slot-title"></div><div class="mv-slot-controls"><select class="mv-source-select" data-action="change-source" aria-label="Select stream source"></select><select class="mv-source-select" data-action="change-stream" aria-label="Select stream quality"></select><button class="mv-control-btn" aria-label="Fullscreen stream" data-action="fullscreen" title="Fullscreen"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg></button><button class="mv-control-btn close-btn" aria-label="Close stream" data-action="clear-slot" title="Close Stream"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div></div>`;

  const content = tmpl.content.cloneNode(true) as DocumentFragment;
  const titleEl = content.querySelector('.mv-slot-title') as HTMLElement;
  titleEl.title = title;
  titleEl.textContent = title;

  const selects = content.querySelectorAll('.mv-source-select');
  const s1 = selects[0] as HTMLSelectElement;
  s1.dataset.slot = String(i);
  match.sources.forEach(src => {
    const opt = document.createElement('option');
    opt.value = src.source; opt.textContent = src.source; opt.selected = src.source === slot.sourceName;
    s1.appendChild(opt);
  });

  const s2 = selects[1] as HTMLSelectElement;
  s2.dataset.slot = String(i);
  (slot.streams || []).forEach((str, sIdx) => {
    const opt = document.createElement('option');
    opt.value = String(sIdx); opt.textContent = `Stream ${str.streamNo || sIdx + 1} (${str.language || 'EN'}) ${str.hd ? 'HD' : 'SD'}`;
    opt.selected = sIdx === slot.streamIndex;
    s2.appendChild(opt);
  });

  content.querySelectorAll('.mv-control-btn').forEach(b => { (b as HTMLElement).dataset.slot = String(i); });
  frag.appendChild(content);

  return frag;
}

// ── Bind child events on a slot ──

export function bindSlotChildEvents(slotEl: HTMLDivElement, i: number, isFilled: boolean): void {
  if (isFilled) {
    const header = slotEl.querySelector('.mv-slot-header');
    if (header) {
      header.addEventListener('click', e => {
        e.stopPropagation();
      });
    }
    slotEl.querySelectorAll('.mv-source-select').forEach(select => {
      select.addEventListener('change', e => {
        e.stopPropagation();
        const sel = select as HTMLSelectElement;
        const action = sel.dataset.action;
        if (action === 'change-source') {
          import('./slots').then(m => m.changeSlotSource(i, sel.value));
        } else if (action === 'change-stream') {
          import('./slots').then(m => m.changeSlotStreamIndex(i, parseInt(sel.value)));
        }
      });
    });
    slotEl.querySelectorAll('.mv-control-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const action = (btn as HTMLElement).dataset.action;
        if (action === 'fullscreen') {
          import('./slots').then(m => m.fullscreenMultiviewSlot(i));
        } else if (action === 'clear-slot') {
          import('./slots').then(m => m.clearMultiviewSlot(i));
        }
      });
    });
  } else {
    const addBtn = slotEl.querySelector('.mv-slot-add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', e => {
        e.stopPropagation();
        import('./modal').then(m => m.openMvModal(i));
      });
    }
  }
}

// ── Main grid render ──

export function renderMultiviewGrid(): void {
  const container = el('multiview-grid-container')!;
  if (!container) return;

  container.className = 'multiview-grid-container';
  container.classList.add(`layout-${state.multiviewLayout}`);

  const numSlots = getNumSlotsForLayout(state.multiviewLayout);
  container.innerHTML = '';

  for (let i = 0; i < numSlots; i++) {
    const slot = state.multiviewSlots[i];
    const slotEl = document.createElement('div');
    slotEl.className = 'mv-slot';
    slotEl.dataset.index = String(i);
    if (i === state.multiviewActiveSlot) {
      slotEl.classList.add('active-target');
    }

    attachSlotEvents(slotEl, i);

    if (!slot) {
      slotEl.classList.add('empty');
      slotEl.innerHTML = buildEmptySlotContent(i);
    } else {
      slotEl.innerHTML = '';
      slotEl.appendChild(buildFilledSlotContent(slot, i));
    }

    bindSlotChildEvents(slotEl, i, !!slot);

    container.appendChild(slotEl);
  }

  container.querySelectorAll<HTMLIFrameElement>('.mv-iframe[data-embed-url]').forEach(iframe => {
    const url = iframe.dataset.embedUrl;
    if (url) applySandboxedSrcdoc(iframe, url);
  });
}

// ── Show multiview ──

export function showMultiview(): void {
  document.body.classList.add('multiview-active');
  el('home-view')?.classList.add('hidden');
  el('player-view')?.classList.add('hidden');
  el('multiview-view')?.classList.remove('hidden');

  const mainIframe = el('stream-iframe') as HTMLIFrameElement;
  if (mainIframe) clearSandboxedSrcdoc(mainIframe);

  import('../ui').then(m => m.setActiveNav(el('nav-multiview')));

  renderMultiviewGrid();
  renderMultiviewSidebar();

  window.scrollTo({ top: 0, behavior: 'smooth' });

  // If matches haven't loaded yet, fetch them and refresh all views
  if (!state.allMatches || state.allMatches.length === 0) {
    import('../api').then(m => m.loadMatches().then(() => {
      import('../filters').then(f => f.applyFilters());
      applyMultiviewSidebarFilters();
    }));
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
  import('./slots').then(m => m.saveMultiviewState());
}
