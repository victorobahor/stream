## 2024-06-01 - DOM Event Listeners in Virtual DOM-less Architecture
**Learning:** This codebase manually rebuilds DOM strings via `innerHTML` on state changes instead of using a Virtual DOM library. Re-attaching individual event listeners inside `.forEach` loops for every list item during re-renders creates significant memory churn and CPU overhead.
**Action:** Always prefer Event Delegation on static parent containers, using `.dataset.eventsBound` to ensure listeners are only attached once during the app lifecycle.

## 2026-06-02 - DOM Reflows in Loop Rendering
**Learning:** Incrementally appending child nodes directly to a live DOM element inside a loop triggers expensive browser layout recalculations and reflows for each iteration, causing significant overhead in a Vanilla JS app.
**Action:** Batch DOM manipulations by appending children to a `DocumentFragment` inside the loop, and then append the fragment to the live DOM exactly once. This dramatically reduces layout thrashing.
## 2024-05-19 - Efficient DOM state manipulation

**Learning:** When managing `active` class states among dynamically created elements inside a loop, keeping track of the active element using a variable closure avoids repeatedly triggering expensive DOM queries (`querySelectorAll`) on every click.

**Action:** Optimized `renderMultiviewSidebar` in `src/multiview/sidebar.ts` to cache the `activeChip` element.

## 2024-06-07 - Optimizing Active State lookups

**Learning:** When generating interactive list items (like sports chips) that maintain a single active state within a container, repeatedly calling `container.querySelectorAll` inside click handlers scales poorly and wastes CPU cycles traversing the DOM.
**Action:** Always maintain a reference (e.g., `let activeChip: HTMLElement | null`) to the currently active element within the scope that generates the elements. Update this reference dynamically on click to avoid ever querying the DOM.
