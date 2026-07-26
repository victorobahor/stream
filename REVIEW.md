# StreamZone — Code Review

Focus: (1) why the ad-blocking sandbox is failing, (2) performance, (3) correctness bugs.

---

## Part 1 — The sandbox / ad-blocking problem

### The current approach does nothing

`helpers.ts:103-120`:

```ts
const SANDBOX_CSP = "sandbox allow-scripts allow-same-origin";

export function buildSandboxedSrcdoc(embedUrl: string): string {
  return `<!DOCTYPE html><html><head>
    <meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">
    ...<iframe src="${safeUrl}" ...></iframe></body></html>`;
}

export function applySandboxedSrcdoc(iframe, embedUrl) {
  iframe.removeAttribute('src');
  iframe.removeAttribute('sandbox');   // ← outer frame has NO sandbox
  iframe.setAttribute('srcdoc', buildSandboxedSrcdoc(embedUrl));
}
```

Three independent reasons this is a no-op:

1. **CSP `sandbox` is ignored when delivered via `<meta>`.** It is a header-only directive
   (as are `frame-ancestors` and `report-uri`). Chrome logs
   `The Content Security Policy directive 'sandbox' is ignored when delivered via a <meta> element.`
   You cannot set it from inside a `srcdoc`. Ever.
2. **`allow-scripts` + `allow-same-origin` together cancel the sandbox** for same-origin
   content. A `srcdoc` document inherits the parent's origin, so the wrapper document is
   same-origin with your page — the exact case where that flag pair is meaningless.
3. **`sandbox` was explicitly removed from the real iframe** on line 118, so no sandbox
   flags exist at any level.

Net result: zero ads blocked, zero popups blocked, plus an extra document layer that costs
a render and breaks the load event (see below). The wrapper is pure overhead.

### Why adding `sandbox` makes the source error out

`sandbox` **without** `allow-same-origin` gives the framed document an **opaque origin**.
That immediately breaks:

- `localStorage` / `sessionStorage` / IndexedDB — access **throws `SecurityError`**
- cookies (so any session/auth token the player needs)
- credentialed `fetch`/XHR back to its own host
- `document.domain`, `BroadcastChannel`, service workers

Virtually every commercial embed player writes quality/volume prefs to `localStorage` on
init. Under an opaque origin that throw is uncaught and the player dies. That is your
"the source errors out that there is a sandbox."

### The fix

Keep `allow-same-origin`, drop the popup and navigation flags. **On a cross-origin embed
this is safe** — the frame is a different origin from your page, so `allow-same-origin`
grants it access to *its own* origin, not yours. (The usual MDN warning about
`allow-scripts allow-same-origin` only applies to *same-origin* content — which is
precisely what the `srcdoc` wrapper accidentally created.)

Replace all of `buildSandboxedSrcdoc` / `buildSandboxedSrcdocAttr` /
`applySandboxedSrcdoc` with:

```ts
// Flags deliberately omitted: allow-popups, allow-popups-to-escape-sandbox,
// allow-top-navigation, allow-top-navigation-by-user-activation, allow-modals,
// allow-downloads, allow-pointer-lock, allow-orientation-lock.
// Those are the popunder / tab-hijack / forced-download vectors.
const EMBED_SANDBOX = [
  'allow-scripts',        // required — it's a video player
  'allow-same-origin',    // required — player uses localStorage/cookies on ITS origin
  'allow-forms',
  'allow-presentation',   // Cast / AirPlay
].join(' ');

const EMBED_ALLOW = 'autoplay; encrypted-media; fullscreen; picture-in-picture';

export function applyEmbed(iframe: HTMLIFrameElement, embedUrl: string): void {
  const safe = sanitizeUrl(embedUrl);
  if (!safe || safe === 'about:blank') return;
  iframe.removeAttribute('srcdoc');
  iframe.setAttribute('sandbox', EMBED_SANDBOX);
  iframe.setAttribute('allow', EMBED_ALLOW);
  iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  iframe.src = safe;   // set LAST — sandbox must be present before navigation
}

export function clearEmbed(iframe: HTMLIFrameElement): void {
  iframe.removeAttribute('srcdoc');
  iframe.src = 'about:blank';   // stops playback/audio; removeAttribute('src') does not
}
```

Two ordering rules that matter: `sandbox` must be set **before** `src`, or the first
navigation happens unsandboxed. And `src = 'about:blank'` is what actually stops audio —
`removeAttribute('src')` leaves the current document running in some browsers.

