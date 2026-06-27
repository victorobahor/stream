## 2024-05-18 - Search Shortcut UX
**Learning:** Adding a keyboard shortcut (`/`) for search input is a highly requested UX feature but requires careful event delegation to avoid overriding typing in other inputs.
**Action:** Always check `!['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)` when implementing global keyboard shortcuts.

## 2024-05-30 - Keyboard Accessibility on Clickable Cards
**Learning:** Adding `role="button"` and `tabindex="0"` to interactive `div` elements like `.match-card` and `.related-card` enables them to receive keyboard focus, but they also require manual `'keydown'` event listeners for `Enter` and `Space` keys to be fully keyboard accessible.
**Action:** Whenever turning non-interactive elements (like `div` or `span`) into clickable elements using Javascript, ensure to add `keydown` listeners for Enter/Space keys alongside `click` listeners.

## 2024-06-25 - Screen Reader Clarity for Custom Buttons
**Learning:** Custom components using `role="button"` that contain complex nested information (like match titles, scores, and sport emojis) will cause screen readers to read out all the nested visual content by default, which can be confusing and overly verbose for users navigating interactively.
**Action:** When creating custom interactive cards (e.g., `.related-card`, `.sidebar-match-card`), always add an explicit `aria-label` summarizing the primary action and target (e.g., `aria-label="Select [Match Title]"`) to ensure concise and clear screen reader announcements.

## 2024-06-20 - Accessible Modals and Focus Management
**Learning:** For a custom modal in Vanilla JS to be fully accessible, it is critical to explicitly manage focus. Setting `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` ensures screen readers announce the modal correctly. Furthermore, capturing `document.activeElement` before the modal opens, shifting focus into the modal (e.g. to the search input), and restoring focus when the modal closes is required to prevent keyboard users from losing their place in the DOM and experiencing a jarring navigation flow.
**Action:** Always add ARIA modal attributes to custom modal containers and implement programmatic focus trapping/restoration when developing or enhancing modal components.

## 2024-07-26 - Contextual Shortcut Routing
**Learning:** A global search shortcut like `/` can be frustrating if it unconditionally refocuses the main search bar while the user is actually interacting with a modal or a dedicated sub-view (like Multi View) that has its own search input.
**Action:** When implementing global hotkeys, check the active view state (e.g., via class checks like `.multiview-active` or checking if modals are open) and intelligently route the shortcut focus to the most relevant input field in the current user context.
