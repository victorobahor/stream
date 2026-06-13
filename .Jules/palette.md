## 2024-05-18 - Search Shortcut UX
**Learning:** Adding a keyboard shortcut (`/`) for search input is a highly requested UX feature but requires careful event delegation to avoid overriding typing in other inputs.
**Action:** Always check `!['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)` when implementing global keyboard shortcuts.

## 2024-05-30 - Keyboard Accessibility on Clickable Cards
**Learning:** Adding `role="button"` and `tabindex="0"` to interactive `div` elements like `.match-card` and `.related-card` enables them to receive keyboard focus, but they also require manual `'keydown'` event listeners for `Enter` and `Space` keys to be fully keyboard accessible.
**Action:** Whenever turning non-interactive elements (like `div` or `span`) into clickable elements using Javascript, ensure to add `keydown` listeners for Enter/Space keys alongside `click` listeners.

## 2024-06-25 - Screen Reader Clarity for Custom Buttons
**Learning:** Custom components using `role="button"` that contain complex nested information (like match titles, scores, and sport emojis) will cause screen readers to read out all the nested visual content by default, which can be confusing and overly verbose for users navigating interactively.
**Action:** When creating custom interactive cards (e.g., `.related-card`, `.sidebar-match-card`), always add an explicit `aria-label` summarizing the primary action and target (e.g., `aria-label="Select [Match Title]"`) to ensure concise and clear screen reader announcements.
