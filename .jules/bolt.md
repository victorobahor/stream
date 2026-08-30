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

## 2026-07-05 - Batch DOM modifications
**Learning:** In highly interactive components like modals, appending items directly to the DOM one by one in a loop causes expensive reflows. Similarly, using a querySelectorAll every time an item is selected causes O(N) operations.
**Action:** Use `DocumentFragment` when rendering lists inside modals (e.g., multiview modal sports) and maintain a local `activeChip` closure variable to make selection O(1) in `src/multiview/modal.ts`.
## 2026-07-12 - DOM Query Caching Antipatterns
**Learning:** Caching raw DOM nodes in module-scoped variables to avoid querySelectorAll is a dangerous antipattern in UIs that frequently re-render, as it leads to stale references to dead nodes and memory leaks.
**Action:** Avoid global or module-scoped DOM node caching for dynamic elements. Prefer optimizing pure JS operations, like moving costly string manipulations (e.g. `toLowerCase()`) outside of loops.
## 2024-07-19 - Short-circuiting String Operations
**Learning:** In hot loops like `matchTextIncludes` (which runs on every keystroke during search), unconditionally executing `.toLowerCase()` and `.includes()` on multiple properties before evaluating the results creates unnecessary string allocations and CPU overhead, especially when a match might be found on the very first property.
**Action:** When evaluating multiple string conditions for a single true/false outcome, use early returns (short-circuiting). Check the first property and return immediately if true, skipping expensive operations on the remaining properties.

## 2024-07-26 - Schwartzian Transform for Array Sorting
**Learning:** In highly used sorting functions (like `sortMatchesForDisplay`), placing expensive function calls (e.g. ones involving string manipulation or date calculations) directly inside the `.sort()` comparator results in $O(N \log N)$ executions, creating a measurable bottleneck when the list size grows.
**Action:** Use a Schwartzian transform (decorate-sort-undecorate) to pre-calculate expensive sort keys in a prior `.map()` step. This reduces expensive executions to strictly $O(N)$ while keeping the comparator fast and simple.
## 2024-08-01 - Date string conversions in loops
**Learning:** Recreating `new Date(ts).toDateString()` for every element in a loop or `.filter()` callback during view rendering causes significant overhead via object allocations and string conversions. Local micro-benchmarks showed this was >30x slower than numerical boundary checks.
**Action:** When filtering or comparing dates in a loop, pre-compute numeric timestamp boundaries (like `startOfDay` and `endOfDay`) outside the loop using `new Date()`. Then, inside the loop, use strict numeric comparisons (`ts >= startOfDay && ts < endOfDay`) to completely eliminate the allocation and string processing overhead.
## 2024-11-20 - O(N) Lookups in Unpaginated DOM Render Loops
**Learning:** Pure formatting functions (like `formatSportLabel`) called repeatedly inside unpaginated loops (such as rendering hundreds of cards in multiview search) can cause massive CPU spikes if they internally rely on O(N) lookups (like `array.find()`).
**Action:** Always cache lookup arrays into `Map` objects (O(1)) inside frequently called helper functions. When deriving the cache from state, use reference equality checks (`state.array !== lastRef`) instead of deep comparisons for ultra-fast cache invalidation.
