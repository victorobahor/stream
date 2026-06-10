import type { MultiviewLayout, MultiviewSlot } from '../types';
import { state } from '../state';
import { el, escapeHtml, buildSandboxedSrcdocAttr } from '../helpers';
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
    <button class="mv-slot-add-btn" data-slot="${i}">Add Stream</button>
  `;
}

export function buildFilledSlotContent(slot: MultiviewSlot, i: number): string {
  const match = slot.match;
  const title = match.teams
    ? `${escapeHtml(match.teams.home?.name ?? '')} vs ${escapeHtml(match.teams.away?.name ?? '')}`
    : escapeHtml(match.title);
  const sourceName = slot.sourceName;
  const streamIndex = slot.streamIndex;
  const streams = slot.streams || [];
  const stream = slot.stream;
  const loading = slot.loading;

  let iframeHtml = '';
  if (stream && stream.embedUrl && !loading) {
    const srcdoc = buildSandboxedSrcdocAttr(stream.embedUrl);
    iframeHtml = `<iframe class="mv-iframe" allowfullscreen allow="autoplay; encrypted-media; picture-in-picture" frameborder="0" scrolling="no" referrerpolicy="no-referrer" srcdoc="${srcdoc}"></iframe>`;
  }

  let loadingHtml = '';
  if (loading) {
    loadingHtml = `
      <div class="mv-loading">
        <div class="spinner"></div>
        <span>Loading stream...</span>
      </div>
    `;
  }

  const sourceOptions = match.sources
    .map(
      src =>
        `<option value="${escapeHtml(src.source)}" ${src.source === sourceName ? 'selected' : ''}>${escapeHtml(src.source)}</option>`
    )
    .join('');

  const streamOptions = streams
    .map(
      (str, sIdx) =>
        `<option value="${sIdx}" ${sIdx === streamIndex ? 'selected' : ''}>Stream ${escapeHtml(String(str.streamNo)) || sIdx + 1} (${escapeHtml(str.language || 'EN')}) ${str.hd ? 'HD' : 'SD'}</option>`
    )
    .join('');

  return `
    ${iframeHtml}
    ${loadingHtml}
    <div class="mv-slot-header">
      <div class="mv-slot-title" title="${title}">${title}</div>
      <div class="mv-slot-controls">
        <select class="mv-source-select" data-slot="${i}" data-action="change-source" aria-label="Select stream source">
          ${sourceOptions}
        </select>
        <select class="mv-source-select" data-slot="${i}" data-action="change-stream" aria-label="Select stream quality">
          ${streamOptions}
        </select>
        <button class="mv-control-btn" aria-label="Fullscreen stream" data-slot="${i}" data-action="fullscreen" title="Fullscreen">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
        </button>
        <button class="mv-control-btn close-btn" aria-label="Close stream" data-slot="${i}" data-action="clear-slot" title="Close Stream">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
  `;
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
      slotEl.innerHTML = buildFilledSlotContent(slot, i);
    }

    bindSlotChildEvents(slotEl, i, !!slot);

    container.appendChild(slotEl);
  }
}

// ── Show multiview ──

export function showMultiview(): void {
  document.body.classList.add('multiview-active');
  el('home-view')?.classList.add('hidden');
  el('player-view')?.classList.add('hidden');
  el('multiview-view')?.classList.remove('hidden');

  const mainIframe = el('stream-iframe') as HTMLIFrameElement;
  if (mainIframe) mainIframe.src = '';

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
