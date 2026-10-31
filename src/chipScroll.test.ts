// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { enableChipScroll, refreshChipScroll, revealChip } from './chipScroll';

function row(scrollWidth = 1000, clientWidth = 400) {
  const parent = document.createElement('div');
  const container = document.createElement('div');
  parent.appendChild(container);
  document.body.appendChild(parent);
  Object.defineProperty(container, 'scrollWidth', { value: scrollWidth });
  Object.defineProperty(container, 'clientWidth', { value: clientWidth });
  container.scrollBy = vi.fn();
  enableChipScroll(container);
  refreshChipScroll(container);
  return { container, wrapper: parent.firstElementChild as HTMLElement };
}

const wheel = (init: WheelEventInit) => new WheelEvent('wheel', { cancelable: true, ...init });

describe('chip row scrolling', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn(() => ({ matches: false })) as never;
  });

  it('wraps the row once and shows only the directions it can go', () => {
    const { container, wrapper } = row();
    enableChipScroll(container);
    expect(wrapper.querySelectorAll('.chip-scroll-btn')).toHaveLength(2);
    expect(wrapper.classList.contains('can-scroll-back')).toBe(false);
    expect(wrapper.classList.contains('can-scroll-forward')).toBe(true);
    container.scrollLeft = 600;
    refreshChipScroll(container);
    expect(wrapper.classList.contains('can-scroll-back')).toBe(true);
    expect(wrapper.classList.contains('can-scroll-forward')).toBe(false);
  });

  it('shows no arrows when every chip fits', () => {
    const { wrapper } = row(300, 400);
    expect(wrapper.className).toBe('chip-scroller');
  });

  it('turns a vertical wheel into sideways scrolling', () => {
    const { container } = row();
    const e = wheel({ deltaY: 120 });
    container.dispatchEvent(e);
    expect(container.scrollLeft).toBe(120);
    expect(e.defaultPrevented).toBe(true);
  });

  it('converts line-based wheel deltas', () => {
    const { container } = row();
    container.dispatchEvent(wheel({ deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE }));
    expect(container.scrollLeft).toBe(96);
  });

  it('gives the wheel back to the page at either end', () => {
    const { container } = row();
    const up = wheel({ deltaY: -120 });
    container.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(false);
    container.scrollLeft = 600;
    const down = wheel({ deltaY: 120 });
    container.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
  });

  it('leaves sideways swipes and pinch zoom alone', () => {
    const { container } = row();
    const swipe = wheel({ deltaX: 50, deltaY: 10 });
    const pinch = wheel({ deltaY: 40 });
    Object.defineProperty(pinch, 'ctrlKey', { value: true });
    container.dispatchEvent(swipe);
    container.dispatchEvent(pinch);
    expect(swipe.defaultPrevented).toBe(false);
    expect(pinch.defaultPrevented).toBe(false);
  });

  it('pages with the arrows', () => {
    const { container, wrapper } = row();
    wrapper.querySelector<HTMLElement>('.chip-scroll-forward')!.click();
    expect(container.scrollBy).toHaveBeenCalledWith({ left: 300, behavior: 'smooth' });
    wrapper.querySelector<HTMLElement>('.chip-scroll-back')!.click();
    expect(container.scrollBy).toHaveBeenLastCalledWith({ left: -300, behavior: 'smooth' });
  });

  it('reveals a chip past the edge and leaves visible ones alone', () => {
    const { container } = row();
    const box = (left: number, right: number) => ({ left, right }) as DOMRect;
    container.getBoundingClientRect = () => box(0, 400);
    const chip = document.createElement('button');
    chip.getBoundingClientRect = () => box(100, 200);
    revealChip(container, chip);
    expect(container.scrollBy).not.toHaveBeenCalled();
    chip.getBoundingClientRect = () => box(380, 480);
    revealChip(container, chip);
    expect(container.scrollBy).toHaveBeenCalledWith({ left: 128, behavior: 'smooth' });
  });
});
