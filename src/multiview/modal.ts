import { state } from '../state';
import { el, filterMatchesWithSources, filterMatchesBySearch, filterMatchesBySport } from '../helpers';
import { capitalize, getSportEmoji, isEPLMatch } from '../format';
import { loadStreams } from '../api';
import { loadMultiviewSlotStream } from './slots';

// ── Modal lifecycle ──

let previousActiveElement: HTMLElement | null = null;

export function openMvModal(slotIndex: number): void {
  previousActiveElement = document.activeElement as HTMLElement | null;
  state.mvModalActiveSlot = slotIndex;
  state.mvModalSearchQuery = '';
  state.mvModalSportFilter = 'all';

  const input = el('mv-modal-search') as HTMLInputElement;
  if (input) input.value = '';
  el('mv-modal')?.classList.remove('hidden');

  showMvModalMatchesView();
  renderMvModalSports();
  filterMvModalMatches('');

  if (input) input.focus();
}

export function closeMvModal(): void {
  el('mv-modal')?.classList.add('hidden');
  state.mvModalActiveSlot = null;
  if (previousActiveElement) {
    previousActiveElement.focus();
    previousActiveElement = null;
  }
}

export function showMvModalMatchesView(): void {
  el('mv-modal-matches-view')?.classList.remove('hidden');
  el('mv-modal-streams-view')?.classList.add('hidden');
}

// ── Modal sports filter ──

function renderMvModalSports(): void {
  const container = el('mv-modal-sports');
  if (!container) return;
  container.innerHTML = '';

  // ⚡ Bolt Optimization: Batch DOM insertions using DocumentFragment to avoid layout thrashing.
  // Cache active element to eliminate O(N) querySelectorAll on every click.
  const fragment = document.createDocumentFragment();
  let activeChip: HTMLElement | null = null;

  const allChip = document.createElement('button');
  allChip.className = 'mini-sport-chip' + (state.mvModalSportFilter === 'all' ? ' active' : '');
  if (state.mvModalSportFilter === 'all') activeChip = allChip;
  allChip.textContent = 'All';
  allChip.onclick = () => {
    state.mvModalSportFilter = 'all';
    if (activeChip) activeChip.classList.remove('active');
    allChip.classList.add('active');
    activeChip = allChip;
    filterMvModalMatches(state.mvModalSearchQuery);
  };
  fragment.appendChild(allChip);

  const seen = new Set<string>();
  state.sports.forEach(sport => {
    const id = sport.id || sport.name || (sport as unknown as string);
    if (seen.has(id)) return;
    seen.add(id);
    const name = sport.name || sport.id || (sport as unknown as string);
    const chip = document.createElement('button');
    chip.className = 'mini-sport-chip' + (state.mvModalSportFilter === id ? ' active' : '');
    if (state.mvModalSportFilter === id) activeChip = chip;
    chip.textContent = capitalize(name);
    chip.onclick = () => {
      state.mvModalSportFilter = id;
      if (activeChip) activeChip.classList.remove('active');
      chip.classList.add('active');
      activeChip = chip;
      filterMvModalMatches(state.mvModalSearchQuery);
    };
    fragment.appendChild(chip);
  });

  container.appendChild(fragment);
}

// ── Modal match filtering ──

