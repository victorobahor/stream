import type { APIMatch, MultiviewLayout, SavedMultiviewState, SavedSlotData } from '../types';
import { state } from '../state';
import { el, log } from '../helpers';
import { showToast } from '../format';
import { loadStreams, getMatchById, fetchJSON } from '../api';
import { renderMultiviewGrid, renderMultiviewSlot, getNumSlotsForLayout } from './grid';
import { MULTIVIEW_STORAGE_KEY } from './storageKey';

/**
 * Home/live loads only the active category, so a saved multiview match may be
 * absent from `state.allMatches` after refresh even though it still exists.
 * Probe a few broad endpoints once for any missing ids.
 */
async function lookupMatchesByIds(ids: string[]): Promise<Map<string, APIMatch>> {
  const found = new Map<string, APIMatch>();
  const want = new Set<string>();

  for (const id of ids) {
    if (!id) continue;
    const local = getMatchById(id);
    if (local) found.set(id, local);
    else want.add(id);
  }
  if (want.size === 0) return found;

  const endpoints = ['/api/matches/live', '/api/matches/all-today', '/api/matches/all'];
  await Promise.all(
    endpoints.map(async endpoint => {
      if (want.size === 0) return;
      try {
        const data = await fetchJSON<APIMatch[]>(endpoint);
        for (const match of Array.isArray(data) ? data : []) {
          if (match?.id && want.has(match.id)) {
            found.set(match.id, match);
            want.delete(match.id);
          }
        }
      } catch (e) {
        log('warn', `Multiview restore lookup failed for ${endpoint}:`, e);
      }
    }),
  );
  return found;
}

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

/**
 * Whether the user picked the active slot themselves, as opposed to it being
 * left over from the previous load. An explicit pick is always honoured.
 */
let activeSlotPickedByUser = false;

export function markActiveSlotPicked(): void {
  activeSlotPickedByUser = true;
}

export function loadMatchStreamsIntoActiveSlot(matchId: string): void {
  const match = getMatchById(matchId);
  if (!match) return;

  let targetSlot = state.multiviewActiveSlot;
  const numSlots = getNumSlotsForLayout(state.multiviewLayout);
  if (targetSlot >= numSlots) {
    targetSlot = 0;
  }

  // The active slot used to be overwritten unconditionally, so clicking a slot
  // and hitting "Load Stream" filled a different one. Now a slot the user
  // actually clicked always wins; the first-empty fallback only applies to a
  // leftover target, which keeps "load several in a row" filling the grid.
  if (!activeSlotPickedByUser && state.multiviewSlots[targetSlot] !== null) {
    const firstEmpty = state.multiviewSlots.findIndex((slot, i) => i < numSlots && slot === null);
    if (firstEmpty !== -1) targetSlot = firstEmpty;
  }
  activeSlotPickedByUser = false;

  state.multiviewActiveSlot = targetSlot;

  if (match.sources && match.sources.length > 0) {
    void loadMultiviewSlotStream(targetSlot, match, match.sources[0].source, 0);
  } else {
    showToast('No sources available for this match.', 'error');
  }
}

// ── Load stream into a slot ──

/**
 * Newest load request per slot. A slower earlier response must not overwrite
 * the stream the user has since selected.
 */
const slotRequestIds = new Map<number, number>();

