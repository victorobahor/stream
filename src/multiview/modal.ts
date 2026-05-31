import type { Stream } from '../types';
import { state } from '../state';
import { el, escapeHtml, filterMatchesWithSources, filterMatchesBySearch, filterMatchesBySport } from '../helpers';
import { capitalize, getSportEmoji, isEPLMatch } from '../format';
import { fetchJSON } from '../api';
import { loadMultiviewSlotStream } from './slots';

// ── Modal lifecycle ──

export function openMvModal(slotIndex: number): void {
  state.mvModalActiveSlot = slotIndex;
  state.mvModalSearchQuery = '';
  state.mvModalSportFilter = 'all';

  const input = el('mv-modal-search') as HTMLInputElement;
  if (input) input.value = '';
  el('mv-modal')?.classList.remove('hidden');

  showMvModalMatchesView();
  renderMvModalSports();
  filterMvModalMatches('');
}

export function closeMvModal(): void {
  el('mv-modal')?.classList.add('hidden');
  state.mvModalActiveSlot = null;
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

  const allChip = document.createElement('button');
  allChip.className = 'mini-sport-chip' + (state.mvModalSportFilter === 'all' ? ' active' : '');
  allChip.textContent = 'All';
  allChip.onclick = () => {
    state.mvModalSportFilter = 'all';
    container.querySelectorAll('.mini-sport-chip').forEach(c => c.classList.remove('active'));
    allChip.classList.add('active');
    filterMvModalMatches(state.mvModalSearchQuery);
  };
  container.appendChild(allChip);

  const seen = new Set<string>();
  state.sports.forEach(sport => {
    const id = sport.id || sport.name || (sport as unknown as string);
    if (seen.has(id)) return;
    seen.add(id);
    const name = sport.name || sport.id || (sport as unknown as string);
    const chip = document.createElement('button');
    chip.className = 'mini-sport-chip' + (state.mvModalSportFilter === id ? ' active' : '');
    chip.textContent = capitalize(name);
    chip.onclick = () => {
      state.mvModalSportFilter = id;
      container.querySelectorAll('.mini-sport-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      filterMvModalMatches(state.mvModalSearchQuery);
    };
    container.appendChild(chip);
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

  container.innerHTML = matches
    .map(match => {
      const title =
        match.title || (match.teams ? `${match.teams!.home!.name} vs ${match.teams!.away!.name}` : 'Match');
      return `
      <div class="mv-modal-match-item" role="button" tabindex="0" data-match-id="${escapeHtml(match.id)}">
        <div class="mv-modal-match-info">
          <span class="mv-modal-match-title">${escapeHtml(title)}</span>
          <span class="mv-modal-match-sport">${getSportEmoji(match.category)} ${escapeHtml(capitalize(match.category))}</span>
        </div>
        <div class="mv-modal-match-arrow">&rarr;</div>
      </div>
    `;
    })
    .join('');

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

  el('mv-modal-match-name')!.textContent =
    match.title || (match.teams ? `${match.teams.home!.name} vs ${match.teams.away!.name}` : 'Match');

  el('mv-modal-matches-view')!.classList.add('hidden');
  el('mv-modal-streams-view')!.classList.remove('hidden');

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
    const data = await fetchJSON<Stream[]>(`/api/stream/${src.source}/${src.id}`);
    const streams = Array.isArray(data) ? data : [];

    if (streams.length === 0) {
      listContainer.innerHTML =
        '<p style="color:var(--text3);font-size:0.85rem;">No working streams found.</p>';
      return;
    }

    listContainer.innerHTML = streams
      .map((stream, idx) => {
        return `
        <button class="mv-modal-stream-btn" data-match-id="${escapeHtml(match.id)}" data-source="${escapeHtml(src.source)}" data-stream-idx="${idx}">
          <span>Stream ${escapeHtml(String(stream.streamNo)) || idx + 1} (${escapeHtml(stream.language || 'English')})</span>
          ${stream.hd ? '<span class="tab-hd">HD</span>' : ''}
        </button>
      `;
      })
      .join('');

    if (!listContainer.dataset.eventsBound) {
      // ⚡ Bolt Optimization: Use event delegation for list items to reduce DOM memory and CPU overhead.
      listContainer.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('.mv-modal-stream-btn') as HTMLElement;
        if (btn && listContainer.contains(btn)) {
          selectMvModalStream(
            btn.dataset.matchId!,
            btn.dataset.source!,
            parseInt(btn.dataset.streamIdx!)
          );
        }
      });
      listContainer.dataset.eventsBound = 'true';
    }
  } catch (e) {
    listContainer.innerHTML = `<p style="color:var(--live);font-size:0.85rem;">Failed to load: ${escapeHtml(e instanceof Error ? e.message : String(e))}</p>`;
  }
}

function selectMvModalStream(matchId: string, sourceName: string, streamIndex: number): void {
  const match = state.allMatches.find(m => m.id === matchId);
  if (match && state.mvModalActiveSlot !== null) {
    loadMultiviewSlotStream(state.mvModalActiveSlot, match, sourceName, streamIndex);
    closeMvModal();
  }
}
