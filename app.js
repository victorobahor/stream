/* =====================================================
   StreamZone — JavaScript Application Logic
   API: https://streamed.pk
   ===================================================== */

const API_HOSTS = [
  'https://streamed.pk',
  'https://strmd.link'
];
let activeHostIndex = 0;

function getImgUrl(path) {
  return `${API_HOSTS[activeHostIndex]}/api/images${path}`;
}

// ===================== State =====================
let state = {
  currentCategory: 'live',
  currentSport: 'all',
  allMatches: [],
  filteredMatches: [],
  sports: [],
  searchQuery: '',
  currentMatch: null,
  selectedStream: null,
  activeSourceIndex: 0,
  liveMatchIds: new Set(),
  refreshInterval: null,

  // Multi View State
  multiviewLayout: '1x2',
  multiviewSlots: [null, null, null, null],
  multiviewActiveSlot: 0,
  multiviewSidebarOpen: true,
  multiviewSearchQuery: '',
  multiviewSportFilter: 'all',
  mvModalActiveSlot: null,
  mvModalSearchQuery: '',
  mvModalSportFilter: 'all',
};

// ===================== Helpers =====================
function el(id) { return document.getElementById(id); }

function escapeHtml(str) {
  if (!str) return '';
  const s = String(str);
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const LOG_LEVEL = 'warn';
function log(level, ...args) {
  const levels = { debug: 0, warn: 1, error: 2, none: 9 };
  if ((levels[level] || 0) >= (levels[LOG_LEVEL] || 0)) {
    const method = level === 'debug' ? 'log' : level;
    console[method](...args);
  }
}

function matchTextIncludes(match, query) {
  const t = (match.title || '').toLowerCase();
  const h = (match.teams?.home?.name || '').toLowerCase();
  const a = (match.teams?.away?.name || '').toLowerCase();
  const c = (match.category || '').toLowerCase();
  return t.includes(query) || h.includes(query) || a.includes(query) || c.includes(query);
}

function showToast(msg, type = 'info', duration = 3000) {
  const t = el('toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  setTimeout(() => { t.className = 'toast'; }, duration);
}

function formatDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = d - now;
  if (diff < 0 && diff > -18000000) return '🔴 Live now';
  if (diff >= 0 && diff < 3600000) {
    return `In ${Math.round(diff / 60000)}m`;
  }
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function isMatchLive(match) {
  if (state.liveMatchIds.has(match.id)) return true;
  if (match.date) {
    const diff = Date.now() - match.date;
    if (diff > 0 && diff < 18000000) return true;
  }
  return false;
}

const EPL_TEAMS_REGEX = /arsenal|aston villa|brentford|brighton|bournemouth|chelsea|crystal palace|everton|fulham|ipswich|leicester|liverpool|manchester city|man city|manchester united|man united|man utd|newcastle|nottingham forest|southampton|tottenham|spurs|west ham|wolves|wolverhampton|luton|burnley|sheffield united/;

function isEPLMatch(match) {
  if (match.isEPL !== undefined) return match.isEPL;
  if ((match.category || '').toLowerCase() !== 'football') {
    match.isEPL = false;
    return false;
  }
  const title = (match.title || '').toLowerCase();
  if (title.includes('premier league') || title.includes('epl')) {
    match.isEPL = true;
    return true;
  }
  const home = (match.teams?.home?.name || '').toLowerCase();
  const away = (match.teams?.away?.name || '').toLowerCase();
  match.isEPL = EPL_TEAMS_REGEX.test(home) || EPL_TEAMS_REGEX.test(away);
  return match.isEPL;
}


function getSportEmoji(sport) {
  const map = {
    football: '⚽', soccer: '⚽', basketball: '🏀', tennis: '🎾',
    baseball: '⚾', hockey: '🏒', american_football: '🏈', cricket: '🏏',
    golf: '⛳', rugby: '🏉', volleyball: '🏐', boxing: '🥊',
    mma: '🥋', ufc: '🥋', formula1: '🏎️', motorsport: '🏎️',
    cycling: '🚴', darts: '🎯', snooker: '🎱', handball: '🤾',
    swimming: '🏊', athletics: '🏃', fighting: '🥊', motor_sports: '🏎️',
    default: '🏆',
  };
  return map[(sport || '').toLowerCase().replace(/[- ]/g, '_')] || map.default;
}

function getPosterUrl(match) {
  if (match.poster) {
    let p = match.poster;
    if (p.startsWith('http://') || p.startsWith('https://')) return p;
    if (p.includes('/api/images/proxy/')) {
      p = p.replace(/^\/?api\/images\/proxy\//, '');
      p = p.replace(/^\/?api\/images\//, '');
    }
    if (p.startsWith('/api/images/') || p.startsWith('api/images/')) {
      const path = p.startsWith('/') ? p : '/' + p;
      return `${API_HOSTS[activeHostIndex]}${path}`;
    }
    return getImgUrl(`/proxy/${p}.webp`);
  }
  if (match.teams?.home?.badge && match.teams?.away?.badge) {
    return getImgUrl(`/poster/${match.teams.home.badge}/${match.teams.away.badge}.webp`);
  }
  return null;
}

// ===================== API Calls =====================
async function fetchJSON(urlPath) {
  let attempts = 0;
  while (attempts < API_HOSTS.length) {
    const host = API_HOSTS[activeHostIndex];
    const fullUrl = `${host}${urlPath}`;
    try {
      const res = await fetch(fullUrl, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      log('warn', `Host ${host} failed for ${urlPath}:`, e);
      attempts++;
      activeHostIndex = (activeHostIndex + 1) % API_HOSTS.length;
    }
  }
  throw new Error("All API mirror domains failed to respond.");
}

async function loadSports() {
  try {
    const data = await fetchJSON('/api/sports');
    state.sports = Array.isArray(data) ? data : [];
    renderSportsBar();
  } catch (e) { log('warn', 'Sports load failed:', e); }
}

async function loadMatches() {
  showSkeleton(true);
  hideError();
  const cat = state.currentCategory;
  const sport = state.currentSport;
  let endpoint;
  let clientSportFilter = false;

  if (sport !== 'all') {
    if (cat === 'popular') {
      endpoint = `/api/matches/${sport}/popular`;
    } else if (cat === 'all') {
      endpoint = `/api/matches/${sport}`;
    } else {
      // live/today: API has no sport-specific variant, filter client-side
      endpoint = cat === 'live' ? `/api/matches/live` : `/api/matches/all-today`;
      clientSportFilter = true;
    }
  } else {
    switch (cat) {
      case 'live': endpoint = `/api/matches/live`; break;
      case 'today': endpoint = `/api/matches/all-today`; break;
      case 'popular': endpoint = `/api/matches/all/popular`; break;
      default: endpoint = `/api/matches/all`; break;
    }
  }

  try {
    const data = await fetchJSON(endpoint);
    let matches = Array.isArray(data) ? data : [];

    if (cat === 'live') {
      matches.forEach(m => state.liveMatchIds.add(m.id));
    }

    if (clientSportFilter) {
      matches = matches.filter(m =>
        (m.category || '').toLowerCase() === sport.toLowerCase()
      );
    }

    state.allMatches = matches;
    applyFilters();
    if (typeof applyMultiviewSidebarFilters === 'function') {
      applyMultiviewSidebarFilters();
    }
    showSkeleton(false);
    updateSectionTitle();
  } catch (err) {
    showSkeleton(false);
    showError(`Could not load matches: ${err.message}`);
  }
}

async function loadStreams(source, id) {
  el('streams-loading').classList.remove('hidden');
  el('no-streams').classList.add('hidden');
  el('stream-tabs').innerHTML = '';
  el('stream-count').textContent = '';

  try {
    const data = await fetchJSON(`/api/stream/${source}/${id}`);
    el('streams-loading').classList.add('hidden');
    const streams = Array.isArray(data) ? data : [];
    if (streams.length === 0) {
      if (tryNextSource()) return;
      el('no-streams').classList.remove('hidden');
      el('no-streams').querySelector('p').textContent = 'No working streams found for any source of this match.';
      return;
    }
    renderStreamTabs(streams, source);
    el('stream-count').textContent = `${streams.length} stream${streams.length > 1 ? 's' : ''}`;
    const best = streams.find(s => s.hd) || streams[0];
    if (best) {
      const idx = streams.indexOf(best);
      selectStream(best, el('stream-tabs').querySelectorAll('.stream-tab')[idx]);
    }
  } catch (err) {
    el('streams-loading').classList.add('hidden');
    if (tryNextSource()) return;
    el('no-streams').classList.remove('hidden');
    el('no-streams').querySelector('p').textContent = `Failed: ${err.message}. No other sources available.`;
  }
}

function tryNextSource() {
  const match = state.currentMatch;
  if (!match?.sources) return false;
  const next = state.activeSourceIndex + 1;
  if (next >= match.sources.length) return false;
  state.activeSourceIndex = next;
  updateSourceBarActive(next);
  showToast(`Trying ${capitalize(match.sources[next].source)}…`, 'error');
  loadStreams(match.sources[next].source, match.sources[next].id);
  return true;
}

function updateSourceBarActive(idx) {
  el('source-bar')?.querySelectorAll('.source-chip').forEach((c, i) => {
    c.classList.toggle('active', i === idx);
  });
}

// ===================== Rendering =====================
function renderSportsBar() {
  const bar = el('sports-bar');
  const allChip = bar.querySelector('.sport-chip');
  bar.innerHTML = '';
  bar.appendChild(allChip);
  const seen = new Set();
  state.sports.forEach(sport => {
    const id = sport.id || sport.name || sport;
    if (seen.has(id)) return;
    seen.add(id);
    const name = sport.name || sport.id || sport;
    const chip = document.createElement('button');
    chip.className = 'sport-chip';
    chip.dataset.id = id;
    chip.textContent = `${getSportEmoji(name)} ${capitalize(name)}`;
    chip.onclick = function () { filterSport(id, this); };
    bar.appendChild(chip);
  });
}

function renderMatches(matches) {
  const grid = el('matches-grid');
  const empty = el('empty-state');
  if (!matches || matches.length === 0) {
    grid.classList.add('hidden');
    empty.classList.remove('hidden');
    el('match-count').textContent = '0 matches';
    return;
  }
  empty.classList.add('hidden');
  grid.classList.remove('hidden');
  el('match-count').textContent = `${matches.length} match${matches.length !== 1 ? 'es' : ''}`;
  grid.innerHTML = matches.map(m => buildMatchCard(m)).join('');
  grid.querySelectorAll('.match-card').forEach(card => {
    card.addEventListener('click', () => {
      const match = state.allMatches.find(m => m.id === card.dataset.id);
      if (match) openPlayer(match);
    });
  });
}

function buildCardBadges(match, live) {
  const parts = [];
  if (live) parts.push('<span class="live-badge">LIVE</span>');
  if (match.popular) parts.push('<span class="popular-badge">🔥 Hot</span>');
  if (isEPLMatch(match)) parts.push('<span class="epl-badge">🏴\uDB40\uDC67\uDB40\uDC62\uDB40\uDC65\uDB40\uDC6E\uDB40\uDC67\uDB40\uDC7F EPL</span>');
  return parts.length ? `<div style="display:flex;gap:6px">${parts.join('')}</div>` : '';
}

function buildCardPoster(posterUrl) {
  if (!posterUrl) return '';
  const safe = String(posterUrl).replace(/'/g, '');
  return `<div class="card-poster" style="background-image:url('${safe}')"></div>`;
}

function buildCardTeams(match, hasTeams, sportEmoji) {
  if (!hasTeams) {
    return `<div class="card-title">${escapeHtml(match.title || 'Match')}</div>`;
  }
  const home = match.teams.home, away = match.teams.away;
  const hImg = home?.badge
    ? `<img src="${escapeHtml(getImgUrl('/badge/' + home.badge + '.webp'))}" alt="${escapeHtml(home.name || '')}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
    : '';
  const aImg = away?.badge
    ? `<img src="${escapeHtml(getImgUrl('/badge/' + away.badge + '.webp'))}" alt="${escapeHtml(away.name || '')}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
    : '';
  return `
    <div class="card-teams">
      <div class="team">
        <div class="team-badge-wrap">${hImg}<span class="team-badge-placeholder" style="${home?.badge ? 'display:none' : ''}">${sportEmoji}</span></div>
        <span class="team-name">${escapeHtml(home?.name || 'Home')}</span>
      </div>
      <span class="vs-separator">VS</span>
      <div class="team">
        <div class="team-badge-wrap">${aImg}<span class="team-badge-placeholder" style="${away?.badge ? 'display:none' : ''}">${sportEmoji}</span></div>
        <span class="team-name">${escapeHtml(away?.name || 'Away')}</span>
      </div>
    </div>`;
}

function buildCardFooter(timestamp, srcCount) {
  const srcDots = Array.from({ length: Math.min(srcCount, 5) }, () => '<span class="source-dot"></span>').join('');
  return `
    <div class="card-footer">
      <span class="card-time">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        ${escapeHtml(timestamp)}
      </span>
      <div style="display:flex;align-items:center;gap:8px">
        <div class="card-sources" title="${srcCount} source${srcCount !== 1 ? 's' : ''}">${srcDots}</div>
        <span class="source-label">${srcCount} src</span>
      </div>
      <button class="watch-btn">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg>
        Watch
      </button>
    </div>`;
}

function buildMatchCard(match) {
  const hasTeams = match.teams && (match.teams.home || match.teams.away);
  const live = isMatchLive(match);
  const timestamp = match.date ? formatDate(match.date) : '';
  const sportEmoji = getSportEmoji(match.category);
  const posterUrl = getPosterUrl(match);
  const srcCount = (match.sources || []).length;

  return `
    <div class="match-card${posterUrl ? ' has-poster' : ''}" data-id="${escapeHtml(match.id)}" role="button" tabindex="0" aria-label="Watch ${escapeHtml(match.title || 'match')}">
      ${buildCardPoster(posterUrl)}
      <div class="card-sport-tag">
        <span class="sport-label">${sportEmoji} ${escapeHtml(capitalize(match.category || 'Sport'))}</span>
        ${buildCardBadges(match, live)}
      </div>
      ${buildCardTeams(match, hasTeams, sportEmoji)}
      ${buildCardFooter(timestamp, srcCount)}
    </div>`;
}

function renderStreamTabs(streams, source) {
  const tabs = el('stream-tabs');
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

function renderSourceButtons(sources) {
  const bar = el('source-bar');
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
      loadStreams(src.source, src.id);
    };
    bar.appendChild(btn);
  });
}

function renderRelated(currentMatch) {
  const list = el('related-list');
  // Prefer same-sport matches, then others
  const sameSport = state.allMatches.filter(m =>
    m.id !== currentMatch.id && m.category === currentMatch.category
  );
  const otherSport = state.allMatches.filter(m =>
    m.id !== currentMatch.id && m.category !== currentMatch.category
  );
  const related = [...sameSport, ...otherSport].slice(0, 12);

  if (related.length === 0) {
    list.innerHTML = '<p style="color:var(--text3);font-size:0.85rem">No other matches available</p>';
    return;
  }
  list.innerHTML = related.map(m => {
    const live = isMatchLive(m);
    const title = m.title || (m.teams ? `${m.teams?.home?.name || ''} vs ${m.teams?.away?.name || ''}` : 'Match');
    return `
      <div class="related-card" data-match-id="${escapeHtml(m.id)}">
        <div class="related-card-meta">
          <span class="related-sport">${getSportEmoji(m.category)} ${escapeHtml(capitalize(m.category))}</span>
          ${live ? '<span class="related-live"><span class="live-dot"></span> LIVE</span>' : ''}
        </div>
        <div class="related-card-title">${escapeHtml(title)}</div>
      </div>`;
  }).join('');

  list.querySelectorAll('.related-card').forEach(card => {
    card.addEventListener('click', () => {
      const match = state.allMatches.find(m => m.id === card.dataset.matchId);
      if (match) openPlayer(match);
    });
  });
}

// ===================== Player =====================
function openPlayer(match) {
  if (!match) return;
  state.currentMatch = match;
  state.selectedStream = null;
  state.activeSourceIndex = 0;

  document.body.classList.remove('multiview-active');
  el('home-view').classList.add('hidden');
  el('multiview-view').classList.add('hidden');
  el('player-view').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  renderPlayerInfo(match);
  renderRelated(match);

  // Reset player
  const iframe = el('stream-iframe');
  iframe.src = '';
  iframe.classList.add('hidden');
  el('player-placeholder').classList.remove('hidden');
  el('player-loading').classList.add('hidden');
  el('stream-tabs').innerHTML = '';
  el('stream-count').textContent = '';
  el('no-streams').classList.add('hidden');

  // Render source selector & load first source
  if (match.sources && match.sources.length > 0) {
    renderSourceButtons(match.sources);
    loadStreams(match.sources[0].source, match.sources[0].id);
  } else {
    el('source-bar').classList.add('hidden');
    el('no-streams').classList.remove('hidden');
  }
}

function renderPlayerInfo(match) {
  const hasTeams = match.teams && (match.teams.home || match.teams.away);
  const teamsDiv = el('player-teams');
  const posterUrl = getPosterUrl(match);

  // Set poster background on player container
  const posterEl = el('player-poster-bg');
  if (posterEl) {
    const safePoster = posterUrl ? String(posterUrl).replace(/'/g, '') : '';
    posterEl.style.backgroundImage = safePoster ? `url('${safePoster}')` : 'none';
    posterEl.style.display = safePoster ? '' : 'none';
  }

  if (hasTeams) {
    const h = match.teams.home, a = match.teams.away;
    const hBadge = h?.badge ? `<img src="${escapeHtml(getImgUrl('/badge/' + h.badge + '.webp'))}" alt="${escapeHtml(h?.name || '')}" loading="lazy">` : '';
    const aBadge = a?.badge ? `<img src="${escapeHtml(getImgUrl('/badge/' + a.badge + '.webp'))}" alt="${escapeHtml(a?.name || '')}" loading="lazy">` : '';
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

  el('player-sport-badge').textContent = `${getSportEmoji(match.category)} ${capitalize(match.category || 'Sport')}`;
  const live = isMatchLive(match);
  el('player-live-badge').style.display = live ? '' : 'none';
}

function selectStream(stream, tabEl) {
  if (!stream?.embedUrl) {
    showToast('No embed URL available for this stream.', 'error');
    return;
  }
  state.selectedStream = stream;
  if (tabEl) {
    el('stream-tabs').querySelectorAll('.stream-tab').forEach(t => t.classList.remove('active'));
    tabEl.classList.add('active');
  }

  const iframe = el('stream-iframe');
  el('player-placeholder').classList.add('hidden');
  el('player-loading').classList.remove('hidden');
  iframe.classList.add('hidden');

  iframe.onload = () => {
    el('player-loading').classList.add('hidden');
    iframe.classList.remove('hidden');
  };
  iframe.src = stream.embedUrl;
  showToast(`Stream ${stream.streamNo || ''} — ${stream.language || ''} ${stream.hd ? '(HD)' : '(SD)'}`, 'success');
}

// ===================== Filtering =====================
function filterCategory(cat) {
  state.currentCategory = cat;
  state.currentSport = 'all';
  state.searchQuery = '';
  el('search-input').value = '';
  document.querySelectorAll('.sport-chip').forEach(c => c.classList.remove('active'));
  document.querySelector('.sport-chip')?.classList.add('active');
  showHome();
  loadMatches();
}

function filterSport(sportId, chipEl) {
  state.currentSport = sportId;
  document.querySelectorAll('.sport-chip').forEach(c => c.classList.remove('active'));
  if (chipEl) chipEl.classList.add('active');
  loadMatches(); // server-side when possible, client-side fallback for live/today
}

function handleSearch(query) {
  state.searchQuery = query.toLowerCase().trim();
  applyFilters();
}

function applyFilters() {
  let matches = [...state.allMatches];

  // Only keep matches that have at least one stream source
  matches = matches.filter(m => m.sources && m.sources.length > 0);

  if (state.searchQuery) {
    matches = matches.filter(m => matchTextIncludes(m, state.searchQuery));
  }

  // Sort EPL football matches to the top
  matches.sort((a, b) => {
    const aEpl = isEPLMatch(a);
    const bEpl = isEPLMatch(b);
    if (aEpl && !bEpl) return -1;
    if (!aEpl && bEpl) return 1;
    return 0;
  });

  state.filteredMatches = matches;
  renderMatches(matches);
}

function updateSectionTitle() {
  const titles = { live: 'Live Matches', all: 'All Matches', today: "Today's Matches", popular: '🔥 Popular Matches' };
  let title = titles[state.currentCategory] || 'Matches';
  if (state.currentSport !== 'all') title = `${getSportEmoji(state.currentSport)} ${capitalize(state.currentSport)} — ${title}`;
  el('section-title').textContent = title;
}

// ===================== UI Utilities =====================
function showHome() {
  document.body.classList.remove('multiview-active');
  el('player-view').classList.add('hidden');
  el('multiview-view').classList.add('hidden');
  el('home-view').classList.remove('hidden');
  state.currentMatch = null;
  el('stream-iframe').src = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function showSkeleton(show) {
  el('skeleton-grid').classList.toggle('hidden', !show);
  el('matches-grid').classList.toggle('hidden', show);
  if (show) el('empty-state').classList.add('hidden');
}
function hideError() { el('error-state').classList.add('hidden'); }
function showError(msg) {
  el('error-state').classList.remove('hidden');
  el('error-msg').textContent = msg || 'Something went wrong.';
  el('matches-grid').classList.add('hidden');
  el('skeleton-grid').classList.add('hidden');
  el('empty-state').classList.add('hidden');
}
function retryLoad() { hideError(); loadMatches(); }
function setActiveNav(linkEl) {
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  if (linkEl) linkEl.classList.add('active');
}
function toggleMobileMenu() { el('mobile-nav').classList.toggle('open'); }
function closeMobileMenu() { el('mobile-nav').classList.remove('open'); }

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!el('mv-modal').classList.contains('hidden')) {
      closeMvModal();
    } else if (state.currentMatch) {
      showHome();
    }
  }
});

// ===================== Multi View Logic =====================

function showMultiview() {
  document.body.classList.add('multiview-active');
  el('home-view').classList.add('hidden');
  el('player-view').classList.add('hidden');
  el('multiview-view').classList.remove('hidden');

  // Stop main player to save bandwidth
  const mainIframe = el('stream-iframe');
  if (mainIframe) mainIframe.src = '';

  setActiveNav(el('nav-multiview'));

  renderMultiviewGrid();
  renderMultiviewSidebar();

  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Fetch matches if list is empty
  if (!state.allMatches || state.allMatches.length === 0) {
    loadMatches();
  }
}

function changeMultiviewLayout(layout) {
  state.multiviewLayout = layout;

  document.querySelectorAll('.layout-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.layout === layout);
  });

  const numSlots = getNumSlotsForLayout(layout);
  if (state.multiviewActiveSlot >= numSlots) {
    state.multiviewActiveSlot = 0;
  }

  renderMultiviewGrid();
  saveMultiviewState();
}

function getNumSlotsForLayout(layout) {
  const map = {
    '1x1': 1,
    '1x2': 2,
    '2x1': 2,
    '3': 3,
    '2x2': 4
  };
  return map[layout] || 1;
}

function clearAllMultiviewSlots() {
  state.multiviewSlots = [null, null, null, null];
  renderMultiviewGrid();
  saveMultiviewState();
  showToast('All slots cleared.', 'info');
}

function clearMultiviewSlot(slotIndex) {
  state.multiviewSlots[slotIndex] = null;
  renderMultiviewGrid();
  saveMultiviewState();
}

function toggleMultiviewSidebar() {
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

function handleMultiviewSearch(query) {
  state.multiviewSearchQuery = query.toLowerCase().trim();
  applyMultiviewSidebarFilters();
}

function applyMultiviewSidebarFilters() {
  let matches = [...state.allMatches];
  // Filter only matches with sources
  matches = matches.filter(m => m.sources && m.sources.length > 0);

  if (state.multiviewSearchQuery) {
    matches = matches.filter(m => matchTextIncludes(m, state.multiviewSearchQuery));
  }

  if (state.multiviewSportFilter !== 'all') {
    matches = matches.filter(m => (m.category || '').toLowerCase() === state.multiviewSportFilter.toLowerCase());
  }

  // Sort EPL
  matches.sort((a, b) => {
    const aEpl = isEPLMatch(a);
    const bEpl = isEPLMatch(b);
    if (aEpl && !bEpl) return -1;
    if (!aEpl && bEpl) return 1;
    return 0;
  });

  renderMultiviewSidebarList(matches);
}

function renderMultiviewSidebar() {
  const bar = el('multiview-sports-filter');
  if (!bar) return;
  bar.innerHTML = '';

  const allChip = document.createElement('button');
  allChip.className = 'mini-sport-chip' + (state.multiviewSportFilter === 'all' ? ' active' : '');
  allChip.textContent = 'All';
  allChip.onclick = () => {
    state.multiviewSportFilter = 'all';
    bar.querySelectorAll('.mini-sport-chip').forEach(c => c.classList.remove('active'));
    allChip.classList.add('active');
    applyMultiviewSidebarFilters();
  };
  bar.appendChild(allChip);

  const seen = new Set();
  state.sports.forEach(sport => {
    const id = sport.id || sport.name || sport;
    if (seen.has(id)) return;
    seen.add(id);
    const name = sport.name || sport.id || sport;
    const chip = document.createElement('button');
    chip.className = 'mini-sport-chip' + (state.multiviewSportFilter === id ? ' active' : '');
    chip.textContent = capitalize(name);
    chip.onclick = () => {
      state.multiviewSportFilter = id;
      bar.querySelectorAll('.mini-sport-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      applyMultiviewSidebarFilters();
    };
    bar.appendChild(chip);
  });

  applyMultiviewSidebarFilters();
}

function renderMultiviewSidebarList(matches) {
  const container = el('multiview-match-list');
  if (!container) return;
  if (matches.length === 0) {
    container.innerHTML = '<p style="color:var(--text3);font-size:0.75rem;text-align:center;padding:12px;">No matches found</p>';
    return;
  }

  container.innerHTML = matches.map(match => {
    const live = isMatchLive(match);
    const title = match.title || (match.teams ? `${match.teams.home.name} vs ${match.teams.away.name}` : 'Match');
    const sportEmoji = getSportEmoji(match.category);

    return `
      <div class="sidebar-match-card" draggable="true" data-id="${escapeHtml(match.id)}">
        <div class="mv-card-meta">
          <span class="mv-card-sport">${sportEmoji} ${escapeHtml(capitalize(match.category))}</span>
          ${live ? '<span class="mv-card-live"><span class="live-dot"></span> LIVE</span>' : ''}
        </div>
        <div class="mv-card-teams">${escapeHtml(title)}</div>
        <div class="sidebar-match-streams">
          <button class="mv-stream-mini-btn" data-load-match-id="${escapeHtml(match.id)}">
            Load Stream
          </button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.sidebar-match-card').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', card.dataset.id);
      card.classList.add('dragging');
      document.querySelectorAll('.mv-slot').forEach(s => s.classList.add('active-target'));
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      document.querySelectorAll('.mv-slot').forEach(s => s.classList.remove('active-target'));
    });
  });

  container.querySelectorAll('.mv-stream-mini-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      loadMatchStreamsIntoActiveSlot(btn.dataset.loadMatchId);
    });
  });
}

function loadMatchStreamsIntoActiveSlot(matchId) {
  const match = state.allMatches.find(m => m.id === matchId);
  if (!match) return;

  let targetSlot = state.multiviewActiveSlot;
  const numSlots = getNumSlotsForLayout(state.multiviewLayout);
  if (targetSlot >= numSlots) {
    targetSlot = 0;
  }

  // Load into the first empty slot if the selected slot is already occupied
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

async function loadMultiviewSlotStream(slotIndex, match, sourceName, streamIndex = 0) {
  if (!match || !match.sources || match.sources.length === 0) {
    showToast(`No sources found for ${match.title || 'match'}.`, 'error');
    return;
  }

  state.multiviewSlots[slotIndex] = {
    match,
    sourceName,
    streamIndex,
    loading: true,
    streams: []
  };

  renderMultiviewGrid();

  const sourceObj = match.sources.find(s => s.source === sourceName) || match.sources[0];
  const activeSource = sourceObj.source;
  const activeId = sourceObj.id;

  try {
    const data = await fetchJSON(`/api/stream/${activeSource}/${activeId}`);
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
      streams: streams,
      loading: false
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
      showToast(`Error loading stream: ${err.message}`, 'error');
    }
  }
}

function attachSlotEvents(slotEl, i) {
  slotEl.addEventListener('dragover', (e) => { e.preventDefault(); });
  slotEl.addEventListener('dragenter', (e) => {
    e.preventDefault();
    slotEl.classList.add('drag-over');
  });
  slotEl.addEventListener('dragleave', () => {
    slotEl.classList.remove('drag-over');
  });
  slotEl.addEventListener('drop', (e) => {
    e.preventDefault();
    slotEl.classList.remove('drag-over');
    const matchId = e.dataTransfer.getData('text/plain');
    const match = state.allMatches.find(m => m.id === matchId);
    if (match && match.sources && match.sources.length > 0) {
      loadMultiviewSlotStream(i, match, match.sources[0].source, 0);
    }
  });

  slotEl.addEventListener('click', () => {
    state.multiviewActiveSlot = i;
    document.querySelectorAll('.mv-slot').forEach((s, idx) => {
      s.classList.toggle('active-target', idx === i);
    });
  });
}

function buildEmptySlotContent(i) {
  return `
    <div class="mv-slot-num">Slot ${i + 1}</div>
    <div class="mv-slot-add-label">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Empty Slot
    </div>
    <button class="mv-slot-add-btn" data-action="open-mv-modal" data-slot="${i}">Add Stream</button>
  `;
}

function buildFilledSlotContent(slot, i) {
  const match = slot.match;
  const title = match.teams
    ? `${escapeHtml(match.teams.home.name)} vs ${escapeHtml(match.teams.away.name)}`
    : escapeHtml(match.title);
  const sourceName = slot.sourceName;
  const streamIndex = slot.streamIndex;
  const streams = slot.streams || [];
  const stream = slot.stream;
  const loading = slot.loading;

  let iframeHtml = '';
  if (stream && stream.embedUrl && !loading) {
    const escUrl = escapeHtml(stream.embedUrl);
    iframeHtml = `<iframe class="mv-iframe" src="${escUrl}" allowfullscreen allow="autoplay; encrypted-media; picture-in-picture" frameborder="0" scrolling="no" referrerpolicy="no-referrer"></iframe>`;
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

  const sourceOptions = match.sources.map(src =>
    `<option value="${escapeHtml(src.source)}" ${src.source === sourceName ? 'selected' : ''}>${escapeHtml(src.source)}</option>`
  ).join('');

  const streamOptions = streams.map((str, sIdx) =>
    `<option value="${sIdx}" ${sIdx === streamIndex ? 'selected' : ''}>Stream ${str.streamNo || sIdx + 1} (${escapeHtml(str.language || 'EN')}) ${str.hd ? 'HD' : 'SD'}</option>`
  ).join('');

  return `
    ${iframeHtml}
    ${loadingHtml}
    <div class="mv-slot-header">
      <div class="mv-slot-title" title="${title}">${title}</div>
      <div class="mv-slot-controls">
        <select class="mv-source-select" data-slot="${i}" data-action="change-source">
          ${sourceOptions}
        </select>
        <select class="mv-source-select" data-slot="${i}" data-action="change-stream">
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

function bindSlotChildEvents(slotEl, i, isFilled) {
  if (isFilled) {
    slotEl.querySelector('.mv-slot-header').addEventListener('click', (e) => {
      e.stopPropagation();
    });
    slotEl.querySelectorAll('.mv-source-select').forEach(select => {
      select.addEventListener('change', (e) => {
        e.stopPropagation();
        const action = select.dataset.action;
        if (action === 'change-source') {
          changeSlotSource(i, select.value);
        } else if (action === 'change-stream') {
          changeSlotStreamIndex(i, parseInt(select.value));
        }
      });
    });
    slotEl.querySelectorAll('.mv-control-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        if (action === 'fullscreen') {
          fullscreenMultiviewSlot(i);
        } else if (action === 'clear-slot') {
          clearMultiviewSlot(i);
        }
      });
    });
  } else {
    const addBtn = slotEl.querySelector('.mv-slot-add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openMvModal(i);
      });
    }
  }
}

function renderMultiviewGrid() {
  const container = el('multiview-grid-container');
  if (!container) return;

  container.className = 'multiview-grid-container';
  container.classList.add(`layout-${state.multiviewLayout}`);

  const numSlots = getNumSlotsForLayout(state.multiviewLayout);
  container.innerHTML = '';

  for (let i = 0; i < numSlots; i++) {
    const slot = state.multiviewSlots[i];
    const slotEl = document.createElement('div');
    slotEl.className = 'mv-slot';
    slotEl.dataset.index = i;
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

function changeSlotSource(slotIndex, sourceName) {
  const slot = state.multiviewSlots[slotIndex];
  if (!slot) return;
  loadMultiviewSlotStream(slotIndex, slot.match, sourceName, 0);
}

function changeSlotStreamIndex(slotIndex, streamIndex) {
  const slot = state.multiviewSlots[slotIndex];
  if (!slot || !slot.streams) return;
  const selectedStream = slot.streams[streamIndex];
  if (!selectedStream) return;

  slot.streamIndex = streamIndex;
  slot.stream = selectedStream;

  const iframe = document.querySelector(`.mv-slot[data-index="${slotIndex}"] .mv-iframe`);
  if (iframe) {
    const spinner = document.querySelector(`.mv-slot[data-index="${slotIndex}"] .mv-loading`);
    if (spinner) spinner.classList.remove('hidden');
    iframe.classList.add('hidden');
    iframe.onload = () => {
      if (spinner) spinner.classList.add('hidden');
      iframe.classList.remove('hidden');
    };
    iframe.src = selectedStream.embedUrl;
  }

  saveMultiviewState();
}

function fullscreenMultiviewSlot(slotIndex) {
  const slotEl = document.querySelector(`.mv-slot[data-index="${slotIndex}"]`);
  if (!slotEl) return;
  if (slotEl.requestFullscreen) {
    slotEl.requestFullscreen();
  } else if (slotEl.webkitRequestFullscreen) {
    slotEl.webkitRequestFullscreen();
  } else if (slotEl.msRequestFullscreen) {
    slotEl.msRequestFullscreen();
  }
}

function saveMultiviewState() {
  try {
    const slotsData = state.multiviewSlots.map(s => {
      if (!s) return null;
      return {
        matchId: s.match.id,
        sourceName: s.sourceName,
        streamIndex: s.streamIndex
      };
    });

    const data = {
      layout: state.multiviewLayout,
      slots: slotsData
    };

    localStorage.setItem('streamzone_multiview', JSON.stringify(data));
  } catch (e) {
    log('warn', 'Failed to save multiview state:', e);
  }
}

function loadMultiviewState() {
  try {
    const saved = localStorage.getItem('streamzone_multiview');
    if (!saved) return;
    const data = JSON.parse(saved);
    if (data.layout) {
      state.multiviewLayout = data.layout;
      document.querySelectorAll('.layout-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.layout === data.layout);
      });
    }
    if (data.slots && Array.isArray(data.slots)) {
      data.slots.forEach((s, idx) => {
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

// ===================== Mobile Selector Modal =====================

function openMvModal(slotIndex) {
  state.mvModalActiveSlot = slotIndex;
  state.mvModalSearchQuery = '';
  state.mvModalSportFilter = 'all';

  el('mv-modal-search').value = '';
  el('mv-modal').classList.remove('hidden');

  showMvModalMatchesView();
  renderMvModalSports();
  filterMvModalMatches('');
}

function closeMvModal() {
  el('mv-modal').classList.add('hidden');
  state.mvModalActiveSlot = null;
}

function showMvModalMatchesView() {
  el('mv-modal-matches-view').classList.remove('hidden');
  el('mv-modal-streams-view').classList.add('hidden');
}

function renderMvModalSports() {
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

  const seen = new Set();
  state.sports.forEach(sport => {
    const id = sport.id || sport.name || sport;
    if (seen.has(id)) return;
    seen.add(id);
    const name = sport.name || sport.id || sport;
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

function filterMvModalMatches(query) {
  state.mvModalSearchQuery = query.toLowerCase().trim();
  const container = el('mv-modal-matches');
  if (!container) return;

  let matches = state.allMatches.filter(m => m.sources && m.sources.length > 0);

  if (state.mvModalSearchQuery) {
    matches = matches.filter(m => matchTextIncludes(m, state.mvModalSearchQuery));
  }

  if (state.mvModalSportFilter !== 'all') {
    matches = matches.filter(m => (m.category || '').toLowerCase() === state.mvModalSportFilter.toLowerCase());
  }

  // Sort EPL
  matches.sort((a, b) => {
    const aEpl = isEPLMatch(a);
    const bEpl = isEPLMatch(b);
    if (aEpl && !bEpl) return -1;
    if (!aEpl && bEpl) return 1;
    return 0;
  });

  if (matches.length === 0) {
    container.innerHTML = '<p style="color:var(--text3);font-size:0.85rem;text-align:center;padding:20px 0;">No matches found</p>';
    return;
  }

  container.innerHTML = matches.map(match => {
    const title = match.title || (match.teams ? `${match.teams.home.name} vs ${match.teams.away.name}` : 'Match');
    return `
      <div class="mv-modal-match-item" data-match-id="${escapeHtml(match.id)}">
        <div class="mv-modal-match-info">
          <span class="mv-modal-match-title">${escapeHtml(title)}</span>
          <span class="mv-modal-match-sport">${getSportEmoji(match.category)} ${escapeHtml(capitalize(match.category))}</span>
        </div>
        <div class="mv-modal-match-arrow">&rarr;</div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.mv-modal-match-item').forEach(item => {
    item.addEventListener('click', () => {
      selectMvModalMatch(item.dataset.matchId);
    });
  });
}

async function selectMvModalMatch(matchId) {
  const match = state.allMatches.find(m => m.id === matchId);
  if (!match) return;

  el('mv-modal-match-name').textContent = match.title || (match.teams ? `${match.teams.home.name} vs ${match.teams.away.name}` : 'Match');

  el('mv-modal-matches-view').classList.add('hidden');
  el('mv-modal-streams-view').classList.remove('hidden');

  const listContainer = el('mv-modal-streams-list');
  listContainer.innerHTML = '<div class="mv-streams-loading"><div class="spinner sm"></div> Loading streams...</div>';

  if (!match.sources || match.sources.length === 0) {
    listContainer.innerHTML = '<p style="color:var(--text3);font-size:0.85rem;">No streams available.</p>';
    return;
  }

  try {
    const src = match.sources[0];
    const data = await fetchJSON(`/api/stream/${src.source}/${src.id}`);
    const streams = Array.isArray(data) ? data : [];

    if (streams.length === 0) {
      listContainer.innerHTML = '<p style="color:var(--text3);font-size:0.85rem;">No working streams found.</p>';
      return;
    }

    listContainer.innerHTML = streams.map((stream, idx) => {
      return `
        <button class="mv-modal-stream-btn" data-match-id="${escapeHtml(match.id)}" data-source="${escapeHtml(src.source)}" data-stream-idx="${idx}">
          <span>Stream ${stream.streamNo || idx + 1} (${escapeHtml(stream.language || 'English')})</span>
          ${stream.hd ? '<span class="tab-hd">HD</span>' : ''}
        </button>
      `;
    }).join('');

    listContainer.querySelectorAll('.mv-modal-stream-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectMvModalStream(btn.dataset.matchId, btn.dataset.source, parseInt(btn.dataset.streamIdx));
      });
    });
  } catch (e) {
    listContainer.innerHTML = `<p style="color:var(--live);font-size:0.85rem;">Failed to load: ${escapeHtml(e.message)}</p>`;
  }
}

function selectMvModalStream(matchId, sourceName, streamIndex) {
  const match = state.allMatches.find(m => m.id === matchId);
  if (match && state.mvModalActiveSlot !== null) {
    loadMultiviewSlotStream(state.mvModalActiveSlot, match, sourceName, streamIndex);
    closeMvModal();
  }
}

// ===================== Auto-refresh =====================
function startAutoRefresh() {
  if (state.refreshInterval) clearInterval(state.refreshInterval);
  state.refreshInterval = setInterval(() => {
    if (state.currentCategory === 'live' && !state.currentMatch) loadMatches();
  }, 60000);
}

// ===================== Init =====================
async function init() {
  await loadSports();
  await loadMatches();
  loadMultiviewState();
  startAutoRefresh();
}

// Expose for inline handlers & external views
Object.assign(window, {
  state, filterCategory, filterSport, handleSearch, setActiveNav,
  showHome, toggleMobileMenu, closeMobileMenu, openPlayer, retryLoad,
  showMultiview, changeMultiviewLayout, clearAllMultiviewSlots,
  clearMultiviewSlot, toggleMultiviewSidebar, handleMultiviewSearch,
  loadMatchStreamsIntoActiveSlot, changeSlotSource, changeSlotStreamIndex,
  fullscreenMultiviewSlot, openMvModal, closeMvModal, filterMvModalMatches,
  showMvModalMatchesView, selectMvModalMatch, selectMvModalStream
});

document.addEventListener('DOMContentLoaded', init);
