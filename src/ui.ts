import { state } from './state';
import { el } from './helpers';
import { capitalize, getSportEmoji } from './format';
import { loadMatches } from './api';
import { applyFilters } from './filters';

// ── View switching ──

export function showHome(): void {
  document.body.classList.remove('multiview-active');
  el('player-view')?.classList.add('hidden');
  el('multiview-view')?.classList.add('hidden');
  el('home-view')?.classList.remove('hidden');
  state.currentMatch = null;
  const iframe = el('stream-iframe') as HTMLIFrameElement | null;
  if (iframe) iframe.src = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Loading states ──

export function showSkeleton(show: boolean): void {
  el('skeleton-grid')?.classList.toggle('hidden', !show);
  el('matches-grid')?.classList.toggle('hidden', show);
  if (show) el('empty-state')?.classList.add('hidden');
}

export function hideError(): void {
  el('error-state')?.classList.add('hidden');
}

export function showError(msg: string): void {
  el('error-state')?.classList.remove('hidden');
  const errorMsg = el('error-msg');
  if (errorMsg) errorMsg.textContent = msg || 'Something went wrong.';
  el('matches-grid')?.classList.add('hidden');
  el('skeleton-grid')?.classList.add('hidden');
  el('empty-state')?.classList.add('hidden');
}

export function retryLoad(): void {
  hideError();
  loadMatches().then(() => applyFilters()).catch(err => {
    console.error('Retry failed:', err);
    showError('Failed to load matches. Please try again.');
  });
}

// ── Navigation ──

export function setActiveNav(linkEl: HTMLElement | null): void {
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  if (linkEl) linkEl.classList.add('active');
}

export function toggleMobileMenu(): void {
  el('mobile-nav')?.classList.toggle('open');
}

export function closeMobileMenu(): void {
  el('mobile-nav')?.classList.remove('open');
}

// ── Sports bar rendering ──

export function renderSportsBar(): void {
  const bar = el('sports-bar');
  if (!bar) return;
  const allChip = bar.querySelector('.sport-chip');
  if (!allChip) return;
  bar.innerHTML = '';
  bar.appendChild(allChip);

  const seen = new Set<string>();
  state.sports.forEach(sport => {
    const id = sport.id || sport.name || (sport as unknown as string);
    if (seen.has(id)) return;
    seen.add(id);
    const name = sport.name || sport.id || (sport as unknown as string);
    const chip = document.createElement('button');
    chip.className = 'sport-chip';
    chip.dataset.id = id;
    chip.textContent = `${getSportEmoji(name)} ${capitalize(name)}`;
    chip.onclick = () => {
      document.querySelectorAll('.sport-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      import('./filters').then(m => m.filterSport(id, chip));
    };
    bar.appendChild(chip);
  });
}
