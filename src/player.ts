import type { APIMatch, Stream, StreamSource } from './types';
import { state } from './state';
import { el, cssUrl, applyEmbed, clearEmbed, setHostImage, log } from './helpers';
import { capitalize, formatSportLabel, getSportEmoji, isMatchLive, getPosterUrl, showToast } from './format';
import { loadStreams as fetchStreams } from './api';
import { mountPlayGate } from './adShield';
import { MAIN_PLAYER_KEY, playNativeHls, stopNativeHls } from './hlsPlayer';

// ── Module level state for caching active elements ──
let activeStreamTab: HTMLElement | null = null;

// ── Source bar active ──

export function updateSourceBarActive(idx: number): void {
  const bar = el('source-bar');
  if (!bar) return;
  const currentActive = bar.querySelector('.source-chip.active');
  if (currentActive) currentActive.classList.remove('active');
  const target = bar.children[idx + 1]; // +1 because the first child is the label span
  if (target) target.classList.add('active');
}

// ── Stream tabs ──

export function renderStreamTabs(streams: Stream[], source: string): void {
  const tabs = el('stream-tabs');
  if (!tabs) return;
  tabs.innerHTML = '';
  activeStreamTab = null;
  const fragment = document.createDocumentFragment();
  streams.forEach((stream, i) => {
    const tab = document.createElement('button');
    tab.className = 'stream-tab';

    const sourceSpan = document.createElement('span');
    sourceSpan.className = 'tab-source';
    sourceSpan.textContent = `${capitalize(stream.source || source)} #${stream.streamNo || i + 1}`;
    tab.appendChild(sourceSpan);

    const langSpan = document.createElement('span');
    langSpan.className = 'tab-lang';
    langSpan.textContent = stream.language || 'Unknown';
    tab.appendChild(langSpan);

    if (stream.hd) {
      const hdSpan = document.createElement('span');
      hdSpan.className = 'tab-hd';
      hdSpan.textContent = 'HD';
      tab.appendChild(hdSpan);
    }

    tab.onclick = () => {
      selectStream(stream, tab);
    };
    fragment.appendChild(tab);
  });
  tabs.appendChild(fragment);
}

// ── Source buttons ──

export function renderSourceButtons(sources: StreamSource[]): void {
  const bar = el('source-bar');
  if (!bar) return;
  if (!sources || sources.length <= 1) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');
  bar.innerHTML = '<span class="source-bar-label">Sources:</span>';
  const fragment = document.createDocumentFragment();
  sources.forEach((src, i) => {
    const btn = document.createElement('button');
    btn.className = 'source-chip' + (i === state.activeSourceIndex ? ' active' : '');
    btn.textContent = capitalize(src.source);
    btn.onclick = () => {
      if (i === state.activeSourceIndex) return;
      state.activeSourceIndex = i;
      updateSourceBarActive(i);
      void loadAndDisplayStreams(src.source, src.id);
    };
    fragment.appendChild(btn);
  });
  bar.appendChild(fragment);
}

// ── Stream loading request tracking ──

let streamLoadRequestId = 0;

async function loadAndDisplayStreams(source: string, id: string): Promise<void> {
  const requestId = ++streamLoadRequestId;
  const streamsLoading = el('streams-loading');
  const noStreams = el('no-streams');
  const streamTabs = el('stream-tabs');
  const streamCount = el('stream-count');

  if (streamsLoading) streamsLoading.classList.remove('hidden');
  if (noStreams) noStreams.classList.add('hidden');
  if (streamTabs) streamTabs.innerHTML = '';
  if (streamCount) streamCount.textContent = '';

  try {
    const streams = await fetchStreams(source, id);

    // Discard stale response if user navigated away
    if (requestId !== streamLoadRequestId) return;

    if (streamsLoading) streamsLoading.classList.add('hidden');
    if (streams.length === 0) {
      if (tryNextSource()) return;
      if (noStreams) {
        noStreams.classList.remove('hidden');
        const p = noStreams.querySelector('p');
        if (p) p.textContent = 'No working streams found for any source of this match.';
      }
      return;
    }
    renderStreamTabs(streams, source);
    if (streamCount) streamCount.textContent = `${streams.length} stream${streams.length > 1 ? 's' : ''}`;
    const best = streams.find(s => s.hd) || streams[0];
    if (best) {
      const idx = streams.indexOf(best);
      selectStream(best, streamTabs?.querySelectorAll('.stream-tab')[idx] as HTMLButtonElement);
    }
  } catch (err) {
    if (requestId !== streamLoadRequestId) return;
    if (streamsLoading) streamsLoading.classList.add('hidden');
    if (tryNextSource()) return;
    if (noStreams) {
      noStreams.classList.remove('hidden');
      const p = noStreams.querySelector('p');
      if (p) p.textContent = `Failed: ${err instanceof Error ? err.message : String(err)}. No other sources available.`;
    }
  }
}

