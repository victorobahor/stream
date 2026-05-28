## 2024-11-23 - XSS Vulnerability in Unsanitized API Data and `iframe` Sources
**Vulnerability:** Several dynamic properties originating from external APIs (`posterUrl`, `stream.embedUrl`, `stream.streamNo`) were unsanitized when being evaluated into innerHTML or assigned to `iframe.src`. This led to a critical XSS vector where malicious `javascript:` URIs could be loaded.
**Learning:** Even though basic HTML escaping is used for text presentation, it does not prevent `javascript:` payload execution within href/src attributes (e.g. `iframe.src`). Unescaped properties injected into templates also offer attribute breakout vulnerabilities.
**Prevention:**
1. Validate protocols for URIs inserted into `src` or `href` attributes, stripping `javascript:`, `data:`, and `vbscript:` to `about:blank`.
2. Ensure ALL untrusted data used in innerHTML templating is passed through `escapeHtml`, even properties assumed to be internal identifiers like `streamNo`.
## 2026-05-28 - CSS Injection via HTML Attribute Decoding
**Vulnerability:** In `src/cards.ts`, the `posterUrl` was passed through `sanitizeUrl` and `escapeHtml` before being interpolated into the `style="background-image:url('...')"` attribute. However, `escapeHtml` converts `'` to `&#39;`, which the browser's HTML parser decodes back to `'` *before* the CSS parser evaluates the inline style. This allowed an attacker to break out of the `url('...')` CSS property and inject malicious CSS.
**Learning:** `escapeHtml` prevents breakout from HTML attributes (like `style="..."`), but it does NOT protect against escaping the CSS strings *inside* those attributes because of the parser evaluation order.
**Prevention:** When interpolating user-controlled URLs into inline CSS (e.g. `url('...')`), strip quotes (`'`, `"`) and backslashes (`\`) from the URL *before* applying `escapeHtml`.