### What this does and does not buy you

**Blocked:** popunders, `window.open` spam, `top.location` redirects, forced downloads,
`alert`/`confirm` spam, camera/mic/geolocation prompts. In practice that is most of what
makes these embeds unusable.

**Not blocked:** banner and pre-roll ads *rendered inside the player's own document*.
You cannot script into a cross-origin frame — no `contentDocument`, no injected CSS, no
MutationObserver. There is no client-side trick around the same-origin policy.

Killing in-page ads requires one of:

- a browser extension (`declarativeNetRequest`) — out of scope for a web app;
- a **server-side proxy** that fetches the embed HTML, strips ad scripts, and reserves it
  from your origin. This is the only real option, and it makes the embed same-origin, at
  which point you genuinely do need the sandbox for security;
- CSP Embedded Enforcement (`csp=` attribute) — requires the embed host to send
  `Allow-CSP-From`. They won't. Dead end.

If in-page ads are the actual requirement, the proxy is the design decision to make; the
iframe attributes alone will not get you there.

### Related: your parent CSP is silently blocking streams

`index.html:11`:

```
frame-src https://streamed.pk https://strmd.link https://embed.st https://www.youtube.com
```

`embedUrl` comes from the API and is **not** constrained to those four hosts. Any stream on
a fifth host is blocked by CSP and renders a blank player — indistinguishable to the user
from a dead source. The `srcdoc` wrapper does not help: a `srcdoc` document inherits the
parent CSP, so the nested iframe is checked against the same `frame-src`.

Either widen to `frame-src https:` (and rely on the sandbox for safety, which is the
correct division of labour), or log CSP violations so you can see which hosts are being
dropped:

```js
document.addEventListener('securitypolicyviolation', e =>
  console.warn('CSP blocked', e.blockedURI, e.violatedDirective));
```

`csp.test.ts:19` asserts the exact allowlist string, so it needs updating alongside.

### Related: the loading spinner is measuring the wrong thing

`player.ts:162-175` — with `srcdoc`, `iframe.onload` fires when the *wrapper* parses, which
is instant. The spinner therefore hides before the embed has loaded, and the 5s timeout is
doing all the real work. Switching to `iframe.src` makes `onload` meaningful again.

The timeout itself is also leaked: five stream switches queue five live timers, each
holding stale `iframe` / `playerLoading` references. Store the id and clear it. Also null
`iframe.onload` on teardown — `clearSandboxedSrcdoc` fires a load event for `about:blank`
and re-triggers the handler.

---

## Part 2 — Performance

### Every grid render restarts every playing stream

`grid.ts:165-203` is the worst issue in the codebase:

```ts
container.innerHTML = '';                       // destroys ALL iframes
...
container.querySelectorAll('.mv-iframe[data-embed-url]').forEach(iframe => {
  applySandboxedSrcdoc(iframe, iframe.dataset.embedUrl);   // re-navigates ALL of them
});
```

`renderMultiviewGrid()` is called from `slots.ts:85, 101, 117, 137, 202, 210` and
`grid.ts:244`. Loading one new stream tears down and re-navigates every *other* slot —
twice (once for the loading state, once for the result). Streams jump back to live edge,
buffers are dropped, and every embed page is re-fetched from scratch. At boot,
`loadMultiviewState()` fires one load per saved slot concurrently: up to **eight full grid
rebuilds** in a few hundred milliseconds.

Fix: keep slot elements stable and patch only the changed slot. `changeSlotStreamIndex`
(`slots.ts:140-164`) already does this correctly — generalise that approach and reserve
`renderMultiviewGrid` for layout changes only.

### The animated background is the single largest rendering cost

`style.css:61-87` — three 350-500px elements with `filter: blur(90px)` and a 20s infinite
transform animation. A 90px blur over a half-megapixel layer is among the most expensive
filter operations available, and it re-composites continuously for the life of the page.

Stacked on top: five `backdrop-filter` surfaces (`:94, :202, :654, :724, :1225`), each
forcing a backdrop readback every frame against those animating orbs. That is continuous
full-viewport repaint while scrolling.

Cheapest fixes, in order: add a `@media (prefers-reduced-motion: reduce)` block (currently
**zero** matches in the file) that disables the orb animation; replace the runtime blur with
a pre-blurred WebP background; pause the animation when `document.hidden`.