// ── Select stream ──

const EMBED_LOAD_TIMEOUT_MS = 5000;

/** Live timer for the current embed's load fallback — one at a time. */
let embedLoadTimer: ReturnType<typeof setTimeout> | null = null;

function clearEmbedLoadTimer(): void {
  if (embedLoadTimer !== null) {
    clearTimeout(embedLoadTimer);
    embedLoadTimer = null;
  }
}

let loadingStageTimers: ReturnType<typeof setTimeout>[] = [];

function clearLoadingStages(): void {
  for (const t of loadingStageTimers) clearTimeout(t);
  loadingStageTimers = [];
}

function setLoadingStage(text: string): void {
  const p = el('player-loading-text');
  if (p) p.textContent = text;
}

function startLoadingStages(): void {
  clearLoadingStages();
  setLoadingStage('Opening secure stream…');
  loadingStageTimers.push(setTimeout(() => setLoadingStage('Resolving playlist…'), 2500));
  loadingStageTimers.push(setTimeout(() => setLoadingStage('Buffering…'), 8000));
  loadingStageTimers.push(
    setTimeout(() => setLoadingStage('Still working — large streams can take a moment…'), 15000),
  );
}

function playViaIframe(embedUrl: string): void {
  const iframe = el('stream-iframe') as HTMLIFrameElement | null;
  const playerLoading = el('player-loading');
  if (!iframe) return;

  iframe.classList.add('hidden');
  clearEmbedLoadTimer();
  const container = el('player-container');
  container?.querySelectorAll('.player-gate').forEach(g => g.remove());

  const reveal = () => {
    clearEmbedLoadTimer();
    clearLoadingStages();
    playerLoading?.classList.add('hidden');
    setLoadingStage('Loading stream…');
    iframe.classList.remove('hidden');
    // Gate sits above the iframe so the embed's first PopUnder gesture is ours.
    if (container) mountPlayGate(container);
  };

  iframe.onload = reveal;
  applyEmbed(iframe, embedUrl);
  embedLoadTimer = setTimeout(reveal, EMBED_LOAD_TIMEOUT_MS);
}

export function selectStream(stream: Stream, tabEl?: HTMLButtonElement): void {
  if (!stream?.embedUrl) {
    showToast('No embed URL available for this stream.', 'error');
    return;
  }
  state.selectedStream = stream;
  if (tabEl) {
    if (activeStreamTab) activeStreamTab.classList.remove('active');
    tabEl.classList.add('active');
    activeStreamTab = tabEl;
  }

  const iframe = el('stream-iframe') as HTMLIFrameElement | null;
  const playerPlaceholder = el('player-placeholder');
  const playerLoading = el('player-loading');

  if (playerPlaceholder) playerPlaceholder.classList.add('hidden');
  if (playerLoading) {
    playerLoading.classList.remove('hidden');
    startLoadingStages();
  }

  // Prefer native HLS (no iframe ads). Fall back to embed iframe + click-gate.
  stopNativeHls(MAIN_PLAYER_KEY);
  if (iframe) {
    clearEmbedLoadTimer();
    iframe.onload = null;
    clearEmbed(iframe);
    iframe.classList.add('hidden');
  }
  el('player-container')?.querySelectorAll('.player-gate').forEach(g => g.remove());

  const streamLabel = stream.streamNo ?? 1;
  const toast = `Stream ${streamLabel} — ${stream.language || 'Unknown'} ${stream.hd ? '(HD)' : '(SD)'}`;
  const video = el('stream-video') as HTMLVideoElement | null;

  void (async () => {
    const nativeOk = !!video && (await playNativeHls(stream.embedUrl, {
      key: MAIN_PLAYER_KEY,
      video,
      onReady: () => {
        el('player-container')?.querySelectorAll('.player-gate').forEach(g => g.remove());
      },
    }));
    if (state.selectedStream !== stream) return;
    if (nativeOk) {
      clearLoadingStages();
      setLoadingStage('Loading stream…');
      playerLoading?.classList.add('hidden');
      showToast(`${toast} · native`, 'success');
      return;
    }
    setLoadingStage('Starting embed player…');
    playViaIframe(stream.embedUrl);
    showToast(toast, 'success');
  })();
}