function nextRequestId(slotIndex: number): number {
  const id = (slotRequestIds.get(slotIndex) ?? 0) + 1;
  slotRequestIds.set(slotIndex, id);
  return id;
}

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

  const requestId = nextRequestId(slotIndex);

  state.multiviewSlots[slotIndex] = {
    match,
    sourceName,
    streamIndex,
    loading: true,
    streams: [],
  };

  renderMultiviewSlot(slotIndex);

  const sourceObj = match.sources.find(s => s.source === sourceName) || match.sources[0];
  const activeSource = sourceObj.source;
  const activeId = sourceObj.id;

  const isStale = () => slotRequestIds.get(slotIndex) !== requestId;

  const tryNextSource = (message?: string): boolean => {
    const nextSourceIdx = match.sources.findIndex(s => s.source === activeSource) + 1;
    if (nextSourceIdx >= match.sources.length) return false;
    if (message) showToast(message, 'info');
    void loadMultiviewSlotStream(slotIndex, match, match.sources[nextSourceIdx].source, 0);
    return true;
  };

  try {
    const streams = await loadStreams(activeSource, activeId);
    if (isStale()) return;

    if (streams.length === 0) {
      if (tryNextSource(`Source ${activeSource} failed, trying the next one…`)) return;
      state.multiviewSlots[slotIndex] = null;
      renderMultiviewSlot(slotIndex);
      showToast(`No working streams found for ${match.title || 'match'}.`, 'error');
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

    renderMultiviewSlot(slotIndex);
    saveMultiviewState();
  } catch (err) {
    if (isStale()) return;
    log('error', `Failed loading streams for slot ${slotIndex}:`, err);
    if (tryNextSource()) return;
    state.multiviewSlots[slotIndex] = null;
    renderMultiviewSlot(slotIndex);
    showToast(`Error loading stream: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

// ── Slot source/stream change ──

export function changeSlotSource(slotIndex: number, sourceName: string): void {
  const slot = state.multiviewSlots[slotIndex];
  if (!slot) return;
  void loadMultiviewSlotStream(slotIndex, slot.match, sourceName, 0);
}

export function changeSlotStreamIndex(slotIndex: number, streamIndex: number): void {
  const slot = state.multiviewSlots[slotIndex];
  if (!slot || !slot.streams) return;
  const selectedStream = slot.streams[streamIndex];
  if (!selectedStream) return;

  slot.streamIndex = streamIndex;
  slot.stream = selectedStream;

  // The slot renderer swaps the iframe only because the embed URL changed, and
  // handles the loading overlay for us.
  renderMultiviewSlot(slotIndex);
  saveMultiviewState();
}

// ── Fullscreen ──

type FullscreenCapable = HTMLElement & {
  requestFullscreen?: () => Promise<void>;
  webkitRequestFullscreen?: () => void;
  msRequestFullscreen?: () => void;
};

function requestElementFullscreen(target: FullscreenCapable): void {
  const req =
    target.requestFullscreen?.() ??
    target.webkitRequestFullscreen?.() ??
    target.msRequestFullscreen?.();
  if (req && typeof (req as Promise<void>).catch === 'function') {
    void (req as Promise<void>).catch(() => {});
  }
}

function exitElementFullscreen(): void {
  const doc = document as Document & {
    webkitFullscreenElement?: Element | null;
    webkitExitFullscreen?: () => void;
    msExitFullscreen?: () => void;
  };
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => {});
    return;
  }
  if (doc.webkitFullscreenElement) {
    doc.webkitExitFullscreen?.();
  }
}

function toggleElementFullscreen(target: FullscreenCapable | null): void {
  if (!target) return;
  const doc = document as Document & { webkitFullscreenElement?: Element | null };
  const active = document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
  if (active === target) {
    exitElementFullscreen();
    return;
  }
  requestElementFullscreen(target);
}

export function fullscreenMultiviewSlot(slotIndex: number): void {
  const slotEl = document.querySelector(
    `.mv-slot[data-index="${slotIndex}"]`,
  ) as FullscreenCapable | null;
  toggleElementFullscreen(slotEl);
}

/** Expand the whole multiview grid to fill the display. */
export function fullscreenMultiviewGrid(): void {
  toggleElementFullscreen(el('multiview-grid-container') as FullscreenCapable | null);
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
  state.multiviewSlots.forEach((_, i) => {
    nextRequestId(i); // invalidate any load still in flight
    renderMultiviewSlot(i);
  });
  saveMultiviewState();
  showToast('All slots cleared.', 'info');
}

export function clearMultiviewSlot(slotIndex: number): void {
  state.multiviewSlots[slotIndex] = null;
  nextRequestId(slotIndex);
  renderMultiviewSlot(slotIndex);
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

    localStorage.setItem(MULTIVIEW_STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    log('warn', 'Failed to save multiview state:', e);
  }
}

export async function loadMultiviewState(): Promise<void> {
  try {
    const saved = localStorage.getItem(MULTIVIEW_STORAGE_KEY);
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
    // Build the slot elements up front so the restores below can paint into
    // them individually instead of rebuilding the grid once per saved slot.
    renderMultiviewGrid();
    if (!data.slots || !Array.isArray(data.slots)) return;

    const ids = data.slots
      .map(s => s?.matchId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    const matches = await lookupMatchesByIds(ids);

    let missing = 0;
    data.slots.forEach((s: SavedSlotData | null, idx: number) => {
      if (!s || !s.matchId) return;
      const match = matches.get(s.matchId);
      if (match) {
        void loadMultiviewSlotStream(idx, match, s.sourceName, s.streamIndex);
      } else {
        missing++;
        state.multiviewSlots[idx] = null;
        renderMultiviewSlot(idx);
      }
    });

    // Drop dead ids from storage quietly — do not toast on every page refresh.
    // Matches often fall out of the Live grid while still restorable via lookup;
    // only truly gone events are pruned here.
    if (missing > 0) {
      saveMultiviewState();
      log('warn', `Pruned ${missing} unavailable multiview slot(s) from saved state`);
    }
  } catch (e) {
    log('warn', 'Failed to load multiview state:', e);
  }
}
