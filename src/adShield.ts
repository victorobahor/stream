/**
 * PopUnder mitigation for cross-origin embeds.
 *
 * We cannot stub `window.open` inside `embed.st` (wrong origin breaks their
 * WASM lock / playback), and Chrome does not honor `Permissions-Policy: popup`.
 * What we can do on the parent page:
 *   1. A click-to-start gate that consumes the first gesture so PopUnder's
 *      first `window.open` never sees it.
 *   2. A short-lived blur→focus steal so a popunder cannot bury this tab.
 */

const SHIELD_MS = 5000;

let shieldUntil = 0;
let installed = false;

function armShield(): void {
  shieldUntil = Date.now() + SHIELD_MS;
}

function onPointerDown(e: PointerEvent): void {
  const t = e.target;
  if (!(t instanceof Element)) return;
  if (t.closest('#player-container, .mv-slot, .player-gate')) armShield();
}

function onBlur(): void {
  if (Date.now() > shieldUntil) return;
  // PopUnder focuses the ad window; pull focus back on the next task.
  setTimeout(() => {
    try {
      window.focus();
    } catch {
      /* ignore */
    }
  }, 0);
}

/** Install once on app boot. */
export function installAdShield(): void {
  if (installed) return;
  installed = true;
  document.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('blur', onBlur);
}

/**
 * Cover `host` with a gate the user must click before the embed receives
 * input. The gate click is a parent-document gesture — PopUnder inside the
 * iframe does not get it.
 */
export function mountPlayGate(
  host: HTMLElement,
  opts: { message?: string } = {},
): () => void {
  host.querySelectorAll('.player-gate').forEach(el => el.remove());

  const gate = document.createElement('button');
  gate.type = 'button';
  gate.className = 'player-gate';
  gate.setAttribute('aria-label', opts.message || 'Click to start stream');

  const icon = document.createElement('span');
  icon.className = 'player-gate-icon';
  icon.innerHTML =
    '<svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';

  const label = document.createElement('span');
  label.className = 'player-gate-label';
  label.textContent = opts.message || 'Click to start';

  const hint = document.createElement('span');
  hint.className = 'player-gate-hint';
  hint.textContent = 'Then click the player once more to play';

  gate.append(icon, label, hint);

  const dismiss = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    armShield();
    gate.remove();
  };
  gate.addEventListener('pointerdown', dismiss, true);

  host.appendChild(gate);
  return () => gate.remove();
}
