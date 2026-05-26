## 2024-11-23 - XSS Vulnerability in Unsanitized API Data and `iframe` Sources
**Vulnerability:** Several dynamic properties originating from external APIs (`posterUrl`, `stream.embedUrl`, `stream.streamNo`) were unsanitized when being evaluated into innerHTML or assigned to `iframe.src`. This led to a critical XSS vector where malicious `javascript:` URIs could be loaded.
**Learning:** Even though basic HTML escaping is used for text presentation, it does not prevent `javascript:` payload execution within href/src attributes (e.g. `iframe.src`). Unescaped properties injected into templates also offer attribute breakout vulnerabilities.
**Prevention:**
1. Validate protocols for URIs inserted into `src` or `href` attributes, stripping `javascript:`, `data:`, and `vbscript:` to `about:blank`.
2. Ensure ALL untrusted data used in innerHTML templating is passed through `escapeHtml`, even properties assumed to be internal identifiers like `streamNo`.