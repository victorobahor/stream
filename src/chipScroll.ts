/** Room kept clear of the edge fade and arrow when revealing a chip. */
const EDGE_PX = 48;
/** Firefox reports wheel deltas in lines for a physical mouse. */
const WHEEL_LINE_PX = 32;

const refreshers = new WeakMap<HTMLElement, () => void>();

function behavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

function arrow(label: string, glyph: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chip-scroll-btn';
  btn.textContent = glyph;
  // Mouse-only shortcut: keyboard users tab through the chips themselves.
  btn.tabIndex = -1;
  btn.setAttribute('aria-hidden', 'true');
  btn.title = label;
  btn.addEventListener('click', onClick);
  return btn;
}

/** Scroll just far enough that `chip` clears the edge fade. */
export function revealChip(container: HTMLElement, chip: HTMLElement): void {
  const box = container.getBoundingClientRect();
  const rect = chip.getBoundingClientRect();
  const before = rect.left - (box.left + EDGE_PX);
  const after = rect.right - (box.right - EDGE_PX);
  if (before < 0) container.scrollBy({ left: before, behavior: behavior() });
  else if (after > 0) container.scrollBy({ left: after, behavior: behavior() });
}

/**
 * The chip rows hide their scrollbar, which leaves a mouse with no way across.
 * Add arrows and edge fades, and let a vertical wheel move the row until it
 * reaches an end, where the page takes over again.
 */
export function enableChipScroll(container: HTMLElement): void {
  if (refreshers.has(container)) return;

  const page = (direction: number) =>
    container.scrollBy({ left: direction * container.clientWidth * 0.75, behavior: behavior() });

  const wrapper = document.createElement('div');
  wrapper.className = 'chip-scroller';
  const back = arrow('Scroll back', '‹', () => page(-1));
  back.classList.add('chip-scroll-back');
  const forward = arrow('Scroll forward', '›', () => page(1));
  forward.classList.add('chip-scroll-forward');
  container.before(wrapper);
  wrapper.append(back, container, forward);

  const refresh = () => {
    const max = container.scrollWidth - container.clientWidth;
    wrapper.classList.toggle('can-scroll-back', container.scrollLeft > 1);
    wrapper.classList.toggle('can-scroll-forward', container.scrollLeft < max - 1);
  };
  refreshers.set(container, refresh);

  container.addEventListener('scroll', refresh, { passive: true });
  container.addEventListener('wheel', e => {
    if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
    const delta = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * WHEEL_LINE_PX : e.deltaY;
    const max = container.scrollWidth - container.clientWidth;
    const next = Math.min(max, Math.max(0, container.scrollLeft + delta));
    if (next === container.scrollLeft) return;
    e.preventDefault();
    container.scrollLeft = next;
  }, { passive: false });
  container.addEventListener('focusin', e => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-sport-id]');
    if (chip) revealChip(container, chip);
  });
  // Also covers rows that start hidden, such as the Multi View sidebar.
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(refresh).observe(container);
}

/** Re-measure after the chips change. */
export function refreshChipScroll(container: HTMLElement): void {
  refreshers.get(container)?.();
}
