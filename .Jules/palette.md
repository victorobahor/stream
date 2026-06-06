## 2024-05-18 - Search Shortcut UX
**Learning:** Adding a keyboard shortcut (`/`) for search input is a highly requested UX feature but requires careful event delegation to avoid overriding typing in other inputs.
**Action:** Always check `!['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)` when implementing global keyboard shortcuts.

## 2024-05-30 - Keyboard Accessibility on Clickable Cards
**Learning:** Adding `role="button"` and `tabindex="0"` to interactive `div` elements like `.match-card` and `.related-card` enables them to receive keyboard focus, but they also require manual `'keydown'` event listeners for `Enter` and `Space` keys to be fully keyboard accessible.
**Action:** Whenever turning non-interactive elements (like `div` or `span`) into clickable elements using Javascript, ensure to add `keydown` listeners for Enter/Space keys alongside `click` listeners.

## 2024-05-30 - Multi-View Action UX
**Learning:** Destructive actions in multi-view configurations require a confirmation dialog to prevent accidental loss of user setup.
**Action:** When creating 'Clear All' type functionality that destroys configuration state, use `window.confirm` to ask for verification.