// ── Try next source ──

function tryNextSource(): boolean {
  const match = state.currentMatch;
  if (!match?.sources) return false;
  const next = state.activeSourceIndex + 1;
  if (next >= match.sources.length) return false;
  state.activeSourceIndex = next;
  updateSourceBarActive(next);
  showToast(`Trying ${capitalize(match.sources[next].source)}\u2026`, 'error');
  void loadAndDisplayStreams(match.sources[next].source, match.sources[next].id);
  return true;
}

// ── Open player ──

export function openPlayer(match: APIMatch): void {
  if (!match) return;
  state.currentMatch = match;
  state.selectedStream = null;
  state.activeSourceIndex = 0;

  document.body.classList.remove('multiview-active');
  document.body.classList.add('player-active', 'bg-paused');
  el('home-view')?.classList.add('hidden');
  el('multiview-view')?.classList.add('hidden');
  el('player-view')?.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  renderPlayerInfo(match);

  // Reset player
  stopNativeHls(MAIN_PLAYER_KEY);
  const iframe = el('stream-iframe') as HTMLIFrameElement | null;
  if (iframe) {
    clearEmbedLoadTimer();
    clearEmbed(iframe); // also nulls onload, so the about:blank load is not mistaken for the embed
    iframe.classList.add('hidden');
  }
  el('player-placeholder')?.classList.remove('hidden');
  el('player-loading')?.classList.add('hidden');
  const streamTabs = el('stream-tabs');
  if (streamTabs) streamTabs.innerHTML = '';
  const streamCount = el('stream-count');
  if (streamCount) streamCount.textContent = '';
  el('no-streams')?.classList.add('hidden');

  if (match.sources && match.sources.length > 0) {
    renderSourceButtons(match.sources);
    void loadAndDisplayStreams(match.sources[0].source, match.sources[0].id);
  } else {
    el('source-bar')?.classList.add('hidden');
    el('no-streams')?.classList.remove('hidden');
  }

  // Render related (lazy import to avoid circular deps)
  import('./related')
    .then(m => m.renderRelated(match))
    .catch(err => log('error', 'Failed to render related matches:', err));
}

// ── Player info ──

export function renderPlayerInfo(match: APIMatch): void {
  const hasTeams = !!(match.teams && (match.teams.home || match.teams.away));
  const teamsDiv = el('player-teams');
  if (!teamsDiv) return;
  const posterUrl = getPosterUrl(match);

  const posterEl = el('player-poster-bg');
  if (posterEl) {
    const finalPoster = cssUrl(posterUrl);
    posterEl.style.backgroundImage = finalPoster ? `url('${finalPoster}')` : 'none';
    posterEl.style.display = finalPoster ? '' : 'none';
  }

  if (hasTeams) {
    const h = match.teams!.home!;
    const a = match.teams!.away!;
    teamsDiv.innerHTML = '';

    const buildTeam = (team: typeof h, defName: string) => {
      const wrap = document.createElement('div');
      wrap.className = 'player-team';
      const badge = document.createElement('div');
      badge.className = 'player-badge';
      if (team?.badge) {
        const img = document.createElement('img');
        img.alt = team.name || '';
        img.loading = 'lazy';
        img.decoding = 'async';
        setHostImage(img, `/badge/${team.badge}.webp`, () => img.remove());
        badge.appendChild(img);
      }
      const name = document.createElement('span');
      name.className = 'player-team-name';
      name.textContent = team?.name || defName;
      wrap.appendChild(badge);
      wrap.appendChild(name);
      return wrap;
    };

    teamsDiv.appendChild(buildTeam(h, 'Home'));
    const vs = document.createElement('span');
    vs.className = 'player-vs';
    vs.textContent = 'VS';
    teamsDiv.appendChild(vs);
    teamsDiv.appendChild(buildTeam(a, 'Away'));
  } else {
    teamsDiv.innerHTML = '';
    const titleSpan = document.createElement('span');
    titleSpan.className = 'player-title';
    titleSpan.textContent = match.title || 'Match';
    teamsDiv.appendChild(titleSpan);
  }

  const sportBadge = el('player-sport-badge');
  if (sportBadge) {
    sportBadge.textContent = `${getSportEmoji(match.category)} ${formatSportLabel(match.category || 'Sport')}`;
  }
  const liveBadge = el('player-live-badge');
  if (liveBadge) {
    const live = isMatchLive(match);
    liveBadge.style.display = live ? '' : 'none';
  }
}
