import type { APIMatch, Stream, StreamSource } from './types';
import { state } from './state';
import { el, cssUrl, clearEmbed, setHostImage, log } from './helpers';
import { capitalize, formatSportLabel, getSportEmoji, isMatchLive, getPosterUrl, showToast } from './format';
import {
  loadStreams as fetchStreams,
  pickPreferredStream,
  invalidateStreamsCache,
  isSportsrcSource,
} from './api';
import { badgeImagePath } from './state';
import { MAIN_PLAYER_KEY, playNativeHls, stopNativeHls } from './hlsPlayer';

// ── Module level state for caching active elements ──
let activeStreamTab: HTMLElement | null = null;
/** Automatically try the remaining native streams/providers after a failure. */
let allowHlsSourceFailover = false;
let availableStreams: Stream[] = [];
const failedEmbeds = new Set<string>();

// ── Source bar active ──

export function updateSourceBarActive(idx: number): void {
  const bar = el('source-bar');
  if (!bar) return;
  bar.querySelectorAll<HTMLButtonElement>('.source-chip').forEach((chip, i) => {
    const active = i === idx;
    chip.classList.toggle('active', active);
    chip.setAttribute('aria-pressed', String(active));
  });
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
    const tabSource = isSportsrcSource(source) ? 'SportSRC' : capitalize(stream.source || source);
    sourceSpan.textContent = `${tabSource} #${stream.streamNo || i + 1}`;
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
      // Manual picks start a fresh attempt; unavailable streams never open ad pages.
      allowHlsSourceFailover = true;
      failedEmbeds.clear();
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
    btn.type = 'button';
    btn.className = 'source-chip' + (i === state.activeSourceIndex ? ' active' : '');
    btn.setAttribute('aria-pressed', String(i === state.activeSourceIndex));
    const dot = document.createElement('span');
    dot.className = 'source-chip-dot' + (isSportsrcSource(src) ? ' sportsrc' : ' streamed');
    dot.setAttribute('aria-hidden', 'true');
    btn.appendChild(dot);
    btn.appendChild(document.createTextNode(isSportsrcSource(src) ? 'SportSRC' : capitalize(src.source)));
    btn.onclick = () => {
      if (i === state.activeSourceIndex) return;
      state.activeSourceIndex = i;
      failedEmbeds.clear();
      state.selectedStream = null;
      stopNativeHls(MAIN_PLAYER_KEY);
      updateSourceBarActive(i);
      allowHlsSourceFailover = true;
      void loadAndDisplayStreams(src);
    };
    fragment.appendChild(btn);
  });
  bar.appendChild(fragment);
}

// ── Stream loading request tracking ──

let streamLoadRequestId = 0;

function playableStreams(streams: Stream[]): Stream[] {
  return streams.filter(s => !!s?.embedUrl);
}

async function loadAndDisplayStreams(src: { source: string; id: string; category?: string }): Promise<void> {
  const requestId = ++streamLoadRequestId;
  const match = state.currentMatch;
  const streamsLoading = el('streams-loading');
  const noStreams = el('no-streams');
  const streamTabs = el('stream-tabs');
  const streamCount = el('stream-count');

  if (streamsLoading) streamsLoading.classList.remove('hidden');
  if (noStreams) noStreams.classList.add('hidden');
  if (streamTabs) streamTabs.innerHTML = '';
  if (streamCount) streamCount.textContent = '';

  try {
    let streams = await fetchStreams(src.source, src.id, src.category);
    streams = playableStreams(streams);

    // Discard stale response if user navigated away
    if (requestId !== streamLoadRequestId || state.currentMatch !== match || !match) return;

    if (streamsLoading) streamsLoading.classList.add('hidden');
    if (streams.length === 0) {
      invalidateStreamsCache(src.source, src.id, src.category);
      if (tryNextSource()) return;
      if (noStreams) {
        noStreams.classList.remove('hidden');
        const p = noStreams.querySelector('p');
        if (p) p.textContent = 'No working streams found for any source of this match.';
      }
      showPlaybackError();
      return;
    }
    availableStreams = streams;
    renderStreamTabs(streams, src.source);
    if (streamCount) streamCount.textContent = `${streams.length} stream${streams.length > 1 ? 's' : ''}`;
    const best = pickPreferredStream(streams.filter(s => !failedEmbeds.has(s.embedUrl)));
    if (best) {
      const idx = streams.indexOf(best);
      allowHlsSourceFailover = true;
      selectStream(best, streamTabs?.querySelectorAll('.stream-tab')[idx] as HTMLButtonElement);
    } else if (!tryNextSource()) { showPlaybackError(); }
  } catch (err) {
    if (requestId !== streamLoadRequestId || state.currentMatch !== match || !match) return;
    if (streamsLoading) streamsLoading.classList.add('hidden');
    invalidateStreamsCache(src.source, src.id, src.category);
    if (tryNextSource()) return;
    if (noStreams) {
      noStreams.classList.remove('hidden');
      const p = noStreams.querySelector('p');
      if (p) p.textContent = `Failed: ${err instanceof Error ? err.message : String(err)}. No other sources available.`;
    }
    showPlaybackError();
  }
}

