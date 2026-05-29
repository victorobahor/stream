import type { APIMatch, MultiviewSlot, MultiviewLayout, SavedMultiviewState, SavedSlotData } from '../types';
import { state } from '../state';
import { el, log, sanitizeUrl } from '../helpers';
import { showToast } from '../format';
import { fetchJSON } from '../api';
import { renderMultiviewGrid, getNumSlotsForLayout } from './grid';

const VALID_LAYOUTS: MultiviewLayout[] = ['1x2', '2x2'];

function isValidLayout(layout: unknown): layout is MultiviewLayout {
  return typeof layout === 'string' && VALID_LAYOUTS.includes(layout as MultiviewLayout);
}

function isValidSlotData(slot: unknown): slot is SavedSlotData {
  if (!slot || typeof slot !== 'object') return false;
  const s = slot as Record<string, unknown>;
  return (
    typeof s.matchId === 'string' &&
    s.matchId.length > 0 &&
    typeof s.sourceName === 'string' &&
    s.sourceName.length > 0 &&
    typeof s.streamIndex === 'number' &&
    s.streamIndex >= 0
  );
}

function isValidSavedState(data: unknown): data is SavedMultiviewState {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  if (!isValidLayout(d.layout)) return false;
  if (!Array.isArray(d.slots)) return false;
  return d.slots.every((s: unknown) => s === null || isValidSlotData(s));
}

// ── Match stream loading into active slot ──

export function loadMatchStreamsIntoActiveSlot(matchId: string): void {
  const match = state.allMatches.find(m => m.id === matchId);
  if (!match) return;

  let targetSlot = state.multiviewActiveSlot;
  const numSlots = getNumSlotsForLayout(state.multiviewLayout);
  if (targetSlot >= numSlots) {
    targetSlot = 0;
  }

  const slots = state.multiviewSlots;
  for (let i = 0; i < numSlots; i++) {
    if (slots[i] === null) {
      targetSlot = i;
      break;
    }
  }

  state.multiviewActiveSlot = targetSlot;

  if (match.sources && match.sources.length > 0) {
    loadMultiviewSlotStream(targetSlot, match, match.sources[0].source, 0);
  } else {
    showToast('No sources available for this match.', 'error');
  }
}

// ── Load stream into a slot ──

