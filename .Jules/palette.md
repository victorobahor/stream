## 2024-05-18 - Search Shortcut UX
**Learning:** Adding a keyboard shortcut (`/`) for search input is a highly requested UX feature but requires careful event delegation to avoid overriding typing in other inputs.
**Action:** Always check `!['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)` when implementing global keyboard shortcuts.
