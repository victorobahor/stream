import { state } from '../state';
import {
  el,
  bindListDelegation,
  filterMatchesWithSources,
  filterMatchesBySearch,
  filterMatchesBySport,
  sortMatchesForDisplay,
  log,
} from '../helpers';
import { capitalize, formatSportLabel, getSportEmoji } from '../format';
import { renderSportChips, ALL_SPORTS } from '../chips';
import { loadStreams, getMatchById } from '../api';
import { loadMultiviewSlotStream } from './slots';

// ── Modal lifecycle ──

let previousActiveElement: HTMLElement | null = null;

/** Newest stream-list request; older responses are discarded. */
let streamsRequestId = 0;

export function openMvModal(slotIndex: number): void {
  previousActiveElement = document.activeElement as HTMLElement | null;
  state.mvModalActiveSlot = slotIndex;
  state.mvModalSearchQuery = '';
  state.mvModalSportFilter = ALL_SPORTS;

  const input = el('mv-modal-search') as HTMLInputElement | null;
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
  // Abandon any stream list still in flight so it cannot render into a
  // reopened modal showing a different match.
  streamsRequestId++;
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
  renderSportChips(el('mv-modal-sports'), {
    chipClass: 'mini-sport-chip',
    allLabel: 'All',
    activeId: state.mvModalSportFilter,
    onSelect: id => {
      state.mvModalSportFilter = id;
      filterMvModalMatches(state.mvModalSearchQuery);
    },
  });
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

  if (state.mvModalSportFilter !== ALL_SPORTS) {
    matches = filterMatchesBySport(matches, state.mvModalSportFilter);
  }

  matches = sortMatchesForDisplay(matches);

  if (matches.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'mv-modal-empty';
    empty.textContent = 'No matches found';
    container.replaceChildren(empty);
    return;
  }

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
    sportSpan.textContent = `${getSportEmoji(match.category)} ${formatSportLabel(match.category)}`;

    info.appendChild(titleSpan);
    info.appendChild(sportSpan);

    const arrow = document.createElement('div');
    arrow.className = 'mv-modal-match-arrow';
    arrow.textContent = '→';

    item.appendChild(info);
    item.appendChild(arrow);
    frag.appendChild(item);
  });
  container.replaceChildren(frag);

  bindListDelegation(container, '.mv-modal-match-item', item => {
    void selectMvModalMatch(item.dataset.matchId!);
  });
}

// ── Modal stream selection ──

function setStreamsMessage(container: HTMLElement, text: string, isError = false): void {
  const p = document.createElement('p');
  p.className = isError ? 'mv-modal-streams-error' : 'mv-modal-empty';
  p.textContent = text;
  container.replaceChildren(p);
}

export async function selectMvModalMatch(matchId: string): Promise<void> {
  const match = getMatchById(matchId);
  if (!match) return;

  const requestId = ++streamsRequestId;

  const nameEl = el('mv-modal-match-name');
  if (nameEl) nameEl.textContent =
    match.title || (match.teams ? `${match.teams.home?.name ?? ''} vs ${match.teams.away?.name ?? ''}` : 'Match');

  el('mv-modal-matches-view')?.classList.add('hidden');
  el('mv-modal-streams-view')?.classList.remove('hidden');

  const listContainer = el('mv-modal-streams-list');
  if (!listContainer) return;

  const loading = document.createElement('div');
  loading.className = 'mv-streams-loading';
  const spinner = document.createElement('div');
  spinner.className = 'spinner sm';
  loading.append(spinner, ' Loading streams…');
  listContainer.replaceChildren(loading);

  if (!match.sources || match.sources.length === 0) {
    setStreamsMessage(listContainer, 'No streams available.');
    return;
  }

  try {
    let workingSource = match.sources[0];
    let streams: Awaited<ReturnType<typeof loadStreams>> = [];
    let lastError: unknown = null;

    for (const src of match.sources) {
      try {
        streams = await loadStreams(src.source, src.id);
        if (requestId !== streamsRequestId) return;
        if (streams.length > 0) {
          workingSource = src;
          break;
        }
      } catch (e) {
        lastError = e;
        if (requestId !== streamsRequestId) return;
      }
    }

    if (requestId !== streamsRequestId) return;

    if (streams.length === 0) {
      if (lastError) {
        setStreamsMessage(
          listContainer,
          `Failed to load: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
          true,
        );
      } else {
        setStreamsMessage(listContainer, 'No working streams found.');
      }
      return;
    }

    const streamsFrag = document.createDocumentFragment();
    streams.forEach((stream, idx) => {
      const btn = document.createElement('button');
      btn.className = 'mv-modal-stream-btn';
      btn.dataset.matchId = match.id;
      btn.dataset.source = workingSource.source;
      btn.dataset.streamIdx = String(idx);

      const span = document.createElement('span');
      span.textContent = `Stream ${stream.streamNo ?? idx + 1} (${stream.language || 'English'})`;
      btn.appendChild(span);

      if (stream.hd) {
        const hdSpan = document.createElement('span');
        hdSpan.className = 'tab-hd';
        hdSpan.textContent = 'HD';
        btn.appendChild(hdSpan);
      }

      streamsFrag.appendChild(btn);
    });
    listContainer.replaceChildren(streamsFrag);

    bindListDelegation(listContainer, '.mv-modal-stream-btn', btn => {
      selectMvModalStream(
        btn.dataset.matchId!,
        btn.dataset.source!,
        parseInt(btn.dataset.streamIdx!, 10)
      );
    });
  } catch (e) {
    if (requestId !== streamsRequestId) return;
    log('error', 'Failed to load streams for modal:', e);
    setStreamsMessage(
      listContainer,
      `Failed to load: ${e instanceof Error ? e.message : String(e)}`,
      true
    );
  }
}

function selectMvModalStream(matchId: string, sourceName: string, streamIndex: number): void {
  const match = getMatchById(matchId);
  if (match && state.mvModalActiveSlot !== null) {
    void loadMultiviewSlotStream(state.mvModalActiveSlot, match, sourceName, streamIndex);
    closeMvModal();
  }
}
