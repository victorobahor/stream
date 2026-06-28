## 2024-06-01 - DOM Event Listeners in Virtual DOM-less Architecture
**Learning:** This codebase manually rebuilds DOM strings via `innerHTML` on state changes instead of using a Virtual DOM library. Re-attaching individual event listeners inside `.forEach` loops for every list item during re-renders creates significant memory churn and CPU overhead.
**Action:** Always prefer Event Delegation on static parent containers, using `.dataset.eventsBound` to ensure listeners are only attached once during the app lifecycle.

## 2026-06-02 - DOM Reflows in Loop Rendering
**Learning:** Incrementally appending child nodes directly to a live DOM element inside a loop triggers expensive browser layout recalculations and reflows for each iteration, causing significant overhead in a Vanilla JS app.
**Action:** Batch DOM manipulations by appending children to a `DocumentFragment` inside the loop, and then append the fragment to the live DOM exactly once. This dramatically reduces layout thrashing.
## 2024-05-19 - Efficient DOM state manipulation

**Learning:** When managing `active` class states among dynamically created elements inside a loop, keeping track of the active element using a variable closure avoids repeatedly triggering expensive DOM queries (`querySelectorAll`) on every click.

**Action:** Optimized `renderMultiviewSidebar` in `src/multiview/sidebar.ts` to cache the `activeChip` element.
## 2026-06-28 - DOM Query Caching Patterns
**Learning:** When trying to optimize `querySelectorAll` loops for UI active state management in this Vanilla JS app, attempting to abstract state updates out of local rendering contexts can lead to anti-patterns (e.g., exposing local closures to the global `window` object) or severe performance regressions (e.g., triggering full component re-renders instead of localized DOM updates).
**Action:** Use simple module-scoped variables to cache active DOM elements. Maintain these caches directly within the same context where the elements are created or updated, enabling O(1) class toggling without global namespace pollution or expensive DOM re-building.