export function filterMvModalMatches(query: string): void {
  state.mvModalSearchQuery = query.toLowerCase().trim();
  const container = el('mv-modal-matches');
  if (!container) return;

  let matches = filterMatchesWithSources(state.allMatches);

  if (state.mvModalSearchQuery) {
    matches = filterMatchesBySearch(matches, state.mvModalSearchQuery);
  }

  if (state.mvModalSportFilter !== 'all') {
    matches = filterMatchesBySport(matches, state.mvModalSportFilter);
  }

  matches.sort((a, b) => {
    const aEpl = isEPLMatch(a);
    const bEpl = isEPLMatch(b);
    if (aEpl && !bEpl) return -1;
    if (!aEpl && bEpl) return 1;
    return 0;
  });

  if (matches.length === 0) {
    container.innerHTML =
      '<p style="color:var(--text3);font-size:0.85rem;text-align:center;padding:20px 0;">No matches found</p>';
    return;
  }

  container.innerHTML = '';
  const frag = document.createDocumentFragment();
  matches.forEach(match => {
    const title =
      match.title || (match.teams ? `${match.teams.home?.name ?? ''} vs ${match.teams.away?.name ?? ''}` : 'Match');

    const item = document.createElement('div');
    item.className = 'mv-modal-match-item';
    item.setAttribute('role', 'button');
    item.tabIndex = 0;
    item.setAttribute('aria-label', `Select ${title}`);
    item.dataset.matchId = match.id;

    const info = document.createElement('div');
    info.className = 'mv-modal-match-info';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'mv-modal-match-title';
    titleSpan.textContent = title;

    const sportSpan = document.createElement('span');
    sportSpan.className = 'mv-modal-match-sport';
    sportSpan.textContent = `${getSportEmoji(match.category)} ${capitalize(match.category)}`;

    info.appendChild(titleSpan);
    info.appendChild(sportSpan);

    const arrow = document.createElement('div');
    arrow.className = 'mv-modal-match-arrow';
    arrow.innerHTML = '&rarr;';

    item.appendChild(info);
    item.appendChild(arrow);
    frag.appendChild(item);
  });
  container.appendChild(frag);

  if (!container.dataset.eventsBound) {
    // ⚡ Bolt Optimization: Use event delegation for list items to reduce DOM memory and CPU overhead.
    const clickHandler = (item: HTMLElement) => {
      selectMvModalMatch(item.dataset.matchId!);
    };

    container.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest('.mv-modal-match-item') as HTMLElement;
      if (item && container.contains(item)) {
        clickHandler(item);
      }
    });

    container.addEventListener('keydown', (e) => {
      const event = e as KeyboardEvent;
      if (event.key === 'Enter' || event.key === ' ') {
        const item = (e.target as HTMLElement).closest('.mv-modal-match-item') as HTMLElement;
        if (item && container.contains(item)) {
          event.preventDefault();
          clickHandler(item);
        }
      }
    });

    container.dataset.eventsBound = 'true';
  }
}

// ── Modal stream selection ──

export async function selectMvModalMatch(matchId: string): Promise<void> {
  const match = state.allMatches.find(m => m.id === matchId);
  if (!match) return;

  const nameEl = el('mv-modal-match-name');
  if (nameEl) nameEl.textContent =
    match.title || (match.teams ? `${match.teams.home?.name ?? ''} vs ${match.teams.away?.name ?? ''}` : 'Match');

  el('mv-modal-matches-view')?.classList.add('hidden');
  el('mv-modal-streams-view')?.classList.remove('hidden');

  const listContainer = el('mv-modal-streams-list')!;
  listContainer.innerHTML =
    '<div class="mv-streams-loading"><div class="spinner sm"></div> Loading streams...</div>';

  if (!match.sources || match.sources.length === 0) {
    listContainer.innerHTML =
      '<p style="color:var(--text3);font-size:0.85rem;">No streams available.</p>';
    return;
  }

  try {
    const src = match.sources[0];
    const streams = await loadStreams(src.source, src.id);

    if (streams.length === 0) {
      listContainer.innerHTML =
        '<p style="color:var(--text3);font-size:0.85rem;">No working streams found.</p>';
      return;
    }

    listContainer.innerHTML = '';
    const streamsFrag = document.createDocumentFragment();
    streams.forEach((stream, idx) => {
      const btn = document.createElement('button');
      btn.className = 'mv-modal-stream-btn';
      btn.dataset.matchId = match.id;
      btn.dataset.source = src.source;
      btn.dataset.streamIdx = String(idx);

      const span = document.createElement('span');
      span.textContent = `Stream ${String(stream.streamNo) || idx + 1} (${stream.language || 'English'})`;
      btn.appendChild(span);

      if (stream.hd) {
        const hdSpan = document.createElement('span');
        hdSpan.className = 'tab-hd';
        hdSpan.textContent = 'HD';
        btn.appendChild(hdSpan);
      }

      streamsFrag.appendChild(btn);
    });
    listContainer.appendChild(streamsFrag);

    if (!listContainer.dataset.eventsBound) {
      // ⚡ Bolt Optimization: Use event delegation for list items to reduce DOM memory and CPU overhead.
      listContainer.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('.mv-modal-stream-btn') as HTMLElement;
        if (btn && listContainer.contains(btn)) {
          selectMvModalStream(
            btn.dataset.matchId!,
            btn.dataset.source!,
            parseInt(btn.dataset.streamIdx!, 10)
          );
        }
      });
      listContainer.dataset.eventsBound = 'true';
    }
  } catch (e) {
    listContainer.innerHTML = '';
    const p = document.createElement('p');
    p.style.color = 'var(--live)';
    p.style.fontSize = '0.85rem';
    p.textContent = `Failed to load: ${e instanceof Error ? e.message : String(e)}`;
    listContainer.appendChild(p);
  }
}

function selectMvModalStream(matchId: string, sourceName: string, streamIndex: number): void {
  const match = state.allMatches.find(m => m.id === matchId);
  if (match && state.mvModalActiveSlot !== null) {
    loadMultiviewSlotStream(state.mvModalActiveSlot, match, sourceName, streamIndex);
    closeMvModal();
  }
}
