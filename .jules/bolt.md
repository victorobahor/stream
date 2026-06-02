## 2024-06-01 - DOM Event Listeners in Virtual DOM-less Architecture
**Learning:** This codebase manually rebuilds DOM strings via `innerHTML` on state changes instead of using a Virtual DOM library. Re-attaching individual event listeners inside `.forEach` loops for every list item during re-renders creates significant memory churn and CPU overhead.
**Action:** Always prefer Event Delegation on static parent containers, using `.dataset.eventsBound` to ensure listeners are only attached once during the app lifecycle.

## 2026-06-02 - DOM Reflows in Loop Rendering
**Learning:** Incrementally appending child nodes directly to a live DOM element inside a loop triggers expensive browser layout recalculations and reflows for each iteration, causing significant overhead in a Vanilla JS app.
**Action:** Batch DOM manipulations by appending children to a `DocumentFragment` inside the loop, and then append the fragment to the live DOM exactly once. This dramatically reduces layout thrashing.