Also `livePulse` (`:311`) runs one infinite animation per `.live-badge` — dozens
concurrently in a live grid.

### Full DOM rebuild on every keystroke

Four independent copies of the same pattern: `cards.ts:179`, `related.ts:18`,
`sidebar.ts:88`, `modal.ts:122`. Search is debounced 300ms (`delegates.ts:35`) but each
fire discards and recreates the whole subtree — no keying, no diffing, no virtualisation.
Several hundred matches means thousands of element creations plus a full layout and paint
every 300ms of typing.

Also inside those loops: `innerHTML` used to parse static SVG per card (`cards.ts:121, 152`,
`related.ts:57`, `sidebar.ts:116`, `modal.ts:151`, `grid.ts:83`). One HTML-parser invocation
per icon per card. Use a `<template>` + `cloneNode`, or an SVG sprite with `<use>`.

Card posters are CSS `background-image` (`cards.ts:24-29`), so unlike the badges they are
**not** lazy — every poster downloads and decodes on first paint.

### Auto-refresh runs in background tabs and flashes the grid

`app.ts:53-58` — 60s `setInterval` with no `document.hidden` check and no cleanup. It calls
`showSkeleton(true)`, so the entire grid flashes and scroll/hover state is lost every
minute. It also calls `applyMultiviewSidebarFilters()` even when multiview is not visible.
Gate on `visibilitychange`, and refresh into the existing DOM rather than through the
skeleton.

`app.ts:64-65` awaits `loadSports()` then `loadMatches()` sequentially — they're
independent, so `Promise.all` removes a round-trip from cold start.

### Smaller items

- `state.filteredMatches` is written (`filters.ts:60`) and never read. Dead state.
- Linear `find`-by-id in six places (`cards.ts:189`, `related.ts:75`, `modal.ts:190, 270`,
  `grid.ts:35`, via `slots.ts:38`). Build a `Map<string, APIMatch>` once in `api.ts:90`.
- `related.ts:10-16` makes three ~N-element allocations to produce a 12-item list.
- `ui.ts:100-104` and `filters.ts:30` each run the same `querySelectorAll('.sport-chip')`
  sweep on every chip click — two full passes per click, plus a fresh dynamic `import()`.
- `buildSandboxedSrcdocAttr` (`helpers.ts:110`) is never imported. `debounce`
  (`helpers.ts:90`) is only referenced from its own test. Both dead.
- `src/multiview/grid.ts.orig` is committed alongside `grid.ts`.
- Multiview bypasses the 5-minute stream cache: `api.ts:103` has it, but `modal.ts:212` and
  `slots.ts:92` call `fetchJSON` directly, so the same stream list is refetched on every
  slot load and modal open.

---

## Part 3 — Correctness bugs

**Active slot is always ignored** — `slots.ts:41-55`. The loop unconditionally overwrites
`targetSlot` with the first empty slot, so `targetSlot` computed on lines 41-45 is dead code
unless the grid is full. Clicking a filled slot then "Load Stream" loads somewhere else.
Needs `if (state.multiviewSlots[targetSlot] !== null)` around the loop.

**Modal stream race** — `modal.ts:189-267`. No request-id guard. Click match A then B:
A's response can land after B's and overwrite the list while the title shows B and the
buttons carry A's `data-match-id`. `player.ts:91` and `api.ts:66` both implement this guard
correctly; this path was missed.

**"Stream undefined"** — `modal.ts:231` and `player.ts:177`:
`String(stream.streamNo) || idx + 1`. `String(undefined)` is `"undefined"`, which is truthy,
so the fallback never fires. `grid.ts:108` gets it right: `str.streamNo || sIdx + 1`.

**Retry leaves the skeleton up** — `ui.ts:40-48`. `showSkeleton(false)` is only in the
`catch`, so on success the skeleton and the grid render stacked. `updateSectionTitle()` is
also skipped, unlike `app.ts:22`.

**Toasts clear each other early** — `format.ts:119-127`. Shared element, unstored timer id.
`slots.ts:97` and `player.ts:191` fire toasts back-to-back; the first timer clears the
newest one. Store and `clearTimeout` the id.

**Two definitions of "live"** — `format.ts:14` prints `🔴 Live now` for a 5-hour window;
`format.ts:35-43` `isMatchLive` (which drives the badge and `liveMatchIds`) uses 45 minutes.
A match two hours in shows "Live now" text with no LIVE badge.