// ── Select stream ──

function showPlaybackError(): void {
  el('player-loading')?.classList.add('hidden');
  const error = el('player-placeholder');
  if (!error) return;
  error.classList.remove('hidden');
  const message = error.querySelector('p');
  if (message) message.textContent = 'No ad-free stream is available right now. Try another source or stream.';
}

export function selectStream(stream: Stream, tabEl?: HTMLButtonElement): void {
  if (!stream?.embedUrl) { showPlaybackError(); return; }
  state.selectedStream = stream;
  if (tabEl) {
    activeStreamTab?.classList.remove('active');
    tabEl.classList.add('active');
    activeStreamTab = tabEl;
  }
  stopNativeHls(MAIN_PLAYER_KEY);
  el('player-placeholder')?.classList.add('hidden');
  el('player-loading')?.classList.remove('hidden');
  const loadingText = el('player-loading-text');
  if (loadingText) loadingText.textContent = 'Connecting to stream…';
  const video = el('stream-video') as HTMLVideoElement | null;
  const match = state.currentMatch;
  const current = () => state.selectedStream === stream && state.currentMatch === match && !!match;
  const failed = () => {
    if (!current()) return;
    failedEmbeds.add(stream.embedUrl);
    const source = match?.sources[state.activeSourceIndex];
    if (source) invalidateStreamsCache(source.source, source.id, source.category);
    const next = pickPreferredStream(availableStreams.filter(s => !failedEmbeds.has(s.embedUrl)));
    if (allowHlsSourceFailover && next) {
      const idx = availableStreams.indexOf(next);
      selectStream(next, el('stream-tabs')?.querySelectorAll<HTMLButtonElement>('.stream-tab')[idx]);
      return;
    }
    if (allowHlsSourceFailover && tryNextSource()) return;
    showPlaybackError();
  };
  if (!video) { failed(); return; }
  void playNativeHls(stream.embedUrl, {
    key: MAIN_PLAYER_KEY, video,
    onReady: () => { if (current()) el('player-loading')?.classList.add('hidden'); },
    onError: failed,
  }).then(ok => { if (!ok) failed(); }).catch(failed);
}

// ── Try next source ──

function tryNextSource(): boolean {
  const match = state.currentMatch;
  if (!match?.sources) return false;
  const next = state.activeSourceIndex + 1;
  if (next >= match.sources.length) return false;
  const prev = match.sources[state.activeSourceIndex];
  if (prev) invalidateStreamsCache(prev.source, prev.id, prev.category);
  state.activeSourceIndex = next;
  updateSourceBarActive(next);
  const label = isSportsrcSource(match.sources[next].source)
    ? 'SportSRC'
    : capitalize(match.sources[next].source);
  showToast(`Stream unavailable — trying ${label}\u2026`, 'error');
  void loadAndDisplayStreams(match.sources[next]);
  return true;
}

// ── Open player ──

export function openPlayer(match: APIMatch): void {
  if (!match) return;
  state.currentMatch = match;
  state.selectedStream = null;
  failedEmbeds.clear();
  state.activeSourceIndex = 0;

  document.body.classList.remove('multiview-active');
  document.body.classList.add('player-active', 'bg-paused');
  el('home-view')?.classList.add('hidden');
  el('multiview-view')?.classList.add('hidden');
  el('player-view')?.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  document.title = `${match.title || 'Match'} — StreamZone`;

  renderPlayerInfo(match);

  // Reset player
  stopNativeHls();
  const iframe = el('stream-iframe') as HTMLIFrameElement | null;
  if (iframe) {
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
    allowHlsSourceFailover = true;
    void loadAndDisplayStreams(match.sources[0]);
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
        setHostImage(img, badgeImagePath(team.badge), () => img.remove());
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