export async function loadMultiviewSlotStream(
  slotIndex: number,
  match: APIMatch,
  sourceName: string,
  streamIndex: number = 0
): Promise<void> {
  if (!match || !match.sources || match.sources.length === 0) {
    showToast(`No sources found for ${match?.title || 'match'}.`, 'error');
    return;
  }

  state.multiviewSlots[slotIndex] = {
    match,
    sourceName,
    streamIndex,
    loading: true,
    streams: [],
  };

  renderMultiviewGrid();

  const sourceObj = match.sources.find(s => s.source === sourceName) || match.sources[0];
  const activeSource = sourceObj.source;
  const activeId = sourceObj.id;

  try {
    const data = await fetchJSON<import('../types').Stream[]>(`/api/stream/${activeSource}/${activeId}`);
    const streams = Array.isArray(data) ? data : [];
    if (streams.length === 0) {
      const nextSourceIdx = match.sources.findIndex(s => s.source === activeSource) + 1;
      if (nextSourceIdx < match.sources.length) {
        showToast(`Source ${activeSource} failed, trying ${match.sources[nextSourceIdx].source}...`, 'info');
        loadMultiviewSlotStream(slotIndex, match, match.sources[nextSourceIdx].source, 0);
      } else {
        state.multiviewSlots[slotIndex] = null;
        renderMultiviewGrid();
        showToast(`No working streams found for ${match.title || 'match'}.`, 'error');
      }
      return;
    }

    const selectedStream = streams[streamIndex] || streams[0];
    state.multiviewSlots[slotIndex] = {
      match,
      sourceName: activeSource,
      streamIndex: streams.indexOf(selectedStream),
      stream: selectedStream,
      streams,
      loading: false,
    };

    renderMultiviewGrid();
    saveMultiviewState();
  } catch (err) {
    log('error', `Failed loading streams for slot ${slotIndex}:`, err);
    const nextSourceIdx = match.sources.findIndex(s => s.source === activeSource) + 1;
    if (nextSourceIdx < match.sources.length) {
      loadMultiviewSlotStream(slotIndex, match, match.sources[nextSourceIdx].source, 0);
    } else {
      state.multiviewSlots[slotIndex] = null;
      renderMultiviewGrid();
      showToast(`Error loading stream: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }
}

// ── Slot source/stream change ──

export function changeSlotSource(slotIndex: number, sourceName: string): void {
  const slot = state.multiviewSlots[slotIndex];
  if (!slot) return;
  loadMultiviewSlotStream(slotIndex, slot.match, sourceName, 0);
}

export function changeSlotStreamIndex(slotIndex: number, streamIndex: number): void {
  const slot = state.multiviewSlots[slotIndex];
  if (!slot || !slot.streams) return;
  const selectedStream = slot.streams[streamIndex];
  if (!selectedStream) return;

  slot.streamIndex = streamIndex;
  slot.stream = selectedStream;

  const iframe = document.querySelector(
    `.mv-slot[data-index="${slotIndex}"] .mv-iframe`
  ) as HTMLIFrameElement | null;
  if (iframe) {
    const spinner = document.querySelector(`.mv-slot[data-index="${slotIndex}"] .mv-loading`);
    if (spinner) spinner.classList.remove('hidden');
    iframe.classList.add('hidden');
    iframe.onload = () => {
      if (spinner) spinner.classList.add('hidden');
      iframe.classList.remove('hidden');
    };
    iframe.src = sanitizeUrl(selectedStream.embedUrl);
  }

  saveMultiviewState();
}

// ── Fullscreen ──

export function fullscreenMultiviewSlot(slotIndex: number): void {
  const slotEl = document.querySelector(`.mv-slot[data-index="${slotIndex}"]`) as HTMLElement & {
    requestFullscreen?: () => void;
    webkitRequestFullscreen?: () => void;
    msRequestFullscreen?: () => void;
  };
  if (!slotEl) return;
  if (slotEl.requestFullscreen) {
    slotEl.requestFullscreen();
  } else if (slotEl.webkitRequestFullscreen) {
    slotEl.webkitRequestFullscreen();
  } else if (slotEl.msRequestFullscreen) {
    slotEl.msRequestFullscreen();
  }
}

// ── Sidebar toggle ──

export function toggleMultiviewSidebar(): void {
  state.multiviewSidebarOpen = !state.multiviewSidebarOpen;
  const sidebar = el('multiview-sidebar');
  if (sidebar) {
    sidebar.classList.toggle('collapsed', !state.multiviewSidebarOpen);
  }
  const toggleBtn = el('toggle-multiview-sidebar');
  if (toggleBtn) {
    toggleBtn.classList.toggle('active', state.multiviewSidebarOpen);
  }
}

// ── Clear slots ──

export function clearAllMultiviewSlots(): void {
  state.multiviewSlots = [null, null, null, null];
  renderMultiviewGrid();
  saveMultiviewState();
  showToast('All slots cleared.', 'info');
}

export function clearMultiviewSlot(slotIndex: number): void {
  state.multiviewSlots[slotIndex] = null;
  renderMultiviewGrid();
  saveMultiviewState();
}

// ── Persistence ──

export function saveMultiviewState(): void {
  try {
    const slotsData = state.multiviewSlots.map(s => {
      if (!s) return null;
      return {
        matchId: s.match.id,
        sourceName: s.sourceName,
        streamIndex: s.streamIndex,
      };
    });

    const data = {
      layout: state.multiviewLayout,
      slots: slotsData,
    };

    localStorage.setItem('streamzone_multiview', JSON.stringify(data));
  } catch (e) {
    log('warn', 'Failed to save multiview state:', e);
  }
}

export function loadMultiviewState(): void {
  try {
    const saved = localStorage.getItem('streamzone_multiview');
    if (!saved) return;
    const data = JSON.parse(saved);
    if (!isValidSavedState(data)) {
      log('warn', 'Invalid multiview state in localStorage, ignoring');
      return;
    }
    if (data.layout) {
      state.multiviewLayout = data.layout;
      document.querySelectorAll('.layout-btn').forEach(btn => {
        btn.classList.toggle('active', (btn as HTMLElement).dataset.layout === data.layout);
      });
    }
    if (data.slots && Array.isArray(data.slots)) {
      data.slots.forEach((s: SavedSlotData | null, idx: number) => {
        if (s && s.matchId) {
          const match = state.allMatches.find(m => m.id === s.matchId);
          if (match) {
            loadMultiviewSlotStream(idx, match, s.sourceName, s.streamIndex);
          }
        }
      });
    }
  } catch (e) {
    log('warn', 'Failed to load multiview state:', e);
  }
}