**`isEPLMatch` mutates the API object** — `format.ts:48-63` caches onto `match.isEPL`, and
`types.ts:37` bakes that runtime field into the API interface. Impure function, dishonest
type, cache never invalidated.

**Host rotation desync** — `format.ts:109` / `state.ts:44`. Image URLs read
`API_HOSTS[hostIndex.current]` at render time. If `rotateActiveHost()` fires afterwards
(`api.ts:24`), already-rendered images still point at the dead host and never retry. Add an
`onerror` that re-resolves against the current host.

**Stale-closure chip state** — `sidebar.ts:39-70`, `modal.ts:53-84`. Each chip's `onclick`
closes over the `activeChip` from *that* render; re-rendering creates a second variable
while old closures survive.

**Tautological branch** — `ui.ts:55-60`: `if (activeNavLink) {...} else if (!activeNavLink)`.
The module-level reference also retains detached nodes when the mobile nav rebuilds.

**Delegates not idempotent** — `delegates.ts:39-125`. No double-invocation guard (would
double-fire every action) and the three `document` listeners are never removed. The `/`
hotkey (`:96`) checks only `INPUT`/`TEXTAREA`, so it hijacks `contentEditable`.

**Unvalidated cast** — `filters.ts:10`, `delegates.ts:15`: `cat as Category` straight from a
`data-value` attribute. A typo silently falls through to `/api/matches/all` via the
`default` in `api.ts:59`.

**Unhandled rejections** — `modal.ts:161` calls an `async` function with no `.catch`;
`app.ts:74` `init()` is async and unhandled; every dynamic `import()` lacks a `.catch`
(`ui.ts:103`, `related.ts:78`, `player.ts:235`, `grid.ts:37,135,137,146,148,157,216,225,245`).
A failed chunk fetch mid-deploy becomes a silent dead button.

**`beforeunload` disqualifies bfcache** — `app.ts:69-71`, for no benefit: the document is
being discarded, so `stopAllIframes()` is a no-op. Use `pagehide` plus a `visibilitychange`
pause instead.

---

## Part 4 — Duplication worth collapsing

1. Load-and-refilter orchestration ×3: `app.ts:13-28` (with UI feedback), `filters.ts:20-25`
   and `filters.ts:32-37` (identical to each other, no UI feedback).
2. EPL sort comparator ×2 verbatim: `filters.ts:52-58`, `modal.ts:108-114`. Neither uses
   `helpers.sortMatchesByLive`, which the sidebar *does* — so three views order matches
   three different ways.
3. Sport-chip renderer ×3: `ui.ts:80-108`, `sidebar.ts:32-77`, `modal.ts:45-89`.
4. List-render + `eventsBound` delegation block ×4: `cards.ts:186`, `related.ts:72`,
   `sidebar.ts:139`, `modal.ts:159`. All repeat a redundant `container.contains()` check —
   redundant because the listener is already on the container.
5. Poster sanitize-and-strip-quotes ×2: `cards.ts:27`, `player.ts:248-250`.
6. `debounce` and `debounceString` (`helpers.ts:90`, `:136`) are the same function.

---

## Part 5 — Build config

`vite.config.ts` is effectively default (13 lines). Missing:

- `esbuild.drop: ['console', 'debugger']` for prod — `helpers.ts:44` `log` currently ships
  with every call site.
- `build.sourcemap: 'hidden'` — currently `false`, so prod stack traces are unreadable.
- `build.rollupOptions.output.manualChunks` — ~12 dynamic imports produce many tiny
  ungrouped chunks.
- No `test` block despite vitest and three test files being present.
- `style.css` is 1,586 lines shipped eagerly and unsplit: multiview, modal and player CSS
  all load for the home view. The render-blocking Google Fonts stylesheet
  (`index.html:14`) is the first-paint bottleneck, not the JS.

---

## Suggested order

1. Replace `srcdoc` with a real `sandbox` attribute on the iframe (Part 1). Fixes the
   popup/redirect problem and the misleading load event in one change.
2. Widen or instrument `frame-src` (Part 1) — you are probably losing streams to CSP now.
3. Stop rebuilding the multiview grid on every slot change (`grid.ts:165`).
4. `prefers-reduced-motion` + drop the runtime 90px blur (`style.css:61`).
5. Gate auto-refresh on `document.hidden` and refresh without the skeleton.
6. The correctness list in Part 3 — each is small and independent.
