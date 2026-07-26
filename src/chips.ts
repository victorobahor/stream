import type { Sport } from './types';
import { state } from './state';
import { capitalize, getSportEmoji } from './format';

export const ALL_SPORTS = 'all';

interface SportChipOptions {
  /** Class applied to every chip — also the delegation selector. */
  chipClass: string;
  /** Label for the leading "everything" chip. */
  allLabel: string;
  /** Prefix chip labels with the sport emoji. */
  withEmoji?: boolean;
  /** Currently selected sport id. */
  activeId: string;
  /** Called with the newly selected sport id. */
  onSelect: (id: string) => void;
}

/** The API occasionally returns bare strings instead of `{id, name}`. */
function readSport(sport: Sport | string): { id: string; name: string } {
  if (typeof sport === 'string') return { id: sport, name: sport };
  const id = sport.id || sport.name;
  return { id, name: sport.name || sport.id };
}

/** Latest select handler per container, so the delegated listener never goes stale. */
const selectHandlers = new WeakMap<HTMLElement, (id: string) => void>();

/** Move the `active` class onto the chip for `activeId` within `container`. */
export function syncSportChips(container: HTMLElement | null, activeId: string): void {
  if (!container) return;
  const current = container.querySelector('.active');
  if (current) current.classList.remove('active');
  for (const chip of container.querySelectorAll<HTMLElement>('[data-sport-id]')) {
    if (chip.dataset.sportId === activeId) {
      chip.classList.add('active');
      return;
    }
  }
}

/**
 * Render the sport filter chips into `container`.
 *
 * Selection is handled by a single delegated listener bound once per container,
 * so re-rendering never leaves stale per-chip closures pointing at an old
 * `activeChip` variable.
 */
export function renderSportChips(container: HTMLElement | null, opts: SportChipOptions): void {
  if (!container) return;

  const fragment = document.createDocumentFragment();

  const allChip = document.createElement('button');
  allChip.className = opts.chipClass;
  allChip.dataset.sportId = ALL_SPORTS;
  allChip.textContent = opts.allLabel;
  fragment.appendChild(allChip);

  const seen = new Set<string>([ALL_SPORTS]);
  for (const entry of state.sports) {
    const { id, name } = readSport(entry);
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const chip = document.createElement('button');
    chip.className = opts.chipClass;
    chip.dataset.sportId = id;
    chip.textContent = opts.withEmoji ? `${getSportEmoji(name)} ${capitalize(name)}` : capitalize(name);
    fragment.appendChild(chip);
  }

  container.replaceChildren(fragment);
  syncSportChips(container, opts.activeId);
  selectHandlers.set(container, opts.onSelect);

  if (!container.dataset.chipsBound) {
    container.dataset.chipsBound = 'true';
    container.addEventListener('click', e => {
      const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-sport-id]');
      const id = chip?.dataset.sportId;
      if (!id) return;
      syncSportChips(container, id);
      selectHandlers.get(container)?.(id);
    });
  }
}
