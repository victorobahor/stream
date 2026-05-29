import type { APIMatch, Stream, StreamSource } from './types';
import { state } from './state';
import { el, escapeHtml, sanitizeUrl } from './helpers';
import { capitalize, getSportEmoji, isMatchLive, getPosterUrl, showToast } from './format';
import { getImgUrl } from './state';
import { loadStreams as fetchStreams } from './api';

// ── Source bar active ──

export function updateSourceBarActive(idx: number): void {
  el('source-bar')?.querySelectorAll('.source-chip').forEach((c, i) => {
    c.classList.toggle('active', i === idx);
  });
}

// ── Stream tabs ──

export function renderStreamTabs(streams: Stream[], source: string): void {
  const tabs = el('stream-tabs');
  if (!tabs) return;
  tabs.innerHTML = '';
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
      tabs.querySelectorAll('.stream-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      selectStream(stream, tab);
    };
    tabs.appendChild(tab);
  });
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
  sources.forEach((src, i) => {
    const btn = document.createElement('button');
    btn.className = 'source-chip' + (i === state.activeSourceIndex ? ' active' : '');
    btn.textContent = capitalize(src.source);
    btn.onclick = () => {
      if (i === state.activeSourceIndex) return;
      state.activeSourceIndex = i;
      updateSourceBarActive(i);
      loadAndDisplayStreams(src.source, src.id);
    };
    bar.appendChild(btn);
  });
}

async function loadAndDisplayStreams(source: string, id: string): Promise<void> {
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

export function selectStream(stream: Stream, tabEl?: HTMLButtonElement): void {
  if (!stream?.embedUrl) {
    showToast('No embed URL available for this stream.', 'error');
    return;
  }
  state.selectedStream = stream;
  if (tabEl) {
    el('stream-tabs')?.querySelectorAll('.stream-tab').forEach(t => t.classList.remove('active'));
    tabEl.classList.add('active');
  }

  const iframe = el('stream-iframe') as HTMLIFrameElement | null;
  const playerPlaceholder = el('player-placeholder');
  const playerLoading = el('player-loading');

  if (playerPlaceholder) playerPlaceholder.classList.add('hidden');
  if (playerLoading) playerLoading.classList.remove('hidden');
  if (iframe) iframe.classList.add('hidden');

  if (iframe) {
    iframe.onload = () => {
      if (playerLoading) playerLoading.classList.add('hidden');
      iframe.classList.remove('hidden');
    };
    iframe.src = sanitizeUrl(stream.embedUrl);
  }
  showToast(
    `Stream ${escapeHtml(String(stream.streamNo)) || ''} — ${escapeHtml(stream.language) || ''} ${stream.hd ? '(HD)' : '(SD)'}`,
    'success'
  );
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
  loadAndDisplayStreams(match.sources[next].source, match.sources[next].id);
  return true;
}

// ── Open player ──

export function openPlayer(match: APIMatch): void {
  if (!match) return;
  state.currentMatch = match;
  state.selectedStream = null;
  state.activeSourceIndex = 0;

  document.body.classList.remove('multiview-active');
  el('home-view')?.classList.add('hidden');
  el('multiview-view')?.classList.add('hidden');
  el('player-view')?.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  renderPlayerInfo(match);

  // Reset player
  const iframe = el('stream-iframe') as HTMLIFrameElement | null;
  if (iframe) {
    iframe.src = '';
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
    loadAndDisplayStreams(match.sources[0].source, match.sources[0].id);
  } else {
    el('source-bar')?.classList.add('hidden');
    el('no-streams')?.classList.remove('hidden');
  }

  // Render related (lazy import to avoid circular deps)
  import('./related').then(m => m.renderRelated(match));
}

// ── Player info ──

export function renderPlayerInfo(match: APIMatch): void {
  const hasTeams = !!(match.teams && (match.teams.home || match.teams.away));
  const teamsDiv = el('player-teams');
  if (!teamsDiv) return;
  const posterUrl = getPosterUrl(match);

  const posterEl = el('player-poster-bg');
  if (posterEl) {
    const safePoster = posterUrl ? sanitizeUrl(posterUrl) : '';
    const finalPoster = safePoster.replace(/['"\\]/g, '');
    posterEl.style.backgroundImage = finalPoster ? `url('${finalPoster}')` : 'none';
    posterEl.style.display = finalPoster ? '' : 'none';
  }

  if (hasTeams) {
    const h = match.teams!.home!;
    const a = match.teams!.away!;
    const hBadge = h?.badge
      ? `<img src="${escapeHtml(getImgUrl('/badge/' + h.badge + '.webp'))}" alt="${escapeHtml(h?.name || '')}" loading="lazy">`
      : '';
    const aBadge = a?.badge
      ? `<img src="${escapeHtml(getImgUrl('/badge/' + a.badge + '.webp'))}" alt="${escapeHtml(a?.name || '')}" loading="lazy">`
      : '';
    teamsDiv.innerHTML = `
      <div class="player-team">
        <div class="player-badge">${hBadge}</div>
        <span class="player-team-name">${escapeHtml(h?.name || 'Home')}</span>
      </div>
      <span class="player-vs">VS</span>
      <div class="player-team">
        <div class="player-badge">${aBadge}</div>
        <span class="player-team-name">${escapeHtml(a?.name || 'Away')}</span>
      </div>`;
  } else {
    teamsDiv.innerHTML = '';
    const titleSpan = document.createElement('span');
    titleSpan.className = 'player-title';
    titleSpan.textContent = match.title || 'Match';
    teamsDiv.appendChild(titleSpan);
  }

  const sportBadge = el('player-sport-badge');
  if (sportBadge) sportBadge.textContent = `${getSportEmoji(match.category)} ${capitalize(match.category || 'Sport')}`;
  const liveBadge = el('player-live-badge');
  if (liveBadge) {
    const live = isMatchLive(match);
    liveBadge.style.display = live ? '' : 'none';
  }
}
